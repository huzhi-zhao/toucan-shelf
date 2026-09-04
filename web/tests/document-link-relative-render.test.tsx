import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CrossWorkspaceTarget } from "@/components/MemoContent/DocumentLinkContext";
import { DocumentLinkProvider } from "@/components/MemoContent/DocumentLinkContext";
import { Link } from "@/components/MemoContent/markdown/Link";

/**
 * R1.5 acceptance: how each path form renders once a document-link context is
 * present. The resolution rules themselves are covered by the shared vectors
 * (document-link-resolve-cases.test.ts); this pins the *rendering* consequence,
 * in particular the one place where the two relative forms differ — what
 * happens when they don't resolve.
 */
const resolved: Record<string, string> = {
  "/fa/db.md": "memos/db",
  "./db.md": "memos/db",
  "db.md": "memos/db",
};

const renderLink = (href: string) =>
  render(
    <DocumentLinkProvider value={{ resolve: (h) => resolved[h], navigate: vi.fn() }}>
      <Link href={href}>anchor</Link>
    </DocumentLinkProvider>,
  );

describe("<Link /> with document-relative hrefs", () => {
  it.each([["/fa/db.md"], ["./db.md"], ["db.md"]])("navigates in-app when %s resolves", (href) => {
    renderLink(href);
    const a = screen.getByText("anchor").closest("a")!;
    expect(a).toHaveAttribute("href", "/memos/db");
    expect(a).not.toHaveAttribute("target", "_blank");
  });

  it("marks an unresolvable explicit relative href as broken", () => {
    renderLink("./missing.md");
    const a = screen.getByText("anchor").closest("a")!;
    expect(a).toHaveAttribute("title", "链接的文档不存在，可能已被移动或删除");
    expect(a).not.toHaveAttribute("target", "_blank");
  });

  it("marks an unresolvable root-relative href as broken", () => {
    renderLink("/fa/missing.md");
    expect(screen.getByText("anchor").closest("a")).toHaveAttribute("title", "链接的文档不存在，可能已被移动或删除");
  });

  it("falls back to an external link for an unresolvable BARE relative href", () => {
    // "example.com/page" is a schemeless external destination, not a broken
    // document reference — reporting it as broken would be a regression.
    renderLink("example.com/page");
    const a = screen.getByText("anchor").closest("a")!;
    expect(a).toHaveAttribute("target", "_blank");
    expect(a).not.toHaveAttribute("title");
  });

  it("leaves an @-prefixed href external when the surface has no cross-workspace support", () => {
    // No resolveCrossWorkspace in this provider, so the qualified form gets the
    // same treatment as any other destination this surface cannot resolve.
    renderLink("@产品手册/fb/dc.md");
    expect(screen.getByText("anchor").closest("a")).toHaveAttribute("target", "_blank");
  });

  it("leaves a malformed @-href external even where cross-workspace links are supported", () => {
    // "@handle" has no path, so it never was a document reference.
    renderCrossWorkspaceLink("@handle", () => ({ status: "unavailable" }));
    expect(screen.getByText("anchor").closest("a")).toHaveAttribute("target", "_blank");
  });
});

/**
 * R2.4 acceptance: the three states a workspace-qualified href renders in, plus
 * the pending state while the knowledge-base trees are still being fetched.
 */
const renderCrossWorkspaceLink = (href: string, resolveCrossWorkspace: (h: string) => CrossWorkspaceTarget) =>
  render(
    <DocumentLinkProvider value={{ resolve: () => undefined, navigate: vi.fn(), resolveCrossWorkspace }}>
      <Link href={href}>anchor</Link>
    </DocumentLinkProvider>,
  );

describe("<Link /> with workspace-qualified hrefs", () => {
  it("navigates in-app when the target knowledge base is readable and the path resolves", () => {
    renderCrossWorkspaceLink("@产品手册/fb/dc.md", () => ({
      status: "resolved",
      workspaceName: "workspaces/w2",
      workspaceTitle: "产品手册",
      memoName: "memos/dc",
    }));
    const a = screen.getByText("anchor").closest("a")!;
    expect(a).toHaveAttribute("href", "/memos/dc");
    expect(a).not.toHaveAttribute("target", "_blank");
  });

  it("renders an unreadable knowledge base as a restricted, unclickable marker", () => {
    renderCrossWorkspaceLink("@产品手册/fb/dc.md", () => ({ status: "unavailable" }));
    expect(screen.queryByText("anchor").closest("a")).toBeNull();
    const span = screen.getByText("anchor");
    expect(span).toHaveAttribute("title", "无法访问该知识库");
    // Nothing about the target may reach the DOM — not its title, not its path.
    expect(document.body.innerHTML).not.toContain("产品手册");
    expect(document.body.innerHTML).not.toContain("fb/dc.md");
  });

  it("marks a readable knowledge base with an unresolvable path as broken", () => {
    renderCrossWorkspaceLink("@产品手册/fb/missing.md", () => ({ status: "unresolved" }));
    expect(screen.getByText("anchor").closest("a")).toHaveAttribute("title", "链接的文档不存在，可能已被移动或删除");
  });

  it("renders as plain text while the trees are still being fetched", () => {
    renderCrossWorkspaceLink("@产品手册/fb/dc.md", () => ({ status: "pending" }));
    expect(screen.getByText("anchor").closest("a")).toBeNull();
  });
});
