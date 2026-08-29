import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

  it("leaves an @-prefixed href external (reserved for the workspace-qualified form)", () => {
    renderLink("@产品手册/fb/dc.md");
    expect(screen.getByText("anchor").closest("a")).toHaveAttribute("target", "_blank");
  });
});
