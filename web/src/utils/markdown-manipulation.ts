// Utilities for manipulating markdown strings using AST parsing
// Uses mdast for accurate task detection that properly handles code blocks

import type { Heading, ListItem } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { visit } from "unist-util-visit";
import { isTaskStatusMarker, resolveTaskStatus } from "./task-status";

interface TaskInfo {
  lineNumber: number;
  checked: boolean;
  /** Canonical status marker, e.g. " ", "x", "/". See utils/task-status. */
  marker: string;
}

// Extended statuses (`- [/]`, `- [?]`, …) are invisible to GFM, which only
// parses `[ ]` / `[x]`. Detect them from the raw line so task indices stay in
// step with what the renderer shows.
const EXTENDED_TASK_LINE_RE = /^\s*[-*+]\s+\[(.)\](?:\s|$)/;

function markerAtLine(line: string | undefined, checked: boolean | undefined): string | undefined {
  const match = line === undefined ? null : EXTENDED_TASK_LINE_RE.exec(line);
  if (match && isTaskStatusMarker(match[1])) {
    return resolveTaskStatus(match[1]).marker;
  }
  return checked === undefined ? undefined : checked ? "x" : " ";
}

// Extract all task list items from markdown using AST parsing
// This correctly ignores task-like patterns inside code blocks
function extractTasksFromAst(markdown: string): TaskInfo[] {
  const tree = fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });

  const tasks: TaskInfo[] = [];
  const lines = markdown.split("\n");

  visit(tree, "listItem", (node: ListItem) => {
    if (!node.position?.start.line) return;
    const lineNumber = node.position.start.line - 1; // Convert to 0-based
    const marker = markerAtLine(lines[lineNumber], node.checked ?? undefined);
    if (marker === undefined) return; // not a task list item

    tasks.push({ lineNumber, checked: marker === "x", marker });
  });

  return tasks;
}

/** Rewrites the status marker of the task on `lineNumber`. Any recognized marker is accepted. */
export function setTaskStatusAtLine(markdown: string, lineNumber: number, marker: string): string {
  const lines = markdown.split("\n");

  if (lineNumber < 0 || lineNumber >= lines.length || !isTaskStatusMarker(marker)) {
    return markdown;
  }

  // Match task list patterns: - [ ], - [x], and extended ones like - [/], - [?].
  const taskPattern = /^(\s*[-*+]\s+)\[(.)\](\s+.*)$/;
  const match = lines[lineNumber].match(taskPattern);

  if (!match || !isTaskStatusMarker(match[2])) {
    return markdown;
  }

  const [, prefix, , suffix] = match;
  lines[lineNumber] = `${prefix}[${resolveTaskStatus(marker).marker}]${suffix}`;

  return lines.join("\n");
}

export function toggleTaskAtLine(markdown: string, lineNumber: number, checked: boolean): string {
  return setTaskStatusAtLine(markdown, lineNumber, checked ? "x" : " ");
}

export function setTaskStatusAtIndex(markdown: string, taskIndex: number, marker: string): string {
  const tasks = extractTasksFromAst(markdown);

  if (taskIndex < 0 || taskIndex >= tasks.length) {
    return markdown;
  }

  return setTaskStatusAtLine(markdown, tasks[taskIndex].lineNumber, marker);
}

export function toggleTaskAtIndex(markdown: string, taskIndex: number, checked: boolean): string {
  return setTaskStatusAtIndex(markdown, taskIndex, checked ? "x" : " ");
}

// A counter list item line: `- [N] label` (any bullet). Must stay in lockstep
// with remark-counter's COUNTER_MARKER_RE, or the indices the renderer assigns
// won't address the same lines here. In particular the trailing lookahead is
// what keeps `- [1]: url` (a link definition) and `- [1](url)` (a link) from
// counting as counters — the plugin rejects both, so this must too.
const COUNTER_LINE_RE = /^(\s*[-*+][ \t]+)\[(\d+)\](?=[ \t]|$)/;

/**
 * Line numbers (0-based) of every `- [N]` counter item in document order,
 * skipping real GFM tasks and anything inside code. Matches the numbering
 * remark-counter assigns to the rendered badges.
 */
function extractCounterItemLines(markdown: string): number[] {
  const tree = fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });

  const lines = markdown.split("\n");
  const counterLines: number[] = [];

  visit(tree, "listItem", (node: ListItem) => {
    if (!node.position?.start.line) return;
    if (typeof node.checked === "boolean") return; // a real task, not a counter
    const lineNumber = node.position.start.line - 1;
    if (COUNTER_LINE_RE.test(lines[lineNumber])) {
      counterLines.push(lineNumber);
    }
  });

  return counterLines;
}

