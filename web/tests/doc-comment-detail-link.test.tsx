import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { CommentCard } from "@/components/DocComments/CommentCard";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";

vi.mock("@/utils/i18n", () => ({
  useTranslate: () => (key: string) => key,
}));

vi.mock("@/components/MemoContent", () => ({
  default: ({ actions }: { actions?: ReactNode }) => <div>{actions}</div>,
}));

vi.mock("@/components/MemoEditor", () => ({
  default: () => null,
}));

describe("<CommentCard /> detail link", () => {
  it("opens the comment memo detail without selecting its document anchor", () => {
    const onSelect = vi.fn();
    const memo = {
      name: "memos/comment-1",
      parent: "memos/parent-1",
      content: "A long Markdown comment",
      snippet: "",
    } as Memo;

    render(
      <MemoryRouter>
        <CommentCard memo={memo} onSelect={onSelect} />
      </MemoryRouter>,
    );

    const link = screen.getByRole("link", { name: "memo.view-detail" });
    expect(link).toHaveAttribute("href", "/memos/comment-1");

    fireEvent.click(link);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
