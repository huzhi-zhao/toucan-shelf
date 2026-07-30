import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { type ActiveFormatState, EMPTY_ACTIVE_FORMATS } from "@/components/MemoEditor/formatting/commands";
import { FormattingToolbar } from "@/components/MemoEditor/Toolbar/FormattingToolbar";
import type { EditorController } from "@/components/MemoEditor/types/editorController";
import { isLocalSecretId, parseSecretBlock } from "@/utils/secret-block";

// Match the repo convention: t echoes the i18n key (no i18next backend in tests),
// so accessible names below are the keys themselves.
vi.mock("@/utils/i18n", () => ({ useTranslate: () => (key: string) => key }));

// Radix DropdownMenu reaches for layout/pointer APIs jsdom doesn't implement.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

function makeController(opts: { active?: Partial<ActiveFormatState>; getSelectedText?: () => string } = {}) {
  const run = vi.fn();
  const activeFormats: ActiveFormatState = { ...EMPTY_ACTIVE_FORMATS, ...opts.active };
  const controller: EditorController = {
    focus: () => {},
    hasFocus: () => false,
    isEmpty: () => true,
    getMarkdown: () => "",
    setMarkdown: () => {},
    insertMarkdown: vi.fn(),
    scrollToCursor: () => {},
    selectAll: () => {},
    formatting: {
      run,
      getActiveFormats: () => activeFormats,
      getSelectedText: opts.getSelectedText ?? (() => ""),
      subscribe: () => () => {},
    },
  };
  return { controller, run };
}

function renderToolbar(controller: EditorController, onExit = vi.fn()) {
  const ref = createRef<EditorController>();
  ref.current = controller;
  render(<FormattingToolbar controllerRef={ref} onExit={onExit} />);
  return { onExit };
}

describe("FormattingToolbar", () => {
  it("runs the bold command when the bold button is clicked", () => {
    const { controller, run } = makeController();
    renderToolbar(controller);
    fireEvent.click(screen.getByRole("button", { name: "editor.format.bold" }));
    expect(run).toHaveBeenCalledWith("bold");
  });

  it("runs the heading command when a heading level is chosen", () => {
    const { controller, run } = makeController();
    renderToolbar(controller);
    // Keyboard open is the most reliable path for Radix menus in jsdom.
    fireEvent.keyDown(screen.getByRole("button", { name: "editor.format.heading" }), { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitem", { name: "editor.format.heading-2" }));
    expect(run).toHaveBeenCalledWith("heading2");
  });

  it("reflects active marks via aria-pressed", () => {
    const { controller } = makeController({ active: { bold: true } });
    renderToolbar(controller);
    expect(screen.getByRole("button", { name: "editor.format.bold" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "editor.format.italic" })).toHaveAttribute("aria-pressed", "false");
  });

  // The inserted block is a placeholder with a local id; the passphrase is set in
  // the preview, so no plaintext ever passes through the editor's own state.
  it("inserts an uninitialized secret block from the collapsible menu", () => {
    const { controller } = makeController();
    renderToolbar(controller);
    fireEvent.keyDown(screen.getByRole("button", { name: "editor.collapsible.trigger" }), { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitem", { name: "editor.secret.block" }));

    const inserted = vi.mocked(controller.insertMarkdown).mock.calls[0][0];
    const ref = parseSecretBlock(inserted.replace(/^\n```toucan-secret\n|\n```\n$/g, ""));
    expect(ref).not.toBeNull();
    expect(isLocalSecretId(ref?.id ?? "")).toBe(true);
  });

  it("calls onExit when the exit button is clicked", () => {
    const { controller } = makeController();
    const { onExit } = renderToolbar(controller);
    fireEvent.click(screen.getByRole("button", { name: "editor.exit-focus-mode" }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
