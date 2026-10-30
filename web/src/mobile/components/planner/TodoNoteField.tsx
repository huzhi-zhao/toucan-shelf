import { type MouseEvent, useLayoutEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import { cn } from "@/lib/utils";
import { COPY } from "../../copy";

// The few Markdown elements a todo note renders (requirement §2.4.2 §7); anything else shows as its text.
const ALLOWED_ELEMENTS = ["p", "br", "strong", "em", "code", "a", "ul", "ol", "li"];

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Called when the text field loses focus after typing: the moment to save. */
  onCommit: () => void;
  /** Read and copy only: a second tap does not start typing. */
  readOnly?: boolean;
}

/**
 * A todo's note in three steps: read, select, type. It shows as rendered Markdown, fully, its height
 * following the text. A tap turns it into the plain text in a field that does not bring up the keyboard,
 * for scrolling and copying; a second tap starts typing. Leaving the field saves and shows it rendered again.
 */
export default function TodoNoteField({ value, onChange, onCommit, readOnly = false }: Props) {
  const [mode, setMode] = useState<"view" | "select" | "type">("view");
  // Set inside the second tap, before the field is refocused: its blur must not end the editing.
  const switching = useRef(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  // The field grows with its text instead of scrolling inside the page.
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field || mode === "view") return;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  }, [value, mode]);

  const select = () => {
    setMode("select");
    // Focused while read-only: selectable without a keyboard, and a tap elsewhere blurs it back to the view.
    requestAnimationFrame(() => fieldRef.current?.focus({ preventScroll: true }));
  };

  const startTyping = (event: MouseEvent<HTMLTextAreaElement>) => {
    if (mode !== "select" || readOnly) return;
    const field = event.currentTarget;
    // iOS shows the keyboard only for a focus made inside the tap, and not for a field already focused.
    switching.current = true;
    field.readOnly = false;
    field.blur();
    field.focus();
    switching.current = false;
    setMode("type");
  };

  const leave = () => {
    if (switching.current) return;
    if (mode === "type") onCommit();
    setMode("view");
  };

  if (mode === "view") {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={select}
        onKeyDown={(event) => event.key === "Enter" && select()}
        className="todo-note min-h-[1.5em] text-[16px] leading-relaxed break-words"
      >
        {value.trim() ? (
          <ReactMarkdown
            remarkPlugins={[remarkBreaks]}
            allowedElements={ALLOWED_ELEMENTS}
            unwrapDisallowed
            components={{
              a: ({ href, children }) => (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline"
                  onClick={(event) => event.stopPropagation()}
                >
                  {children}
                </a>
              ),
              ul: ({ children }) => <ul className="list-disc pl-5 [&:not(:first-child)]:mt-2">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal pl-5 [&:not(:first-child)]:mt-2">{children}</ol>,
              p: ({ children }) => <p className="[&:not(:first-child)]:mt-2">{children}</p>,
              code: ({ children }) => <code className="rounded bg-black/5 dark:bg-white/10 px-1 text-[14px]">{children}</code>,
            }}
          >
            {value}
          </ReactMarkdown>
        ) : (
          <span className="text-black/30 dark:text-white/30">{COPY.todo.notePlaceholder}</span>
        )}
      </div>
    );
  }

  return (
    <textarea
      ref={fieldRef}
      rows={1}
      readOnly={mode === "select"}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onClick={startTyping}
      onBlur={leave}
      className={cn("block w-full bg-transparent outline-none resize-none overflow-hidden text-[16px] leading-relaxed")}
    />
  );
}
