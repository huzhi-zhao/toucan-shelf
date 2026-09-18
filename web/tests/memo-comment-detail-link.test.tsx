import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MemoHeader from "@/components/MemoView/components/MemoHeader";

const mockState = vi.hoisted(() => ({
  isInMemoDetailPage: false,
  memo: {
    name: "memos/comment-1",
    parent: "memos/parent-1",
    title: "",
    pinned: false,
    reactions: [],
  },
}));

vi.mock("@/i18n", () => ({ default: { language: "en" } }));

vi.mock("@/utils/i18n", () => ({
  useTranslate: () => (key: string) => key,
}));

vi.mock("@/contexts/NewMemoContext", () => ({
  useNewMemo: () => ({ newMemoName: undefined }),
}));

vi.mock("@/hooks/useNavigateTo", () => ({
  default: () => vi.fn(),
}));

vi.mock("@/components/MemoActionMenu", () => ({
  default: () => null,
}));

vi.mock("@/components/MemoReactionListView", () => ({
  ReactionSelector: () => null,
}));

vi.mock("@/components/UserAvatar", () => ({
  default: () => null,
}));

vi.mock("@/components/VisibilityIcon", () => ({
  default: () => null,
}));

vi.mock("@/components/MemoView/hooks", () => ({
  useMemoActions: () => ({ unpinMemo: vi.fn() }),
}));

vi.mock("@/components/MemoView/MemoViewContext", () => ({
  useMemoViewContext: () => ({
    memo: mockState.memo,
    creator: undefined,
    currentUser: undefined,
    parentPage: "/",
    isArchived: false,
    readonly: false,
    openEditor: vi.fn(),
  }),
  useMemoViewDerived: () => ({
    createTime: undefined,
    updateTime: undefined,
    displayTime: undefined,
    isDisplayingUpdatedTime: false,
    relativeTimeFormat: "auto",
    isInMemoDetailPage: mockState.isInMemoDetailPage,
  }),
}));

describe("<MemoHeader /> comment detail link", () => {
  beforeEach(() => {
    mockState.isInMemoDetailPage = false;
  });

  it("links a comment card to its memo detail page", () => {
    render(
      <MemoryRouter>
        <MemoHeader compact />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "memo.view-detail" })).toHaveAttribute("href", "/memos/comment-1");
  });

  it("hides the link once the comment is already on its detail page", () => {
    mockState.isInMemoDetailPage = true;

    render(
      <MemoryRouter>
        <MemoHeader compact={false} />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("link", { name: "memo.view-detail" })).not.toBeInTheDocument();
  });
});
