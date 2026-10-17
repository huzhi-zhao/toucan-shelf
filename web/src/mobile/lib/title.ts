import { splitFrontmatter } from "@/utils/frontmatter";

/**
 * Whether the document body opens with its own title as an H1. Many documents
 * do (`# 部署与回滚`); the page header then must not print the title a second
 * time directly above it.
 */
export function bodyOpensWithTitle(content: string, title: string): boolean {
  const { body } = splitFrontmatter(content);
  const firstLine = body.split("\n").find((line) => line.trim() !== "");
  const match = firstLine ? /^#\s+(.+?)\s*#*\s*$/.exec(firstLine.trim()) : null;
  return !!match && match[1].trim() === title.trim();
}
