import { LoaderCircleIcon, SparklesIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { useTranslate } from "@/utils/i18n";
import { type PolishPreset, polishService } from "../services/polishService";
import type { EditorController } from "../types/editorController";
import { PolishDiffDialog } from "./PolishDiffDialog";

const PRESETS: PolishPreset[] = ["polish", "concise", "expand", "grammar", "tone", "translate"];

interface Anchor {
  left: number;
  top: number;
}

/**
 * Floating "AI" affordance that appears above a non-empty editor selection.
 * Clicking it opens a popover with rewrite presets and a custom-instruction
 * box. Clicking a preset only selects/deselects it (no request fires yet),
 * so the instruction box can still add detail a preset alone can't express
 * (e.g. target language for "translate", a style note for "tone") — or the
 * box can be used alone with no preset selected. "Rewrite" sends the request
 * and opens a diff review (PolishDiffDialog) — nothing reaches the document
 * until the user applies it, and each change block can be taken or dropped.
 */
export function AISelectionToolbar({ editorRef }: { editorRef: React.RefObject<EditorController | null> }) {
  const t = useTranslate();
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [custom, setCustom] = useState("");
  const [selectedPreset, setSelectedPreset] = useState<PolishPreset | null>(null);
  // Snapshot of the selection when the popover opened, so an async rewrite acts
  // on the intended span even if focus/selection shift while the request runs.
  const targetRef = useRef<{ from: number; to: number; text: string } | null>(null);
  // Pending rewrite awaiting review; the range is the snapshot it was made from.
  const [review, setReview] = useState<{ from: number; to: number; original: string; revised: string } | null>(null);
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    const controller = editorRef.current;
    const subscribe = controller?.formatting?.subscribe;
    if (!controller || !subscribe) return;
    const update = () => {
      // Keep the toolbar anchored while its popover is open, even if the
      // editor briefly reports an empty selection (e.g. focus moved to the input).
      if (openRef.current) return;
      const coords = controller.getSelectionCoords();
      if (!coords || controller.getSelection().text.trim() === "") {
        setAnchor(null);
        return;
      }
      setAnchor({ left: (coords.left + coords.right) / 2, top: coords.top });
    };
    update();
    return subscribe(update);
  }, [editorRef]);

  const runRewrite = async () => {
    const controller = editorRef.current;
    const target = targetRef.current ?? controller?.getSelection() ?? null;
    const text = target?.text ?? "";
    if (!controller || !target || text.trim() === "") return;
    const instruction = custom.trim();
    if (!selectedPreset && instruction === "") return;
    setLoading(true);
    try {
      const result = await polishService.polish(text, { preset: selectedPreset ?? undefined, instruction: instruction || undefined });
      setReview({ from: target.from, to: target.to, original: text, revised: result });
      setOpen(false);
      setCustom("");
      setSelectedPreset(null);
      setAnchor(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("editor.polish.error"));
    } finally {
      setLoading(false);
    }
  };

  const dialog = review ? (
    <PolishDiffDialog
      open
      original={review.original}
      revised={review.revised}
      onOpenChange={(next) => {
        if (!next) setReview(null);
      }}
      onApply={(text) => {
        editorRef.current?.replaceRange(review.from, review.to, text);
        setReview(null);
        targetRef.current = null;
      }}
    />
  ) : null;

  if (!anchor) return dialog;

  return (
    <>
      <div className="fixed z-50 -translate-x-1/2 -translate-y-full pb-1" style={{ left: anchor.left, top: anchor.top }}>
        <Popover
          open={open}
          onOpenChange={(next) => {
            if (next) targetRef.current = editorRef.current?.getSelection() ?? null;
            setOpen(next);
            if (!next) {
              setSelectedPreset(null);
              setCustom("");
            }
          }}
        >
          <PopoverTrigger asChild>
            <Button size="sm" variant="secondary" className="h-7 gap-1 px-2 shadow-md" onMouseDown={(e) => e.preventDefault()}>
              <SparklesIcon className="size-3.5" />
              {t("editor.polish.trigger")}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="center" side="top" className="w-64 p-2" onOpenAutoFocus={(e) => e.preventDefault()}>
            <div className="flex flex-col gap-1">
              {PRESETS.map((preset) => (
                <Button
                  key={preset}
                  size="sm"
                  variant={selectedPreset === preset ? "secondary" : "ghost"}
                  disabled={loading}
                  className="h-8 justify-start"
                  onClick={() => setSelectedPreset((current) => (current === preset ? null : preset))}
                >
                  {t(`editor.polish.preset.${preset}`)}
                </Button>
              ))}
              <div className="mt-1 flex flex-col gap-1.5 border-t pt-2">
                <Textarea
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  placeholder={
                    selectedPreset === "translate"
                      ? t("editor.polish.custom-placeholder-translate")
                      : selectedPreset === "tone"
                        ? t("editor.polish.custom-placeholder-tone")
                        : t("editor.polish.custom-placeholder")
                  }
                  rows={2}
                  disabled={loading}
                  className="resize-none text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && (selectedPreset || custom.trim())) {
                      e.preventDefault();
                      void runRewrite();
                    }
                  }}
                />
                <Button
                  size="sm"
                  disabled={loading || (!selectedPreset && custom.trim() === "")}
                  className="h-8"
                  onClick={() => runRewrite()}
                >
                  {loading ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : null}
                  {loading ? t("editor.polish.loading") : t("editor.polish.run")}
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
      {dialog}
    </>
  );
}
