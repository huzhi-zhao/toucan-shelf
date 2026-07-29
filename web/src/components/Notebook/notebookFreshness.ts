import type { WorkspaceTreeNode } from "@/types/proto/api/v1/workspace_service_pb";
import { WorkspaceTreeNode_NodeType } from "@/types/proto/api/v1/workspace_service_pb";

// Recency tiers, VS Code source-control-decoration style: each tier is its own hue rather
// than a fade of one color, so the distinction survives a quick glance. Anything older than
// three days is left alone — by then you either remember the document or it didn't matter.
// A folder inherits the freshest tier found anywhere in its subtree, so an edit deep in the
// tree is still visible while collapsed.
export type FreshnessLevel = 3 | 2 | 1;

const HOUR = 3600;
const DAY = 24 * HOUR;

const THRESHOLDS: { maxAge: number; level: FreshnessLevel }[] = [
  { maxAge: HOUR, level: 3 },
  { maxAge: DAY, level: 2 },
  { maxAge: 3 * DAY, level: 1 },
];

export type FreshnessMap = Map<string, FreshnessLevel>;

export const freshnessKey = (node: WorkspaceTreeNode): string =>
  node.type === WorkspaceTreeNode_NodeType.FOLDER ? `folder:${node.path}` : `doc:${node.memo || node.path}`;

const levelForAge = (ageSeconds: number): FreshnessLevel | undefined => {
  if (ageSeconds < 0) return 3; // clock skew: a future timestamp is as fresh as it gets
  for (const { maxAge, level } of THRESHOLDS) {
    if (ageSeconds < maxAge) return level;
  }
  return undefined;
};

/**
 * Builds a node-key -> freshness level map for the whole tree.
 *
 * Documents are scored from their own update time; folders take the maximum level of their
 * descendants. Nodes with no recent change are absent from the map.
 */
export function buildFreshnessMap(nodes: WorkspaceTreeNode[], nowSeconds: number): FreshnessMap {
  const docLevels: { key: string; level: FreshnessLevel }[] = [];

  const collect = (node: WorkspaceTreeNode) => {
    if (node.type === WorkspaceTreeNode_NodeType.FOLDER) {
      node.children.forEach(collect);
      return;
    }
    if (!node.updateTime) return;
    const level = levelForAge(nowSeconds - Number(node.updateTime.seconds));
    if (level !== undefined) docLevels.push({ key: freshnessKey(node), level });
  };
  nodes.forEach(collect);

  const map: FreshnessMap = new Map();
  for (const { key, level } of docLevels) {
    map.set(key, level);
  }

  // Second pass: fold document levels up into their ancestor folders.
  const foldFolder = (node: WorkspaceTreeNode): FreshnessLevel | undefined => {
    if (node.type !== WorkspaceTreeNode_NodeType.FOLDER) {
      return map.get(freshnessKey(node));
    }
    let best: FreshnessLevel | undefined;
    for (const child of node.children) {
      const childLevel = foldFolder(child);
      if (childLevel !== undefined && (best === undefined || childLevel > best)) best = childLevel;
    }
    if (best !== undefined) map.set(freshnessKey(node), best);
    return best;
  };
  nodes.forEach(foldFolder);

  return map;
}

// One hue per tier, echoing VS Code's git decorations: green for the freshest, amber for
// today's, and a desaturated blue that reads as "touched recently" without competing for
// attention. Kept as literal class strings so Tailwind can see them.
const LEVEL_CLASSES: Record<FreshnessLevel, string> = {
  3: "text-emerald-600 dark:text-emerald-400",
  2: "text-amber-600 dark:text-amber-400",
  1: "text-sky-700/70 dark:text-sky-300/60",
};

export const freshnessClass = (level: FreshnessLevel | undefined): string | undefined =>
  level === undefined ? undefined : LEVEL_CLASSES[level];
