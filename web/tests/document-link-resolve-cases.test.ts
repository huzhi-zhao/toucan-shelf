import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyDocHref,
  parseWorkspaceQualifiedHref,
  resolveAbsoluteMemoHref,
  resolveRelativePath,
  resolveWorkspacePath,
} from "@/components/MemoContent/DocumentLinkContext";
import type { WorkspaceTreeNode } from "@/types/proto/api/v1/workspace_service_pb";
import { WorkspaceTreeNode_NodeType } from "@/types/proto/api/v1/workspace_service_pb";

/**
 * The resolver exists twice — here and in internal/linkindex/resolve.go — as
 * two hand-maintained implementations. This suite and its Go counterpart
 * (TestSharedResolveCases) read the *same* case file, so a change made on only
 * one side fails the other's build. Add a case to the JSON before changing
 * either implementation; do not add cases inline here.
 */
const CASES_PATH = (() => {
  // Vitest transforms `import.meta.url` to a non-file URL, so locate the repo
  // root by climbing from the working directory instead.
  const rel = "internal/linkindex/testdata/resolve_cases.json";
  let dir = process.cwd();
  for (;;) {
    const candidate = resolve(dir, rel);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`could not locate ${rel} above ${process.cwd()}`);
    dir = parent;
  }
})();

interface CaseFile {
  trees: Record<string, Array<{ uid: string; title: string; folderPath: string }>>;
  cases: Array<{
    name: string;
    tree?: string;
    base: string;
    href: string;
    form: string;
    uid: string | null;
    // Workspace-qualified cases only: the split the parser must produce, and
    // `tree` then names the *target* workspace's tree that `uid` lives in.
    workspaceTitle?: string;
    path?: string;
  }>;
}

const file: CaseFile = JSON.parse(readFileSync(CASES_PATH, "utf8"));

function buildTree(docs: Array<{ uid: string; title: string; folderPath: string }>): WorkspaceTreeNode[] {
  const root: WorkspaceTreeNode[] = [];
  for (const d of docs) {
    let nodes = root;
    for (const seg of d.folderPath.split("/").filter((s) => s !== "")) {
      let folder = nodes.find((n) => n.type === WorkspaceTreeNode_NodeType.FOLDER && n.name === seg);
      if (!folder) {
        folder = { type: WorkspaceTreeNode_NodeType.FOLDER, name: seg, children: [] } as unknown as WorkspaceTreeNode;
        nodes.push(folder);
      }
      nodes = folder.children;
    }
    nodes.push({
      type: WorkspaceTreeNode_NodeType.DOCUMENT,
      name: d.title,
      memo: d.uid,
      children: [],
    } as unknown as WorkspaceTreeNode);
  }
  return root;
}

const trees = Object.fromEntries(Object.entries(file.trees).map(([name, docs]) => [name, buildTree(docs)]));

describe("shared resolver cases", () => {
  it("loaded the shared case file", () => {
    expect(file.cases.length).toBeGreaterThan(0);
  });

  for (const c of file.cases) {
    it(c.name, () => {
      expect(classifyDocHref(c.href)).toBe(c.form);

      const tree = trees[c.tree ?? "default"];
      expect(tree).toBeDefined();

      let resolved: string | undefined;
      switch (c.form) {
        case "absoluteMemo":
          resolved = resolveAbsoluteMemoHref(c.href);
          break;
        case "rootRelative":
          resolved = resolveWorkspacePath(tree, c.href);
          break;
        case "relativeExplicit":
        case "relativeBare":
          resolved = resolveRelativePath(tree, c.base, c.href);
          break;
        case "workspaceQualified": {
          const parsed = parseWorkspaceQualifiedHref(c.href);
          expect(parsed).toBeDefined();
          expect(parsed?.title).toBe(c.workspaceTitle);
          expect(parsed?.path).toBe(c.path);
          // Inside the target workspace it is an ordinary root-relative path.
          resolved = resolveWorkspacePath(tree, parsed!.path);
          break;
        }
        case "external":
          // Nothing to resolve; the classification assertion is the test.
          break;
      }

      expect(resolved).toBe(c.uid ?? undefined);
    });
  }
});
