import { ChevronRightIcon, FolderIcon, FolderOpenIcon, HomeIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { WorkspaceTreeNode } from "@/types/proto/api/v1/workspace_service_pb";
import { WorkspaceTreeNode_NodeType } from "@/types/proto/api/v1/workspace_service_pb";

interface Props {
  nodes: WorkspaceTreeNode[];
  // Selected folder path; "" is the workspace root.
  value: string;
  onChange: (path: string) => void;
  // Folder being moved: it and its descendants cannot be destinations.
  excludePath?: string;
  rootLabel: string;
}

const isExcluded = (path: string, excludePath?: string) => !!excludePath && (path === excludePath || path.startsWith(`${excludePath}/`));

// Keeps only folder nodes, dropping the moved subtree so it can't be picked as its own parent.
const folderChildren = (nodes: WorkspaceTreeNode[], excludePath?: string) =>
  nodes.filter((node) => node.type === WorkspaceTreeNode_NodeType.FOLDER && !isExcluded(node.path, excludePath));

// Ancestors of the initially selected path, so a preselected deep folder is visible on open.
const ancestorsOf = (path: string): string[] => {
  const parts = path.split("/").filter(Boolean);
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
};

const FolderRow = ({
  node,
  depth,
  value,
  onChange,
  excludePath,
  expanded,
  onToggle,
}: {
  node: WorkspaceTreeNode;
  depth: number;
  value: string;
  onChange: (path: string) => void;
  excludePath?: string;
  expanded: Set<string>;
  onToggle: (path: string) => void;
}) => {
  const children = useMemo(() => folderChildren(node.children, excludePath), [node.children, excludePath]);
  const isOpen = expanded.has(node.path);
  const isSelected = value === node.path;

  return (
    <div className="w-full">
      <div
        className={cn(
          "flex items-center gap-1 rounded-md px-1 py-1 text-sm cursor-pointer select-none hover:bg-accent/60",
          isSelected && "bg-accent text-accent-foreground",
        )}
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
        onClick={() => onChange(node.path)}
      >
        {children.length > 0 ? (
          <button
            type="button"
            className="shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.path);
            }}
          >
            <ChevronRightIcon className={cn("w-3.5 h-3.5 transition-transform text-muted-foreground", isOpen && "rotate-90")} />
          </button>
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        {isOpen ? (
          <FolderOpenIcon className="w-4 h-4 shrink-0 text-primary/80" />
        ) : (
          <FolderIcon className="w-4 h-4 shrink-0 text-primary/80" />
        )}
        <span className="truncate">{node.name}</span>
      </div>
      {isOpen &&
        children.map((child) => (
          <FolderRow
            key={child.path}
            node={child}
            depth={depth + 1}
            value={value}
            onChange={onChange}
            excludePath={excludePath}
            expanded={expanded}
            onToggle={onToggle}
          />
        ))}
    </div>
  );
};

// Hierarchical destination picker: a flat path list becomes unusable once a workspace has
// more than a handful of folders, so destinations are browsed as the tree they actually form.
const FolderTreePicker = ({ nodes, value, onChange, excludePath, rootLabel }: Props) => {
  const roots = useMemo(() => folderChildren(nodes, excludePath), [nodes, excludePath]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(ancestorsOf(value)));

  // A workspace switch replaces the tree wholesale; re-seed the expansion from the new selection.
  useEffect(() => {
    setExpanded(new Set(ancestorsOf(value)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes]);

  const handleToggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <div className="max-h-72 overflow-y-auto rounded-md border border-border p-1">
      <div
        className={cn(
          "flex items-center gap-1 rounded-md px-1 py-1 text-sm cursor-pointer select-none hover:bg-accent/60",
          value === "" && "bg-accent text-accent-foreground",
        )}
        style={{ paddingLeft: "4px" }}
        onClick={() => onChange("")}
      >
        <span className="w-3.5 shrink-0" />
        <HomeIcon className="w-4 h-4 shrink-0 text-primary/80" />
        <span className="truncate">{rootLabel}</span>
      </div>
      {roots.map((node) => (
        <FolderRow
          key={node.path}
          node={node}
          depth={1}
          value={value}
          onChange={onChange}
          excludePath={excludePath}
          expanded={expanded}
          onToggle={handleToggle}
        />
      ))}
    </div>
  );
};

export default FolderTreePicker;
