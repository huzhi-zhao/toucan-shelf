import { renderToString } from "react-dom/server";
import Markdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vitest";
import { SANITIZE_SCHEMA } from "@/components/MemoContent/constants";
import { remarkCodeFold } from "@/utils/remark-plugins/remark-code-fold";

// Renders markdown through the same rehype-raw + rehype-sanitize pipeline the app
// uses and returns the <code> element's props, as CodeBlock (the `pre` component)
// would see them.
function renderCodeProps(md: string): Record<string, unknown> {
  let props: Record<string, unknown> = {};
  renderToString(
    <Markdown
      remarkPlugins={[remarkGfm, remarkCodeFold]}
      rehypePlugins={[rehypeRaw, [rehypeSanitize, SANITIZE_SCHEMA]]}
      components={{
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pre: ({ children }: any) => {
          const code = Array.isArray(children) ? children[0] : children;
          props = code?.props ?? {};
          return <pre />;
        },
      }}
    >
      {md}
    </Markdown>,
  );
  return props;
}

describe("code fence fold token → data-fold", () => {
  // Same chain as remark-sheets-id: the fence's raw `meta` lives on the mdast
  // node's `data`, which rehype-raw strips. The token only reaches CodeBlock
  // because the plugin promotes it to a real attribute AND SANITIZE_SCHEMA
  // whitelists it (as the camelCased hast properties `dataFold`/`dataFoldTitle`).
  it("survives rehype-raw and rehype-sanitize", () => {
    const props = renderCodeProps("```ts fold\nconst a = 1;\n```\n");
    expect(props["data-fold"]).toBe("closed");
    expect(props.className).toBe("language-ts");
  });

  it("honours an explicit open/closed state", () => {
    expect(renderCodeProps("```ts fold=open\nconst a = 1;\n```\n")["data-fold"]).toBe("open");
    expect(renderCodeProps("```ts fold=closed\nconst a = 1;\n```\n")["data-fold"]).toBe("closed");
  });

  it("carries an optional header title", () => {
    const props = renderCodeProps('```ts fold title="工具函数"\nconst a = 1;\n```\n');
    expect(props["data-fold"]).toBe("closed");
    expect(props["data-fold-title"]).toBe("工具函数");
  });

  it("emits nothing without the token", () => {
    const props = renderCodeProps("```ts\nconst a = 1;\n```\n");
    expect(props["data-fold"]).toBeUndefined();
    expect(props["data-fold-title"]).toBeUndefined();
  });

  it("does not match a token that merely starts with fold", () => {
    const props = renderCodeProps("```ts folding\nconst a = 1;\n```\n");
    expect(props["data-fold"]).toBeUndefined();
  });
});
