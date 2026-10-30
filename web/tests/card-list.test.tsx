import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vitest";
import { List, ListItem } from "@/components/MemoContent/markdown";
import { BulletListStyleContext, CARD_LIST_CLASS } from "@/components/MemoContent/markdown/CardList";

const render = (content: string, style: "plain" | "cards" = "cards"): string =>
  renderToStaticMarkup(
    <BulletListStyleContext.Provider value={style}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          ul: ({ children, ...props }) => <List {...props}>{children}</List>,
          ol: ({ children, ...props }) => (
            <List ordered {...props}>
              {children}
            </List>
          ),
          li: ({ children, ...props }) => <ListItem {...props}>{children}</ListItem>,
        }}
      >
        {content}
      </ReactMarkdown>
    </BulletListStyleContext.Provider>,
  );

describe("card list style", () => {
  it("draws a top-level bullet list as a card, the leading emoji in the square, a chevron for a link", () => {
    const html = render("- 💼 [Career](https://example.com)\n- Life");
    expect(html).toContain(CARD_LIST_CLASS);
    expect(html).toMatch(/<span aria-hidden="true" class="[^"]*">💼<\/span>/);
    expect(html).not.toMatch(/>💼 /);
    expect(html.match(/lucide-chevron-right/g)).toHaveLength(1);
  });

  it("keeps nested, ordered and task lists plain", () => {
    const html = render("- Parent\n  - child\n\n1. one\n\n- [ ] todo");
    expect(html.match(new RegExp(CARD_LIST_CLASS, "g"))).toHaveLength(1);
    expect(html).toContain("list-[circle]");
    expect(html).toContain("<ol");
  });

  it("leaves lists alone in the plain style", () => {
    expect(render("- a\n- b", "plain")).not.toContain(CARD_LIST_CLASS);
  });
});
