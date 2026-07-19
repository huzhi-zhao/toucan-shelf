import { MessageSquareTextIcon, SparklesIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Spreadsheet from "x-data-spreadsheet";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useMemoViewContextOptional } from "@/components/MemoView/MemoViewContext";
import { useUpdateMemo } from "@/hooks/useMemoQueries";
import { useTranslate } from "@/utils/i18n";
import { cellRef } from "./sheets/cellRef";
import { createCommentLayer, type CommentLayer } from "./sheets/commentLayer";
import { restructureContextMenu } from "./sheets/contextMenu";
import { unsupportedFunction } from "./sheets/formula";
import { ensureFormulaFallbacks } from "./sheets/formulaPatch";
import { formulaService } from "./sheets/formulaService";
import { parseSheetsBlock } from "./sheets/parseSheetsBlock";
import { observeResizes } from "./sheets/resizePatch";
import { serializeSheets, writeSheetsBlock } from "./sheets/serializeSheetsBlock";
import { serializeSheetCsv } from "./sheets/sheetCsv";
import {
  applySheetsStyle,
  commentKey,
  extractSheetsStyle,
  parseStyleOverlay,
  readSheetsComments,
  serializeStyleOverlay,
  type SheetsComments,
} from "./sheets/sheetStyle";
import { fromSpreadsheetData, toSpreadsheetData, type XSheet } from "./sheets/toSpreadsheetData";
import type { SheetsData } from "./sheets/types";
import { extractCodeContent } from "./utils";

interface SheetsBlockProps {
  children?: React.ReactNode;
  className?: string;
  // Style-overlay anchor, read from the fence info string (```sheets id=xxx).
  blockId?: string;
}

const WRITE_DEBOUNCE_MS = 600;

// Fallback grid viewport height when the block has no persisted one.
const DEFAULT_HEIGHT = 400;

// x-spreadsheet popups that scroll themselves (`overflow: auto`) and so must keep
// the browser's native wheel scrolling. They live inside the host element, so the
// grid's wheel handler has to exempt them explicitly.
const SCROLLABLE_POPUPS = [
  ".x-spreadsheet-contextmenu",
  ".x-spreadsheet-suggest",
  ".x-spreadsheet-sort-filter",
  ".x-spreadsheet-filter",
  ".x-spreadsheet-dropdown-content",
].join(",");

// Short opaque id used to key this block's style overlay in the memo's
// node_overlays map. Assigned lazily the first time a style is persisted, once
// per block and never again — the fence id is the block's permanent identity.
// Re-rolls on collision so two blocks in the same memo can't share an overlay.
function generateBlockId(taken: Record<string, string>): string {
  let id = Math.random().toString(36).slice(2, 8);
  while (id in taken) id = Math.random().toString(36).slice(2, 8);
  return id;
}

// x-spreadsheet's bottom tab bar. It exposes no public event for a tab switch
// and no public API to switch programmatically, so we reach in: `swapFunc` is
// the callback it invokes on a tab click (wrappable to observe switches), and
// `clickSwap2` is what a click itself calls (callable to switch).
interface Bottombar {
  items: unknown[];
  swapFunc: (index: number) => void;
  clickSwap2: (item: unknown) => void;
}

function bottombarOf(instance: Spreadsheet): Bottombar | null {
  return (instance as unknown as { bottombar?: Bottombar | null }).bottombar ?? null;
}

// Switches to the named sheet, if it exists and isn't already active. Called
// after loadData, which always resets the view to the first sheet.
function selectSheet(instance: Spreadsheet, name: string | undefined): void {
  if (!name) return;
  const bottombar = bottombarOf(instance);
  if (!bottombar) return;
  const index = (instance.getData() as XSheet[]).findIndex((sheet) => sheet.name === name);
  if (index <= 0) return;
  bottombar.clickSwap2(bottombar.items[index]);
}

