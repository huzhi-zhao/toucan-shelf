import type { Element } from "hast";
import "katex/dist/katex.min.css";
import { useMemo } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkBreaks from "remark-breaks";
import remarkCjkFriendly from "remark-cjk-friendly/parseOnly";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { useSoftBreakDefault } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import {
  getAlertFold,
  getAlertIcon,
  getAlertTags,
  getAlertTitle,
  getAlertType,
  isMentionElement,
  isTagElement,
  isTaskListItemElement,
} from "@/types/markdown";
import { type MemoProperty, parseFrontmatter } from "@/utils/frontmatter";
import { rehypeHeadingId } from "@/utils/rehype-plugins/rehype-heading-id";
import { remarkAlert } from "@/utils/remark-plugins/remark-alert";
import { remarkCodeFold } from "@/utils/remark-plugins/remark-code-fold";
import { remarkCounter } from "@/utils/remark-plugins/remark-counter";
import { remarkDisableSetext } from "@/utils/remark-plugins/remark-disable-setext";
import { remarkHighlight } from "@/utils/remark-plugins/remark-highlight";
import { remarkMention } from "@/utils/remark-plugins/remark-mention";
import { remarkPreserveType } from "@/utils/remark-plugins/remark-preserve-type";
import { remarkSheetsId } from "@/utils/remark-plugins/remark-sheets-id";
import { remarkSplitMixedTaskLists } from "@/utils/remark-plugins/remark-split-mixed-task-lists";
import { remarkTag } from "@/utils/remark-plugins/remark-tag";
import { remarkTaskStatus } from "@/utils/remark-plugins/remark-task-status";
import { CodeBlock } from "./CodeBlock";
import { SANITIZE_SCHEMA } from "./constants";
import { MarkdownRenderContext, rootMarkdownRenderContext } from "./MarkdownRenderContext";
import { Mention } from "./Mention";
import { Alert, AnchorLink, Blockquote, Heading, HorizontalRule, Image, InlineCode, Link, List, ListItem, Paragraph } from "./markdown";
import { PropertiesPanel } from "./PropertiesPanel";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "./Table";
import { Tag } from "./Tag";
import { TaskListItem } from "./TaskListItem";
import { TrustedIframe } from "./TrustedIframe";

interface MemoMarkdownRendererProps {
  content: string;
  resolvedMentionUsernames: Set<string>;
  /** Resource name of the memo (e.g. `memos/abc123`), used to target footnote links at the detail page. */
  memoName?: string;
  /** Whether the memo is rendered as a collapsed feed card. */
  compact?: boolean;
  /** Prefix for heading ids, to keep them unique across multi-snippet documents (e.g. gallery View blocks). */
  headingIdPrefix?: string;
  /** When set, the properties panel becomes editable and reports value changes through this callback. */
  onPropertyChange?: (key: string, value: MemoProperty["value"]) => void;
  /** Whether the properties panel renders; omitted, it falls back to the deprecated `hidden` key. */
  showProperties?: boolean;
  /**
   * Whether a single newline is a soft wrap (CommonMark) rather than a hard line break.
   * Omitted, it follows the author's global default — see `DocConfig.softBreak`.
   */
  softBreak?: boolean;
}

function getMentionUsername(node: Element, children?: React.ReactNode): string {
  const dataMention = node.properties?.["data-mention"];
  if (typeof dataMention === "string" && dataMention !== "") {
    return dataMention;
  }

  const camelDataMention = (node.properties as Record<string, unknown> | undefined)?.dataMention;
  if (typeof camelDataMention === "string" && camelDataMention !== "") {
    return camelDataMention;
  }

  const text = Array.isArray(children) ? children.join("") : children;
  if (typeof text === "string" && text.startsWith("@")) {
    return text.slice(1).toLowerCase();
  }

  return "";
}

