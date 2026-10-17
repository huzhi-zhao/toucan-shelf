import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BlockPlaceholderProvider } from "@/components/MemoContent/BlockPlaceholderContext";
import { CodeBlock } from "@/components/MemoContent/CodeBlock";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ userGeneralSetting: undefined }) }));

const fence = (language: string, body: string) => (
  <CodeBlock>
    <code className={`language-${language}`}>{body}</code>
  </CodeBlock>
);

const placeholders = { languages: new Set(["kanban"]), render: (language: string) => <aside>{`placeholder:${language}`}</aside> };

describe("BlockPlaceholderContext", () => {
  it("replaces a listed block with the surface's placeholder", () => {
    const html = renderToString(<BlockPlaceholderProvider value={placeholders}>{fence("kanban", "## Todo\n- a")}</BlockPlaceholderProvider>);
    expect(html).toContain("placeholder:kanban");
  });

  it("leaves other blocks alone", () => {
    const html = renderToString(<BlockPlaceholderProvider value={placeholders}>{fence("ts", "const a = 1;")}</BlockPlaceholderProvider>);
    expect(html).not.toContain("placeholder");
    expect(html).toContain("const");
  });

  it("changes nothing where no surface provides it", () => {
    expect(renderToString(fence("ts", "const a = 1;"))).not.toContain("placeholder");
  });
});