// Loads CSV data plus a style overlay into the instance in one pass, so styles
// aren't wiped by a text-only loadData, then restores the remembered tab.
function loadWithStyle(instance: Spreadsheet, data: SheetsData, overlayJson: string | undefined): void {
  const overlay = parseStyleOverlay(overlayJson);
  const xsheets = toSpreadsheetData(data);
  applySheetsStyle(xsheets, overlay);
  instance.loadData(xsheets as unknown as Record<string, unknown>);
  selectSheet(instance, overlay?.activeSheet);
}

// The index (into getData()'s array) of the sheet currently shown. x-spreadsheet
// keeps the active sheet's data object as `sheet.data` inside its `datas` list,
// in the same order getData() returns them.
function activeSheetIndex(instance: Spreadsheet): number {
  const internal = instance as unknown as { datas?: unknown[]; sheet?: { data?: unknown } };
  const idx = internal.datas?.indexOf(internal.sheet?.data) ?? -1;
  return idx >= 0 ? idx : 0;
}

// The open tab's name, or undefined when it's the first sheet — loadData opens
// that one by default, so there's nothing to remember.
function activeSheetName(instance: Spreadsheet, raw: XSheet[]): string | undefined {
  const index = activeSheetIndex(instance);
  return index > 0 ? raw[index]?.name : undefined;
}

// The open tab's name, always — comments are keyed by sheet name, including for
// the first sheet (which activeSheetName deliberately reports as undefined).
function currentSheetName(instance: Spreadsheet, raw: XSheet[]): string {
  return raw[activeSheetIndex(instance)]?.name || "Sheet1";
}

interface Selection {
  ri: number;
  ci: number;
}

interface MenuState {
  x: number;
  y: number;
  selection: Selection;
  // Which popover the injected menu item opened: the AI formula prompt, or the
  // comment editor for the selected cell.
  mode: "ai" | "comment";
}