export const MemoMarkdownRenderer = ({
  content,
  resolvedMentionUsernames,
  memoName,
  compact,
  headingIdPrefix,
  onPropertyChange,
  showProperties,
  softBreak,
}: MemoMarkdownRendererProps) => {
  // Split off any leading Obsidian-style frontmatter: compliant properties render
  // as a read-only panel above the body, and the raw `---` block never reaches
  // the markdown pipeline (where it would otherwise show as horizontal rules).
  const { properties, body } = useMemo(() => parseFrontmatter(content), [content]);
  const softBreakDefault = useSoftBreakDefault();
  // remark-breaks turns every newline into a `<br>`. That is what someone typing a
  // note expects and the opposite of what CommonMark says, so it is the one plugin
  // in this pipeline a document can switch off.
  const hardBreaks = !(softBreak ?? softBreakDefault);
  const remarkPlugins = useMemo(
    () => [
      remarkDisableSetext,
      remarkMath,
      remarkGfm,
      // 让 **加粗：**中文 这类紧贴中文标点的强调也能识别（CommonMark 原规则会失败）
      remarkCjkFriendly,
      remarkTaskStatus,
      remarkSplitMixedTaskLists,
      ...(hardBreaks ? [remarkBreaks] : []),
      remarkMention,
      remarkTag,
      remarkCounter,
      remarkHighlight,
      remarkAlert,
      remarkSheetsId,
      remarkCodeFold,
      remarkPreserveType,
    ],
    [hardBreaks],
  );

  const markdownComponents: Components = {
    input: ({ node, ...inputProps }) => {
      if (node && isTaskListItemElement(node)) {
        return <TaskListItem {...inputProps} node={node} />;
      }
      return <input {...inputProps} />;
    },
    span: ({ node, ...spanProps }) => {
      if (node && isMentionElement(node)) {
        const username = getMentionUsername(node, spanProps.children);
        return <Mention {...spanProps} node={node} data-mention={username} resolved={resolvedMentionUsernames.has(username)} />;
      }
      if (node && isTagElement(node)) {
        return <Tag {...spanProps} node={node} />;
      }
      return <span {...spanProps} />;
    },
    h1: ({ children, ...props }) => (
      <Heading level={1} {...props}>
        {children}
      </Heading>
    ),
    h2: ({ children, ...props }) => (
      <Heading level={2} {...props}>
        {children}
      </Heading>
    ),
    h3: ({ children, ...props }) => (
      <Heading level={3} {...props}>
        {children}
      </Heading>
    ),
    h4: ({ children, ...props }) => (
      <Heading level={4} {...props}>
        {children}
      </Heading>
    ),
    h5: ({ children, ...props }) => (
      <Heading level={5} {...props}>
        {children}
      </Heading>
    ),
    h6: ({ children, ...props }) => (
      <Heading level={6} {...props}>
        {children}
      </Heading>
    ),
    p: ({ children, ...props }) => <Paragraph {...props}>{children}</Paragraph>,
    blockquote: ({ children, node, ...props }) => {
      const alertType = node && getAlertType(node);
      if (alertType) {
        return (
          <Alert
            {...props}
            node={node}
            alertType={alertType}
            alertIcon={getAlertIcon(node)}
            alertTitle={getAlertTitle(node)}
            alertFold={getAlertFold(node)}
            alertTags={getAlertTags(node)}
          >
            {children}
          </Alert>
        );
      }
      return (
        <Blockquote {...props} node={node}>
          {children}
        </Blockquote>
      );
    },
    hr: (props) => <HorizontalRule {...props} />,
    ul: ({ children, ...props }) => <List {...props}>{children}</List>,
    ol: ({ children, ...props }) => (
      <List ordered {...props}>
        {children}
      </List>
    ),
    li: ({ children, ...props }) => <ListItem {...props}>{children}</ListItem>,
    a: ({ children, href, ...props }) => {
      // In-page anchors (footnote refs/backrefs, heading links) navigate within the memo rather
      // than opening a new tab; everything else is treated as an external link.
      if (typeof href === "string" && href.startsWith("#")) {
        return (
          <AnchorLink href={href} memoName={memoName} compact={compact} {...props}>
            {children}
          </AnchorLink>
        );
      }
      return (
        <Link href={href} {...props}>
          {children}
        </Link>
      );
    },
    code: ({ children, ...props }) => <InlineCode {...props}>{children}</InlineCode>,
    mark: ({ children, className, ...props }) => (
      <mark
        className={cn(
          // `text-foreground` is not decoration: the UA stylesheet gives <mark> `color: MarkText`
          // (near-black) and only the background was being overridden here, so in dark mode the
          // highlight was black text on a dark fill. Inheriting the page's own colour also keeps
          // bold text inside a highlight reading as bold, at the same weight it has outside one.
          "rounded-sm px-0.5 text-foreground",
          // A lighter wash than before. The fill's job is to point at the passage, not to compete
          // with it — at the old strength it flattened the contrast between bold and plain text
          // running through it.
          typeof className === "string" && className.includes("highlight-pink")
            ? "bg-pink-200/50 dark:bg-pink-500/25"
            : "bg-yellow-200/50 dark:bg-yellow-500/25",
        )}
        {...props}
      >
        {children}
      </mark>
    ),
    iframe: TrustedIframe,
    img: (props) => <Image {...props} />,
    pre: CodeBlock,
    table: ({ children, ...props }) => <Table {...props}>{children}</Table>,
    thead: ({ children, ...props }) => <TableHead {...props}>{children}</TableHead>,
    tbody: ({ children, ...props }) => <TableBody {...props}>{children}</TableBody>,
    tr: ({ children, ...props }) => <TableRow {...props}>{children}</TableRow>,
    th: ({ children, ...props }) => <TableHeaderCell {...props}>{children}</TableHeaderCell>,
    td: ({ children, ...props }) => <TableCell {...props}>{children}</TableCell>,
  };

  return (
    <MarkdownRenderContext.Provider value={rootMarkdownRenderContext}>
      <PropertiesPanel properties={properties} onChange={onPropertyChange} visible={showProperties} />
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={[
          rehypeRaw,
          [rehypeSanitize, SANITIZE_SCHEMA],
          [rehypeHeadingId, { prefix: headingIdPrefix ?? "" }],
          [rehypeKatex, { throwOnError: false, strict: false }],
        ]}
        components={markdownComponents}
      >
        {body}
      </ReactMarkdown>
    </MarkdownRenderContext.Provider>
  );
};
