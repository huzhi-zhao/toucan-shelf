import { type HTMLAttributes, type KeyboardEvent, type SyntheticEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { type SecretCharClass, secretCharClass, splitSecretSegments } from "@/utils/secret-restriction";

// Text in a restricted secret block is drawn on <canvas> rather than rendered as
// DOM text: there is no text node to select, copy, or lift out with the element
// inspector, so the reader types it by hand. This is friction, not secrecy — the
// pixels can still be photographed. See docs/dev/requirements/editor/restricted-secret-block.md.

const MONO_FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';
const SANS_FONT = 'ui-sans-serif, system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';

/** Blocks every way of getting text out of an element by selection or drag. */
export const blockCopyProps: HTMLAttributes<HTMLElement> = {
  onCopy: (event: SyntheticEvent) => event.preventDefault(),
  onCut: (event: SyntheticEvent) => event.preventDefault(),
  onContextMenu: (event: SyntheticEvent) => event.preventDefault(),
  onDragStart: (event: SyntheticEvent) => event.preventDefault(),
};

/** Blocks putting text into a field any way other than typing it. */
export const blockPasteProps: HTMLAttributes<HTMLElement> = {
  ...blockCopyProps,
  onPaste: (event: SyntheticEvent) => event.preventDefault(),
  onDrop: (event: SyntheticEvent) => event.preventDefault(),
};

// Reads the theme's resolved text colour off the element so the canvas follows
// light/dark mode like the text around it. Muted marks reuse it at lower alpha
// rather than reading a custom property, which can come back unresolved.
const foregroundOf = (el: HTMLElement) => getComputedStyle(el).color || "#000";
const MUTED_ALPHA = 0.5;

const prepareCanvas = (canvas: HTMLCanvasElement, width: number, height: number) => {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  // jsdom and some locked-down browsers have no 2D context; draw nothing then.
  const ctx = canvas.getContext?.("2d") ?? null;
  ctx?.setTransform(ratio, 0, 0, ratio, 0, 0);
  return ctx;
};

const wrapLines = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] => {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    for (const ch of Array.from(paragraph)) {
      const next = line + ch;
      if (line !== "" && ctx.measureText(next).width > maxWidth) {
        lines.push(line);
        line = ch;
      } else {
        line = next;
      }
    }
    lines.push(line);
  }
  return lines;
};

interface CanvasTextProps {
  text: string;
  className?: string;
  fontSize?: number;
  mono?: boolean;
}

/**
 * Draws a paragraph of text on a canvas that fills its container's width,
 * wrapping by character so CJK text breaks correctly.
 */
export const CanvasText = ({ text, className, fontSize = 14, mono = false }: CanvasTextProps) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;
    const lineHeight = Math.round(fontSize * 1.6);
    const font = `${fontSize}px ${mono ? MONO_FONT : SANS_FONT}`;
    const probe = canvas.getContext?.("2d") ?? null;
    if (!probe) return;
    probe.font = font;
    const lines = wrapLines(probe, text, width);
    const ctx = prepareCanvas(canvas, width, lines.length * lineHeight);
    if (!ctx) return;
    ctx.font = font;
    ctx.textBaseline = "middle";
    ctx.fillStyle = foregroundOf(canvas);
    lines.forEach((line, i) => ctx.fillText(line, 0, i * lineHeight + lineHeight / 2));
  }, [text, width, fontSize, mono]);

  return (
    <div ref={wrapperRef} className={cn("w-full select-none", className)} {...blockCopyProps}>
      <canvas ref={canvasRef} aria-hidden="true" className="block" />
    </div>
  );
};

const CLASS_LABELS: Record<SecretCharClass, string> = {
  digit: "0-9",
  upper: "A-Z",
  lower: "a-z",
  space: "␣",
  symbol: "#",
  other: "",
};

const CELL_WIDTH = 22;
const CHAR_SIZE = 20;
const SEGMENT_HEIGHT = 44;

const drawSegment = (canvas: HTMLCanvasElement, segment: string, revealed: boolean) => {
  const chars = Array.from(segment);
  const ctx = prepareCanvas(canvas, chars.length * CELL_WIDTH + 8, SEGMENT_HEIGHT);
  if (!ctx) return;
  ctx.fillStyle = foregroundOf(canvas);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  chars.forEach((ch, i) => {
    const x = 4 + i * CELL_WIDTH + CELL_WIDTH / 2;
    if (!revealed) {
      ctx.globalAlpha = MUTED_ALPHA;
      ctx.font = `${CHAR_SIZE}px ${MONO_FONT}`;
      ctx.fillText("•", x, 18);
      return;
    }
    // A pixel of jitter per draw. Cheap, harmless to a human reader, and it keeps
    // two captures of the same segment from being pixel-identical.
    const jx = Math.random() * 2 - 1;
    const jy = Math.random() * 2 - 1;
    ctx.globalAlpha = 1;
    ctx.font = `${CHAR_SIZE}px ${MONO_FONT}`;
    ctx.fillText(ch === " " ? "·" : ch, x + jx, 18 + jy);
    ctx.globalAlpha = MUTED_ALPHA;
    ctx.font = `9px ${SANS_FONT}`;
    ctx.fillText(CLASS_LABELS[secretCharClass(ch)], x, 38);
  });
};

interface SegmentProps {
  segment: string;
  index: number;
  revealed: boolean;
  onReveal: (index: number | null) => void;
  label: string;
}

const Segment = ({ segment, index, revealed, onReveal, label }: SegmentProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvasRef.current) drawSegment(canvasRef.current, segment, revealed);
  }, [segment, revealed]);

  const hide = () => onReveal(null);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      onReveal(index);
    }
  };

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={revealed}
      className={cn(
        "rounded-md border px-0.5 touch-none select-none transition-colors",
        revealed ? "border-primary bg-background" : "border-border bg-muted/40 hover:bg-muted",
      )}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture?.(event.pointerId);
        onReveal(index);
      }}
      onPointerUp={hide}
      onPointerCancel={hide}
      onLostPointerCapture={hide}
      onBlur={hide}
      onKeyDown={onKeyDown}
      onKeyUp={hide}
      {...blockCopyProps}
    >
      <canvas ref={canvasRef} aria-hidden="true" className="block" />
    </button>
  );
};

interface SegmentedSecretProps {
  text: string;
  segmentLabel: (n: number) => string;
  className?: string;
}

/**
 * Shows a secret a few characters at a time: each segment is visible only while
 * it is held down (pointer or Space/Enter). One screenshot captures one segment.
 */
export const SegmentedSecret = ({ text, segmentLabel, className }: SegmentedSecretProps) => {
  const [revealed, setRevealed] = useState<number | null>(null);
  const lines = splitSecretSegments(text);
  let counter = 0;
  return (
    <div className={cn("flex flex-col gap-1.5 select-none", className)} {...blockCopyProps}>
      {lines.map((segments, lineIndex) => (
        <div key={lineIndex} className="flex flex-wrap gap-1.5 min-h-4">
          {segments.map((segment) => {
            const index = counter++;
            return (
              <Segment
                key={index}
                index={index}
                segment={segment}
                revealed={revealed === index}
                onReveal={setRevealed}
                label={segmentLabel(index + 1)}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
};
