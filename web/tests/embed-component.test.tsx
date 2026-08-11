import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DocumentLinkProvider } from "@/components/MemoContent/DocumentLinkContext";
import { Embed } from "@/components/MemoContent/Embed";
import { EmbedAncestryProvider, MAX_EMBED_DEPTH } from "@/components/MemoContent/EmbedAncestryContext";

vi.mock("@/hooks/useUserQueries", () => ({
  useUsersByUsernames: () => ({ data: new Map() }),
}));

const memos: Record<string, string> = {
  "memos/a": "---\ntitle: A\n---\nBody of A, embedding B: ![[/b.md]]",
  "memos/b": "---\ntitle: B\n---\nBody of B, embedding A: ![[/a.md]]",
  "memos/self": "---\ntitle: Self\n---\nEmbeds itself: ![[/self.md]]",
  "memos/plain": "---\ntitle: Plain\nhidden: true\n---\nJust plain body text.",
};

const pathToName: Record<string, string> = {
  "/a.md": "memos/a",
  "/b.md": "memos/b",
  "/self.md": "memos/self",
  "/plain.md": "memos/plain",
};

vi.mock("@/hooks/useMemoQueries", () => ({
  useMemo: (name: string) => {
    const content = memos[name];
    return {
      data: content ? { name, content } : undefined,
      isLoading: false,
      isError: !content,
    };
  },
}));

const renderEmbed = (target: string, ancestry: string[]) => {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <DocumentLinkProvider value={{ resolve: (href) => pathToName[href], navigate: () => {} }}>
        <EmbedAncestryProvider ancestry={ancestry}>
          <Embed target={target} />
        </EmbedAncestryProvider>
      </DocumentLinkProvider>
    </QueryClientProvider>,
  );
};

describe("<Embed />", () => {
  it("renders the target document's body, with frontmatter stripped", () => {
    renderEmbed("/plain.md", ["memos/root"]);
    expect(screen.getByText("Just plain body text.")).toBeInTheDocument();
    expect(screen.queryByText(/hidden/)).not.toBeInTheDocument();
    expect(screen.queryByText(/title: Plain/)).not.toBeInTheDocument();
  });

  it("shows a not-found notice when the target does not resolve", () => {
    renderEmbed("/missing.md", ["memos/root"]);
    expect(screen.getByText(/未找到文档/)).toBeInTheDocument();
  });

  it("stops recursion and shows a notice when the target is already in the ancestry (direct cycle)", () => {
    renderEmbed("/self.md", ["memos/root", "memos/self"]);
    expect(screen.getByText(/检测到循环引用/)).toBeInTheDocument();
  });

  it("stops recursion for an indirect cycle (A embeds B embeds A)", () => {
    renderEmbed("/a.md", ["memos/root", "memos/a", "memos/b"]);
    expect(screen.getByText(/检测到循环引用/)).toBeInTheDocument();
  });

  it("renders normally when the target is not in the ancestry", () => {
    renderEmbed("/a.md", ["memos/root"]);
    expect(screen.getByText(/Body of A/)).toBeInTheDocument();
  });

  it("stops expanding once the ancestry reaches the max embed depth", () => {
    const deepAncestry = Array.from({ length: MAX_EMBED_DEPTH }, (_, i) => `memos/depth-${i}`);
    renderEmbed("/a.md", deepAncestry);
    expect(screen.getByText(/嵌入层级过深/)).toBeInTheDocument();
  });

  it("still renders when just under the max embed depth", () => {
    const shallowAncestry = Array.from({ length: MAX_EMBED_DEPTH - 1 }, (_, i) => `memos/depth-${i}`);
    renderEmbed("/a.md", shallowAncestry);
    expect(screen.getByText(/Body of A/)).toBeInTheDocument();
  });
});
