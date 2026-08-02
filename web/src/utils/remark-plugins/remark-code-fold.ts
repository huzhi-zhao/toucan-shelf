import type { Code, Root } from "mdast";
import { visit } from "unist-util-visit";

// Promotes a fenced block's `fold` info-string token to real `data-fold` /
// `data-fold-title` attributes on the emitted <code> element.
//
// Why a plugin: react-markdown exposes the fence meta as the mdast code node's
// `meta`, but that lives on `node.data`, which `rehype-raw` strips when it
// reserializes the tree. Routing it through `data.hProperties` turns it into an
// actual HTML attribute, which survives rehype-raw (and rehype-sanitize, once
// whitelisted). CodeBlock reads it back to render the collapse toggle.
//
// Syntax: ```ts fold             — collapsed on first render
//         ```ts fold=open        — toggle shown, expanded on first render
//         ```ts fold title="xxx" — custom header label
const FOLD_RE = /(?:^|\s)fold(?:=(open|closed))?(?=\s|$)/;
const TITLE_RE = /(?:^|\s)title="([^"]*)"/;

export const remarkCodeFold = () => {
  return (tree: Root) => {
    visit(tree, "code", (node: Code) => {
      if (!node.meta) return;
      const fold = FOLD_RE.exec(node.meta);
      if (!fold) return;
      const data = (node.data ??= {});
      const hProperties = ((data as { hProperties?: Record<string, unknown> }).hProperties ??= {});
      hProperties["data-fold"] = fold[1] ?? "closed";
      const title = TITLE_RE.exec(node.meta);
      if (title) {
        hProperties["data-fold-title"] = title[1];
      }
    });
  };
};