const SheetsBlockInner = ({ children, blockId }: SheetsBlockProps) => {
  const t = useTranslate();
  const codeContent = extractCodeContent(children);
  const data = useMemo(() => parseSheetsBlock(codeContent), [codeContent]);

  // The overlay anchor: the fence-meta id (source of truth going forward), with
  // the legacy in-body `view.id` as a fallback so dev docs written before the id
  // moved to the fence still resolve their overlay (and get migrated on next save).
  // An id we minted ourselves for a block that had none, kept for the lifetime of
  // this mount. Without it, every render before our write echoes back through the
  // content would see no id again and mint another one, scattering the overlay
  // across throwaway keys. Once the fence carries an id it always wins.
  const mintedIdRef = useRef<string | undefined>(undefined);
  const effectiveId = blockId ?? data.view.id ?? mintedIdRef.current;

  const memoViewContext = useMemoViewContextOptional();
  const memo = memoViewContext?.memo;
  const readonly = memoViewContext?.readonly ?? true;
  const { mutate: updateMemo } = useUpdateMemo();
  const interactive = !!memo && !readonly && !data.view.lock;

  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<Spreadsheet | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The (body, overlay) pair we last wrote ourselves — used to skip the reload
  // that our own update triggers, so an in-progress edit isn't reset under the
  // cursor and the active sheet isn't snapped back to the first one. Both the
  // CSV body and the style overlay are matched, so a style-only write is caught
  // too (a content-only guard would miss it and reload/reset the grid).
  const selfWritten = useRef<{ body: string; overlay: string | undefined } | null>(null);
  // True while a programmatic loadData is in flight. x-spreadsheet fires `change`
  // during loadData, which would otherwise schedule an auto-commit of state we
  // just loaded — and if the overlay wasn't ready yet, that commit would persist
  // an unstyled grid and delete the saved styles.
  const loadingRef = useRef(false);
  // The most recently selected cell, tracked from x-spreadsheet's events so the
  // AI menu knows which cell to write into.
  const selectionRef = useRef<Selection>({ ri: 0, ci: 0 });
  // True while the bottom resize handle is being dragged, so an incoming overlay
  // echo doesn't yank the height out from under the pointer.
  const draggingRef = useRef(false);

  // Latest values captured for the imperative x-spreadsheet callbacks without
  // re-instantiating the spreadsheet on every render.
  const interactiveRef = useRef(interactive);
  const memoRef = useRef(memo);
  const viewRef = useRef(data.view);
  interactiveRef.current = interactive;
  memoRef.current = memo;
  // Fold the effective id into the view so serialization/writes carry it onto
  // the fence, regardless of whether it came from the fence or a legacy body id.
  viewRef.current = effectiveId ? { ...data.view, id: effectiveId } : data.view;

  // This block's persisted style overlay (opaque JSON), looked up by block id.
  const overlayJson = effectiveId ? memo?.nodeOverlays?.[effectiveId] : undefined;
  const overlayJsonRef = useRef(overlayJson);
  overlayJsonRef.current = overlayJson;

  // Cell comments, by sheet name. They live only in the overlay — x-spreadsheet
  // has no comment concept — so they're held here rather than round-tripping
  // through getData(), and spliced into the overlay at commit time.
  const commentsRef = useRef<SheetsComments>(readSheetsComments(parseStyleOverlay(overlayJson)));
  const commentLayerRef = useRef<CommentLayer | null>(null);

  // Pushes the active sheet's comments into the marker layer.
  const refreshComments = useCallback(() => {
    const instance = instanceRef.current;
    const layer = commentLayerRef.current;
    if (!instance || !layer) return;
    const name = currentSheetName(instance, instance.getData() as XSheet[]);
    layer.setComments(commentsRef.current[name] ?? {});
  }, []);
  const refreshCommentsRef = useRef(refreshComments);
  refreshCommentsRef.current = refreshComments;

  useEffect(() => {
    commentsRef.current = readSheetsComments(parseStyleOverlay(overlayJson));
    refreshComments();
  }, [overlayJson, refreshComments]);

  const [menu, setMenu] = useState<MenuState | null>(null);
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Grid viewport height, adjustable by dragging the bottom handle. It is *not*
  // block source config: it's persisted per block in the memo's node_overlays
  // (alongside the cell styles) and restored on the next render. Held in a ref so
  // x-spreadsheet's view.height() callback reads the live value.
  const heightRef = useRef(parseStyleOverlay(overlayJson)?.viewHeight ?? DEFAULT_HEIGHT);
  const [, forceHeightRender] = useState(0);

  // Adopt the persisted height whenever the overlay arrives or changes from
  // elsewhere — the memo often loads after the first render, and a drag in
  // progress isn't affected because the pointer handlers own heightRef then.
  useEffect(() => {
    const persisted = parseStyleOverlay(overlayJson)?.viewHeight ?? DEFAULT_HEIGHT;
    if (persisted === heightRef.current || draggingRef.current) return;
    heightRef.current = persisted;
    window.dispatchEvent(new Event("resize"));
    forceHeightRender((n) => n + 1);
  }, [overlayJson]);

  const startResize = (event: React.PointerEvent) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = heightRef.current;
    draggingRef.current = true;
    const onMove = (e: PointerEvent) => {
      heightRef.current = Math.max(160, Math.min(2000, startHeight + (e.clientY - startY)));
      // x-spreadsheet re-reads view.height() and re-lays-out on window resize.
      window.dispatchEvent(new Event("resize"));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      draggingRef.current = false;
      forceHeightRender((n) => n + 1);
      // Persist the new height into the overlay (no-op when nothing changed).
      if (heightRef.current !== startHeight) commitRef.current();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Opens the AI popover at the given viewport coordinates, anchored to the
  // cell that was selected when the native menu opened. Held in a ref so the
  // imperatively-injected menu item (below) always calls the latest version.
  const openMenuRef = useRef<(mode: MenuState["mode"], x: number, y: number) => void>(() => {});
  openMenuRef.current = (mode, x, y) => {
    const selection = { ...selectionRef.current };
    setMenu({ x, y, selection, mode });
    if (mode === "comment") {
      const instance = instanceRef.current;
      const name = instance ? currentSheetName(instance, instance.getData() as XSheet[]) : "";
      setPrompt(commentsRef.current[name]?.[commentKey(selection.ri, selection.ci)] ?? "");
    } else {
      setPrompt("");
    }
    setError(null);
  };
  const menuLabelsRef = useRef({ ai: "", comment: "", more: "" });
  menuLabelsRef.current = {
    ai: t("markdown.sheets-block.ai-formula"),
    comment: t("markdown.sheets-block.comment"),
    more: t("markdown.sheets-block.more"),
  };

  // Serializes the instance's current data and writes it back into the memo,
  // skipping the no-op case. Shared by the change handler and the AI insert.
  const commitFromInstance = useCallback(() => {
    const instance = instanceRef.current;
    const currentMemo = memoRef.current;
    if (!instance || !currentMemo || !interactiveRef.current) return;

    const raw = instance.getData() as XSheet[];
    // Height and open tab are part of the overlay, so a resize or a tab switch
    // alone is enough to produce one (and to earn the block an id). Both are
    // omitted at their default so an untouched grid stays overlay-free — the
    // first sheet is what loadData opens anyway.
    const overlay = extractSheetsStyle(
      raw,
      {
        viewHeight: heightRef.current === DEFAULT_HEIGHT ? undefined : heightRef.current,
        activeSheet: activeSheetName(instance, raw),
      },
      commentsRef.current,
    );

    // Assign a block id lazily the first time there's something to persist, so
    // plain data blocks never gain an id.
    let view = viewRef.current;
    if (overlay && !view.id) {
      const id = generateBlockId(currentMemo.nodeOverlays ?? {});
      mintedIdRef.current = id;
      view = { ...view, id };
      viewRef.current = view;
    }

    const nextData: SheetsData = { sheets: fromSpreadsheetData(raw), view };
    const newContent = writeSheetsBlock(currentMemo.content, nextData);
    const contentChanged = newContent !== currentMemo.content;

    // Diff the style overlay against what's persisted under this block's id.
    let overlaysChanged = false;
    let nextOverlays = currentMemo.nodeOverlays ?? {};
    if (view.id) {
      const prevJson = nextOverlays[view.id];
      const nextJson = overlay ? serializeStyleOverlay(overlay) : undefined;
      if (nextJson) {
        if (prevJson !== nextJson) {
          nextOverlays = { ...nextOverlays, [view.id]: nextJson };
          overlaysChanged = true;
        }
      } else if (prevJson !== undefined) {
        nextOverlays = { ...nextOverlays };
        delete nextOverlays[view.id];
        overlaysChanged = true;
      }
    }

    if (!contentChanged && !overlaysChanged) return;

    // Record the exact (body, overlay) we're about to persist so the reload
    // effect can recognize the echo of our own write and skip re-loading.
    selfWritten.current = { body: serializeSheets(nextData), overlay: view.id ? nextOverlays[view.id] : undefined };

    const update: Partial<typeof currentMemo> = { name: currentMemo.name };
    const updateMask: string[] = ["update_time"];
    if (contentChanged) {
      update.content = newContent;
      updateMask.push("content");
    }
    if (overlaysChanged) {
      update.nodeOverlays = nextOverlays;
      updateMask.push("node_overlays");
    }
    updateMemo({ update, updateMask });
  }, [updateMemo]);
  const commitRef = useRef(commitFromInstance);
  commitRef.current = commitFromInstance;

  // Instantiate once. x-spreadsheet is imperative, so it lives outside React's
  // render cycle; data sync happens through loadData below.
  useEffect(() => {
    if (!containerRef.current) return;
    // Register fallbacks so an unsupported function renders a marker instead of
    // throwing mid-draw and crashing the page.
    ensureFormulaFallbacks();
    const instance = new Spreadsheet(containerRef.current, {
      mode: interactiveRef.current ? "edit" : "read",
      showToolbar: interactiveRef.current,
      showBottomBar: true,
      // Keep x-spreadsheet's native right-click menu; we append an AI item to it below.
      showContextmenu: true,
      view: {
        height: () => heightRef.current,
        width: () => containerRef.current?.clientWidth ?? 600,
      },
    });

    // x-spreadsheet's own wheel handler (on the inner overlayer) only calls
    // stopPropagation, never preventDefault, so the browser still runs its native
    // scroll on the nearest scrollable ancestor at the same time — the grid's
    // column-by-column move and the page scroll compound into a janky (especially
    // horizontal) feel. We cancel the native scroll so the grid owns the wheel
    // gesture entirely while the cursor is over it.
    //
    // Two things are essential here:
    //  - capture phase: x-spreadsheet's stopPropagation on the child overlayer
    //    would otherwise prevent a bubbling-phase listener from ever seeing the
    //    event; capturing runs host-first, before that stopPropagation.
    //  - passive: false: required for preventDefault to actually cancel scroll.
    //
    // The capture phase also lets us slow horizontal scrolling down. x-spreadsheet
    // moves exactly one whole column per wheel event and ignores the delta
    // magnitude, so a trackpad swipe — which emits a burst of events — flies across
    // the sheet. The step is quantized to a column, so halving means letting only
    // every second horizontal event through: stopPropagation here keeps the event
    // from reaching x-spreadsheet's handler on the child overlayer. Vertical-
    // dominant events are always passed through, leaving row scrolling untouched.
    const host = containerRef.current;

    // x-spreadsheet only re-reads view.width()/height() on a window resize, so a
    // container that changes width on its own (sidebar toggle, pane drag, layout
    // shift after fonts load) leaves the canvas at its construction-time width —
    // a blank strip on the right. Forward element resizes as window resizes.
    let lastWidth = host.clientWidth;
    const resizeObserver = new ResizeObserver(() => {
      const width = host.clientWidth;
      if (width === lastWidth) return;
      lastWidth = width;
      window.dispatchEvent(new Event("resize"));
    });
    resizeObserver.observe(host);

    let horizontalTicks = 0;
    const onWheel = (e: WheelEvent) => {
      // x-spreadsheet's popups (context menu, formula suggestions, sort/filter)
      // render inside the host and scroll themselves via `overflow: auto`. They
      // need the browser's native scrolling, so leave their events completely
      // alone — cancelling here would freeze a menu taller than its viewport.
      if (e.target instanceof Element && e.target.closest(SCROLLABLE_POPUPS)) return;
      e.preventDefault();
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        horizontalTicks += 1;
        if (horizontalTicks % 2 === 1) e.stopPropagation();
      }
    };
    host.addEventListener("wheel", onWheel, { passive: false, capture: true });

    // Persist the open tab when the user switches. x-spreadsheet emits no event
    // for this, so wrap the bottom bar's own swap callback — the switch itself
    // still happens through the original, we just commit afterwards. Switches we
    // make ourselves during a load are skipped: they'd write back the very state
    // we're restoring.
    const bottombar = bottombarOf(instance);
    if (bottombar) {
      const swap = bottombar.swapFunc.bind(bottombar);
      bottombar.swapFunc = (index: number) => {
        swap(index);
        // Comments are per sheet, so the marker layer follows the tab.
        refreshCommentsRef.current();
        if (!loadingRef.current) commitRef.current();
      };
    }

    const commentLayer = createCommentLayer(instance);
    commentLayerRef.current = commentLayer;

    const onSelect = (ri: number, ci: number) => {
      selectionRef.current = { ri, ci };
      commentLayer.setSelection(ri, ci);
    };
    instance.on("cell-selected", (_cell, ri, ci) => onSelect(ri, ci));
    instance.on("cells-selected", (_cell, { sri, sci }) => onSelect(sri, sci));

    // Reshape the native context menu and add our own entries (edit mode only).
    // Built-in items keep working — they're moved, never rebuilt.
    let resetMenu: (() => void) | undefined;
    if (interactiveRef.current && containerRef.current) {
      const menuEl = containerRef.current.querySelector<HTMLElement>(".x-spreadsheet-contextmenu");
      if (menuEl) {
        const restructured = restructureContextMenu(menuEl, menuLabelsRef.current.more);
        resetMenu = restructured?.reset;

        const addItem = (label: string, mode: MenuState["mode"]) => {
          const item = document.createElement("div");
          item.className = "x-spreadsheet-item";
          item.style.cursor = "pointer";
          item.textContent = label;
          // mousedown (not click) fires before x-spreadsheet's clickoutside closes the menu.
          item.addEventListener("mousedown", (event) => {
            event.preventDefault();
            event.stopPropagation();
            const rect = menuEl.getBoundingClientRect();
            menuEl.style.display = "none";
            openMenuRef.current(mode, rect.left, rect.top);
          });
          // With the menu restructured our items sit above the "more" group;
          // without it (unexpected menu shape) they just go at the end.
          if (restructured) menuEl.insertBefore(item, restructured.anchor);
          else menuEl.appendChild(item);
        };
        addItem(`✨ ${menuLabelsRef.current.ai}`, "ai");
        addItem(`💬 ${menuLabelsRef.current.comment}`, "comment");
      }
    }

    // The menu is reused across right-clicks, so collapse the "more" group again
    // each time it opens rather than leaving it however it was last left.
    const onContextMenu = () => resetMenu?.();
    host.addEventListener("contextmenu", onContextMenu, { capture: true });

    const scheduleCommit = () => {
      if (!interactiveRef.current || !memoRef.current) return;
      // Ignore the change events loadData emits for its own writes.
      if (loadingRef.current) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => commitRef.current(), WRITE_DEBOUNCE_MS);
    };
    instance.change(scheduleCommit);
    // Column/row resizes bypass the `change` event entirely, so they need their
    // own hook to reach the same commit path (see resizePatch.ts).
    observeResizes(instance, scheduleCommit);

    instanceRef.current = instance;
    refreshCommentsRef.current();
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      host.removeEventListener("wheel", onWheel, { capture: true });
      host.removeEventListener("contextmenu", onContextMenu, { capture: true });
      resizeObserver.disconnect();
      commentLayer.destroy();
      commentLayerRef.current = null;
      instanceRef.current = null;
      if (containerRef.current) containerRef.current.innerHTML = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load / reload data when the parsed block or its style overlay changes,
  // unless the change is the echo of our own write (matched on both body and
  // overlay). Skipping the echo keeps the active sheet and cursor put — a
  // reload snaps x-spreadsheet back to the first sheet.
  useEffect(() => {
    if (!instanceRef.current) return;
    const body = serializeSheets(data);
    const self = selfWritten.current;
    if (self !== null && body === self.body && overlayJson === self.overlay) {
      selfWritten.current = null;
      return;
    }
    // Fence the load so its own `change` events can't schedule a commit, and drop
    // any commit already queued from a pre-load state (it would be stale anyway).
    loadingRef.current = true;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    try {
      loadWithStyle(instanceRef.current, data, overlayJson);
      // loadData rebuilds the grid (and may restore a different tab), so the
      // markers have to be re-issued for whatever sheet is now showing.
      refreshComments();
    } finally {
      // x-spreadsheet emits change synchronously inside loadData; clear on the
      // next tick to also cover any async follow-up it schedules.
      setTimeout(() => {
        loadingRef.current = false;
      }, 0);
    }
  }, [data, overlayJson, refreshComments]);

  const closeMenu = useCallback(() => {
    setMenu(null);
    setPrompt("");
    setError(null);
    setGenerating(false);
  }, []);

  // Builds the context sent to the model: the target cell reference plus the
  // active sheet rendered as CSV, so the model sees the actual data layout and
  // column contents (capped to keep the prompt bounded).
  const buildContext = (selection: Selection): string => {
    const instance = instanceRef.current;
    const target = cellRef(selection.ri, selection.ci);
    if (!instance) return `Target cell: ${target}`;
    const sheets = fromSpreadsheetData(instance.getData() as XSheet[]);
    const active = sheets[activeSheetIndex(instance)];
    const lines = [`Target cell: ${target}`];
    if (active && active.rows.length > 0) {
      lines.push(`Sheet "${active.name}" data (CSV, first row is the header):`);
      lines.push(serializeSheetCsv(active.rows));
    }
    return lines.join("\n");
  };

  // Writes (or clears, on empty text) the comment for the menu's cell and
  // persists it. The comment lives only in the overlay, so this touches no cell
  // data — commitFromInstance picks it up from commentsRef.
  const handleSaveComment = () => {
    const instance = instanceRef.current;
    if (!menu || !instance) return;
    const name = currentSheetName(instance, instance.getData() as XSheet[]);
    const key = commentKey(menu.selection.ri, menu.selection.ci);
    const text = prompt.trim();
    const sheet = { ...(commentsRef.current[name] ?? {}) };
    if (text === "") delete sheet[key];
    else sheet[key] = text;
    const next = { ...commentsRef.current };
    if (Object.keys(sheet).length > 0) next[name] = sheet;
    else delete next[name];
    commentsRef.current = next;
    refreshComments();
    commitRef.current();
    closeMenu();
  };

  const handleGenerate = async () => {
    const trimmed = prompt.trim();
    if (!menu || trimmed === "" || generating) return;
    const instance = instanceRef.current;
    if (!instance) return;
    const { ri, ci } = menu.selection;
    setGenerating(true);
    setError(null);
    try {
      const formula = await formulaService.generate(trimmed, buildContext(menu.selection));

      // Guard: an unsupported function would crash x-spreadsheet's renderer.
      const bad = unsupportedFunction(formula);
      if (bad) {
        setError(t("markdown.sheets-block.ai-unsupported", { fn: bad }));
        setGenerating(false);
        return;
      }

      // Build the dataset with `value` written into the target cell and load it.
      // loadData is the public, reliable re-render path; the internal reRender()
      // reaches into undefined internals in this version. Returns the nextData so
      // the caller can persist exactly what rendered.
      const applyValue = (value: string): SheetsData => {
        const raw = instance.getData() as XSheet[];
        // Capture live styling so the text-only reload below doesn't wipe it.
        const liveOverlay = extractSheetsStyle(
          raw,
          {
            viewHeight: heightRef.current === DEFAULT_HEIGHT ? undefined : heightRef.current,
            activeSheet: activeSheetName(instance, raw),
          },
          commentsRef.current,
        );
        const sheets = fromSpreadsheetData(raw);
        const idx = activeSheetIndex(instance);
        const active = sheets[idx] ?? { name: "Sheet1", rows: [] };
        const rows = active.rows.map((row) => [...row]);
        while (rows.length <= ri) rows.push([]);
        while (rows[ri].length <= ci) rows[ri].push("");
        rows[ri][ci] = value;
        const nextSheets = sheets.length > 0 ? sheets.map((s, i) => (i === idx ? { ...s, rows } : s)) : [{ name: active.name, rows }];
        const nextData: SheetsData = { sheets: nextSheets, view: viewRef.current };
        loadWithStyle(instance, nextData, liveOverlay ? serializeStyleOverlay(liveOverlay) : undefined);
        return nextData;
      };

      // x-spreadsheet evaluates the formula synchronously during loadData and can
      // still throw despite the guards above (e.g. a shape its parser mishandles).
      // If it does, re-insert the same text with a leading apostrophe so the cell
      // is treated as a literal string — the user sees the formula the model
      // produced instead of a crashed grid.
      let nextData: SheetsData;
      try {
        nextData = applyValue(formula);
      } catch {
        nextData = applyValue("'" + formula);
      }

      // Write straight from nextData rather than re-reading the instance.
      const currentMemo = memoRef.current;
      if (currentMemo) {
        const newContent = writeSheetsBlock(currentMemo.content, nextData);
        if (newContent !== currentMemo.content) {
          // Content-only write; the overlay is unchanged, so record it as-is.
          selfWritten.current = { body: serializeSheets(nextData), overlay: overlayJsonRef.current };
          updateMemo({ update: { name: currentMemo.name, content: newContent }, updateMask: ["content", "update_time"] });
        }
      }
      closeMenu();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setGenerating(false);
    }
  };

  if (data.sheets.length === 0) {
    return <div className="px-1 py-2 text-sm text-muted-foreground">{t("markdown.sheets-block.empty")}</div>;
  }

  return (
    <>
      {/* x-spreadsheet renders to a canvas with hard-coded light colors that CSS
          can't reach, so we pin the whole widget to a stable light "card" — it
          reads as an intentional light panel in dark mode instead of a broken one. */}
      <div className="not-prose overflow-hidden rounded-lg border border-[#e6e6e6] bg-white" style={{ colorScheme: "light" }}>
        <div ref={containerRef} className="x-spreadsheet-host overflow-hidden" />
        {/* Drag this handle to make the grid taller/shorter (show more rows). */}
        <div
          onPointerDown={startResize}
          title={t("markdown.sheets-block.resize")}
          className="flex h-2.5 cursor-ns-resize items-center justify-center border-t border-[#e6e6e6] bg-[#f4f5f8] hover:bg-[#e9eaee]"
        >
          <div className="h-1 w-8 rounded-full bg-[#c6c6c6]" />
        </div>
      </div>
      {menu && (
        <>
          {/* Backdrop closes the menu on outside click. */}
          <div className="fixed inset-0 z-40" onClick={closeMenu} onContextMenu={(e) => e.preventDefault()} />
          <div className="fixed z-50 w-72 rounded-lg border border-border bg-popover p-3 shadow-lg" style={{ left: menu.x, top: menu.y }}>
            <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-foreground">
              {menu.mode === "ai" ? (
                <SparklesIcon className="h-4 w-4 text-primary" />
              ) : (
                <MessageSquareTextIcon className="h-4 w-4 text-primary" />
              )}
              <span>{t(menu.mode === "ai" ? "markdown.sheets-block.ai-formula" : "markdown.sheets-block.comment")}</span>
              <span className="ml-auto text-xs font-normal text-muted-foreground">{cellRef(menu.selection.ri, menu.selection.ci)}</span>
            </div>
            <textarea
              autoFocus
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  if (menu.mode === "ai") handleGenerate();
                  else handleSaveComment();
                }
                if (e.key === "Escape") closeMenu();
              }}
              placeholder={t(menu.mode === "ai" ? "markdown.sheets-block.ai-placeholder" : "markdown.sheets-block.comment-placeholder")}
              rows={menu.mode === "ai" ? 2 : 3}
              className="w-full resize-none rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
            {error && <div className="mt-1 text-xs text-destructive">{error}</div>}
            <div className="mt-2 flex justify-end gap-2">
              <button
                onClick={closeMenu}
                className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {t("common.cancel")}
              </button>
              {menu.mode === "ai" ? (
                <button
                  onClick={handleGenerate}
                  disabled={generating || prompt.trim() === ""}
                  className="rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {generating ? t("markdown.sheets-block.ai-generating") : t("markdown.sheets-block.ai-generate")}
                </button>
              ) : (
                // Saving empty text is the delete path, so one button covers both.
                <button
                  onClick={handleSaveComment}
                  className="rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground hover:bg-primary/90"
                >
                  {t("common.save")}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
};

// A malformed formula can still throw somewhere deep in x-spreadsheet despite the
// formula fallbacks. The boundary keeps that contained to this block — the rest
// of the page (and the editor, so the user can fix the source) stays usable —
// and shows the raw block content as a fallback.
export const SheetsBlock = ({ children, className, blockId }: SheetsBlockProps) => {
  const t = useTranslate();
  const codeContent = extractCodeContent(children);
  const fallback = (
    <div className="not-prose my-2 overflow-hidden rounded-lg border border-destructive/40 bg-destructive/5">
      <div className="px-3 py-1.5 text-xs text-destructive">{t("markdown.sheets-block.render-error")}</div>
      <pre className="overflow-x-auto px-3 py-2 text-sm text-foreground">{codeContent}</pre>
    </div>
  );
  return (
    <ErrorBoundary fallback={fallback}>
      <SheetsBlockInner className={className} blockId={blockId}>
        {children}
      </SheetsBlockInner>
    </ErrorBoundary>
  );
};
