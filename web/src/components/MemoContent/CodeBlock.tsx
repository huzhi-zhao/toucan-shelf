import copy from "copy-to-clipboard";
import hljs from "highlight.js";
import { CheckIcon, ChevronRightIcon, CopyIcon } from "lucide-react";
import { isValidElement, type ReactElement, type ReactNode, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { markdownStyles } from "@/lib/markdownStyles";
import { cn } from "@/lib/utils";
import { SECRET_BLOCK_LANGUAGE } from "@/utils/secret-block";
import { getThemeWithFallback, resolveTheme } from "@/utils/theme";
import { CalendarBlock } from "./CalendarBlock";
import { GridBlock } from "./GridBlock";
import { KanbanBlock } from "./KanbanBlock";
import { MermaidBlock } from "./MermaidBlock";
import type { ReactMarkdownProps } from "./markdown/types";
import { SecretBlock } from "./SecretBlock";
import { SheetsBlock } from "./SheetsBlock";

import { extractCodeContent, extractLanguage } from "./utils";

interface CodeBlockProps extends ReactMarkdownProps {
  children?: ReactNode;
  className?: string;
}

export const CodeBlock = ({ children, className, node: _node, ...props }: CodeBlockProps) => {
  const { userGeneralSetting } = useAuth();
  const [copied, setCopied] = useState(false);

  const codeElement = isValidElement(children) ? (children as ReactElement<{ className?: string }>) : null;
  const codeClassName = codeElement?.props.className || "";
  const codeContent = extractCodeContent(children);
  const language = extractLanguage(codeClassName).toLowerCase();

  // Collapse state comes from the fence info string (```ts fold / fold=open /
  // title="xxx"), promoted to real attributes by remark-code-fold. Only plain
  // code blocks honour it — the special blocks below (mermaid/sheets/…) return
  // early and render their own chrome.
  const foldProps = codeElement?.props as { "data-fold"?: string; "data-fold-title"?: string } | undefined;
  const foldMode = foldProps?.["data-fold"];
  const foldTitle = foldProps?.["data-fold-title"];
  // Must be declared with the other hooks, above the early returns — see the note below.
  const [collapsed, setCollapsed] = useState(foldMode === "closed");

  const theme = getThemeWithFallback(userGeneralSetting?.theme);
  const resolvedTheme = resolveTheme(theme);
  const isDarkTheme = resolvedTheme.includes("dark");

  // Dynamically load highlight.js theme based on app theme.
  // NOTE: this and the highlight useMemo below must run unconditionally (before the
  // special-block early returns) so the hook count stays stable across re-renders.
  // Otherwise switching a code block between a special type (mermaid/kanban/etc.) and a
  // plain block on the same tree position throws React error #310.
  useEffect(() => {
    const dynamicImportStyle = async () => {
      // Remove any existing highlight.js style
      const existingStyle = document.querySelector("style[data-hljs-theme]");
      if (existingStyle) {
        existingStyle.remove();
      }

      try {
        const cssModule = isDarkTheme
          ? await import("highlight.js/styles/github-dark-dimmed.css?inline")
          : await import("highlight.js/styles/github.css?inline");

        // Create and inject the style
        const style = document.createElement("style");
        style.textContent = cssModule.default;
        style.setAttribute("data-hljs-theme", isDarkTheme ? "dark" : "light");
        document.head.appendChild(style);
      } catch (error) {
        console.warn("Failed to load highlight.js theme:", error);
      }
    };

    dynamicImportStyle();
  }, [resolvedTheme, isDarkTheme]);

  // Highlight code using highlight.js
  const highlightedCode = useMemo(() => {
    try {
      const lang = hljs.getLanguage(language);
      if (lang) {
        return hljs.highlight(codeContent, {
          language: language,
        }).value;
      }
    } catch {
      // Skip error and use default highlighted code.
    }

    // Escape any HTML entities when rendering original content.
    return Object.assign(document.createElement("span"), {
      textContent: codeContent,
    }).innerHTML;
  }, [language, codeContent]);

  // If it's a mermaid block, render with MermaidBlock component
  if (language === "mermaid") {
    return (
      <pre className={cn("relative", markdownStyles.blockWrapper)}>
        <MermaidBlock className={cn(className)} {...props}>
          {children}
        </MermaidBlock>
      </pre>
    );
  }

  // If it's a secret block, render with SecretBlock component. Unlike the view
  // blocks, the fence body is only a reference — the ciphertext is fetched, and
  // decrypted in the browser, once the reader supplies a passphrase.
  if (language === SECRET_BLOCK_LANGUAGE) {
    // A <div>, not the <pre> the other blocks use: a decrypted payload renders as
    // ordinary markdown, and inside <pre> it would inherit `white-space: pre` and a
    // monospace font — every source newline becoming a visible break.
    return (
      <div className={cn("relative", markdownStyles.blockWrapper)}>
        <SecretBlock className={cn(className)} {...props}>
          {children}
        </SecretBlock>
      </div>
    );
  }

  // If it's a calendar block, render with CalendarBlock component
  if (language === "calendar") {
    return (
      <pre className={cn("relative", markdownStyles.blockWrapper)}>
        <CalendarBlock className={cn(className)} {...props}>
          {children}
        </CalendarBlock>
      </pre>
    );
  }

  // If it's a grid block, render with GridBlock component
  if (language === "grid") {
    return (
      <pre className={cn("relative", markdownStyles.blockWrapper)}>
        <GridBlock className={cn(className)} {...props}>
          {children}
        </GridBlock>
      </pre>
    );
  }

  // If it's a sheets block, render with SheetsBlock component. The block's style
  // overlay anchor lives on the fence info string (```sheets id=xxx); the
  // remark-sheets-id plugin promotes it to a real `data-sheet-id` attribute,
  // because the raw fence meta on `node.data` is stripped by rehype-raw.
  if (language === "sheets") {
    const blockId = (codeElement?.props as { "data-sheet-id"?: string } | undefined)?.["data-sheet-id"];
    return (
      <pre className={cn("relative", markdownStyles.blockWrapper)}>
        <SheetsBlock className={cn(className)} blockId={blockId} {...props}>
          {children}
        </SheetsBlock>
      </pre>
    );
  }

  // If it's a kanban block, render with KanbanBlock component
  if (language === "kanban") {
    return (
      <pre className={cn("relative", markdownStyles.blockWrapper)}>
        <KanbanBlock className={cn(className)} {...props}>
          {children}
        </KanbanBlock>
      </pre>
    );
  }

  const handleCopy = async () => {
    try {
      // Try native clipboard API first (requires HTTPS or localhost)
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(codeContent);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } else {
        // Fallback to copy-to-clipboard library for non-secure contexts
        const success = await copy(codeContent);
        if (success) {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } else {
          console.error("Failed to copy code");
        }
      }
    } catch (err) {
      // If native API fails, try fallback
      console.warn("Native clipboard failed, using fallback:", err);
      const success = await copy(codeContent);
      if (success) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } else {
        console.error("Failed to copy code:", err);
      }
    }
  };

  return (
    <pre className={cn("relative rounded-lg border border-border bg-muted/20 overflow-hidden", markdownStyles.blockWrapper)}>
      {/* Header with language label and copy button */}
      <div className="flex items-center justify-between px-2 py-1 border-b border-border bg-muted/30">
        {foldMode ? (
          <button
            onClick={() => setCollapsed((value) => !value)}
            aria-expanded={!collapsed}
            className="inline-flex items-center gap-1 text-xs text-foreground select-none hover:text-primary transition-colors duration-200"
            title={collapsed ? "Expand code" : "Collapse code"}
          >
            <ChevronRightIcon className={cn("w-3.5 h-3.5 transition-transform duration-200", !collapsed && "rotate-90")} />
            <span>{foldTitle || language || "text"}</span>
          </button>
        ) : (
          <span className="text-xs text-foreground select-none">{language || "text"}</span>
        )}
        <button
          onClick={handleCopy}
          className={cn(
            "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs",
            "transition-colors duration-200",
            "hover:bg-accent active:scale-95",
            copied ? "text-primary" : "text-muted-foreground hover:text-foreground",
          )}
          aria-label={copied ? "Copied" : "Copy code"}
          title={copied ? "Copied!" : "Copy code"}
        >
          {copied ? (
            <>
              <CheckIcon className="w-3.5 h-3.5" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <CopyIcon className="w-3.5 h-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Code content. Hidden rather than unmounted when collapsed, so toggling
          doesn't re-run highlighting and the copy button keeps working. */}
      <div className={cn("overflow-x-auto", collapsed && "hidden")}>
        <code
          className={cn("block px-3 py-2 text-sm leading-relaxed", `language-${language}`)}
          dangerouslySetInnerHTML={{ __html: highlightedCode }}
        />
      </div>
    </pre>
  );
};