/** Increments the `- [N]` counter at `counterIndex` (document order) by one, returning the new markdown. */
export function incrementCounterAtIndex(markdown: string, counterIndex: number): string {
  const counterLines = extractCounterItemLines(markdown);
  if (counterIndex < 0 || counterIndex >= counterLines.length) {
    return markdown;
  }

  const lines = markdown.split("\n");
  const lineNumber = counterLines[counterIndex];
  lines[lineNumber] = lines[lineNumber].replace(COUNTER_LINE_RE, (_full, prefix, num) => `${prefix}[${parseInt(num, 10) + 1}]`);
  return lines.join("\n");
}

export function countTasks(markdown: string): {
  total: number;
  completed: number;
  incomplete: number;
} {
  const tasks = extractTasksFromAst(markdown);

  const total = tasks.length;
  const completed = tasks.filter((t) => t.checked).length;

  return {
    total,
    completed,
    incomplete: total - completed,
  };
}

export function getTaskLineNumber(markdown: string, taskIndex: number): number {
  const tasks = extractTasksFromAst(markdown);

  if (taskIndex < 0 || taskIndex >= tasks.length) {
    return -1;
  }

  return tasks[taskIndex].lineNumber;
}

export interface TaskItem {
  lineNumber: number;
  taskIndex: number;
  checked: boolean;
  content: string;
  indentation: number;
  /** Canonical status marker, e.g. " ", "x", "/". See utils/task-status. */
  marker: string;
}

export interface HeadingItem {
  text: string;
  level: 1 | 2 | 3 | 4;
  slug: string;
  /** 1-indexed line number within the markdown passed to extractHeadings (i.e. relative to the body, frontmatter excluded). */
  line: number;
}

/**
 * Slugify a string into a URL-friendly anchor ID.
 */
export function slugify(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// Short, stable, non-cryptographic hash (sdbm → base36) for the rare heading whose text
// slugifies to empty — e.g. one that is only emoji or punctuation.
function shortHash(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (text.charCodeAt(i) + (h << 6) + (h << 16) - h) >>> 0;
  }
  return h.toString(36);
}

/**
 * Canonical anchor id for a heading's text. A human-readable slug whenever possible; falls back
 * to `h-<shorthash>` only when the slug would be empty (all-emoji / all-punctuation headings), so
 * every heading stays addressable. Never returns "".
 */
export function headingSlug(text: string): string {
  return slugify(text) || `h-${shortHash(text.normalize("NFC").trim())}`;
}

/**
 * Extract h1–h4 headings from markdown content for outline navigation.
 */
export function extractHeadings(markdown: string): HeadingItem[] {
  const tree = fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });

  const headings: HeadingItem[] = [];
  const slugCounts = new Map<string, number>();

  visit(tree, "heading", (node: Heading) => {
    if (node.depth < 1 || node.depth > 4) return;

    const text = getNodeText(node as unknown as MdastNode);
    if (!text) return;

    let slug = headingSlug(text);
    const count = slugCounts.get(slug) || 0;
    slugCounts.set(slug, count + 1);
    if (count > 0) slug = `${slug}-${count}`;

    headings.push({ text, level: node.depth as 1 | 2 | 3 | 4, slug, line: node.position?.start.line ?? 1 });
  });

  return headings;
}

interface MdastNode {
  value?: string;
  children?: MdastNode[];
}

function getNodeText(node: MdastNode): string {
  if (node.value) return node.value;
  if (node.children) return node.children.map(getNodeText).join("");
  return "";
}

export function extractTasks(markdown: string): TaskItem[] {
  const tree = fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });

  const lines = markdown.split("\n");
  const tasks: TaskItem[] = [];
  let taskIndex = 0;

  visit(tree, "listItem", (node: ListItem) => {
    if (!node.position?.start.line) return;

    const lineNumber = node.position.start.line - 1;
    const line = lines[lineNumber];
    const marker = markerAtLine(line, node.checked ?? undefined);
    if (marker === undefined) return;

    // Extract indentation
    const indentMatch = line.match(/^(\s*)/);
    const indentation = indentMatch ? indentMatch[1].length : 0;

    // Extract content (text after the checkbox)
    const contentMatch = line.match(/^\s*[-*+]\s+\[.\]\s+(.*)/);
    const content = contentMatch ? contentMatch[1] : "";

    tasks.push({
      lineNumber,
      taskIndex: taskIndex++,
      checked: marker === "x",
      content,
      indentation,
      marker,
    });
  });

  return tasks;
}
