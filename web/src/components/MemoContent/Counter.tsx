import { useUpdateMemo } from "@/hooks/useMemoQueries";
import { cn } from "@/lib/utils";
import { incrementCounterAtIndex } from "@/utils/markdown-manipulation";
import { useMemoViewContextOptional } from "../MemoView/MemoViewContext";

interface CounterProps {
  /** Document-order index of this counter, used to address its `- [N]` line in the memo content. */
  counterIndex: number;
  /** The counter's current value, as written in the source. */
  children: string;
}

/**
 * The clickable badge of a `- [N]` counter list item. In a writable memo view a
 * click increments N and persists it back to the memo content; elsewhere (e.g. a
 * read-only view, which supplies no writable MemoViewContext) it's a plain pill.
 */
export const Counter: React.FC<CounterProps> = ({ counterIndex, children }) => {
  const memoViewContext = useMemoViewContextOptional();
  const memo = memoViewContext?.memo;
  const readonly = memoViewContext?.readonly ?? true;
  const { mutate: updateMemo } = useUpdateMemo();
  const writable = !readonly && !!memo && counterIndex >= 0;

  const increment = () => {
    if (!writable) return;

    const newContent = incrementCounterAtIndex(memo.content, counterIndex);
    if (newContent === memo.content) return;

    updateMemo({
      update: { name: memo.name, content: newContent },
      updateMask: ["content", "update_time"],
    });
  };

  return (
    <button
      type="button"
      disabled={!writable}
      onClick={(e) => {
        e.stopPropagation();
        increment();
      }}
      aria-label={`Counter ${children}${writable ? ", click to increment" : ""}`}
      className={cn(
        "inline-flex min-w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 px-1.5 text-sm font-semibold tabular-nums text-primary transition-colors select-none",
        writable ? "cursor-pointer hover:bg-primary/20" : "cursor-default",
      )}
    >
      {children}
    </button>
  );
};
