import { List, ListItem, Navbar, Page, Preloader } from "konsta/react";
import { FolderIcon } from "lucide-react";
import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { buildFreshnessMap, freshnessClass, freshnessKey } from "@/components/Notebook/notebookFreshness";
import { normalizeSortField, normalizeSortOrder, sortTree } from "@/components/Notebook/notebookSort";
import { useWorkspace, useWorkspaceTree } from "@/hooks/useWorkspaceQueries";
import { WorkspaceTreeNode_NodeType } from "@/types/proto/api/v1/workspace_service_pb";
import BackCapsule from "../components/BackCapsule";
import DocGlyph from "../components/DocGlyph";
import { COPY } from "../copy";
import { formatDate } from "../lib/format";
import { useBack, useBackLabel, useGo, usePageScroll } from "../lib/nav";
import { countDocuments, findFolderChildren, folderName, parentFolderPath } from "../lib/tree";
import { docRoute, folderPathFromSplat, folderRoute, MOBILE_ROUTES } from "../routes";

/** One level of a knowledge base per page; tapping a folder drills in (requirement §5). */
export default function FolderPage() {
  const { uid = "", "*": splat } = useParams();
  const workspaceName = `workspaces/${uid}`;
  const folderPath = folderPathFromSplat(splat);
  const back = useBack(folderPath ? folderRoute(workspaceName, parentFolderPath(folderPath)) : MOBILE_ROUTES.SHELF);
  const scrollRef = usePageScroll<HTMLDivElement>();
  const { data: workspace } = useWorkspace(workspaceName);
  const { data: tree, isPending } = useWorkspaceTree(workspaceName, false);

  // Same order as the web sidebar: the workspace's rule at the root, each folder's own override below it.
  const nodes = useMemo(() => {
    if (!tree || !workspace) return undefined;
    const sorted = sortTree(tree, normalizeSortField(workspace.sortField), normalizeSortOrder(workspace.sortOrder), workspace.foldersFirst);
    return findFolderChildren(sorted, folderPath);
  }, [tree, workspace, folderPath]);

  // Recently edited names are tinted like the web sidebar (phase 3 §1), with the same rules and colors: a folder
  // takes the freshest tier found anywhere below it. "Now" is read whenever the tree arrives; a page is not open
  // long enough for the hour boundary to drift.
  const freshness = useMemo(() => (tree ? buildFreshnessMap(tree, Math.floor(Date.now() / 1000)) : undefined), [tree]);
  const tinted = (key: string, name: string) => <span className={freshnessClass(freshness?.get(key))}>{name}</span>;

  const title = folderPath ? folderName(folderPath) : workspace?.title;
  const go = useGo(title);
  const parent = parentFolderPath(folderPath);
  const backText = useBackLabel() ?? (folderPath ? (parent ? folderName(parent) : workspace?.title) : COPY.shelf.title);

  return (
    <Page ref={scrollRef}>
      <Navbar
        title={title}
        large
        transparent
        centerTitle
        left={
          // At the knowledge base's root, back is already the shelf.
          <BackCapsule text={backText} onBack={back} shelf={folderPath !== ""} />
        }
      />
      {isPending || !workspace ? (
        <div className="flex justify-center py-16">
          <Preloader />
        </div>
      ) : nodes === undefined ? (
        <div className="text-center text-black/40 dark:text-white/40 py-16">{COPY.folder.notFound}</div>
      ) : nodes.length === 0 ? (
        <div className="text-center text-black/40 dark:text-white/40 py-16">{COPY.folder.empty}</div>
      ) : (
        <List strongIos insetIos dividersIos className="mt-4">
          {nodes.map((node) =>
            node.type === WorkspaceTreeNode_NodeType.FOLDER ? (
              <ListItem
                key={`f:${node.path}`}
                link
                title={tinted(freshnessKey(node), node.name)}
                after={`${countDocuments(node)}`}
                media={<FolderIcon className="w-6 h-6 text-[#3b9cff]" fill="currentColor" strokeWidth={1.2} />}
                onClick={() => go(folderRoute(workspaceName, node.path))}
              />
            ) : (
              <ListItem
                key={node.memo}
                link
                title={tinted(freshnessKey(node), node.name)}
                footer={COPY.folder.updatedAt(formatDate(node.updateTime))}
                media={<DocGlyph icon={node.icon} docType={node.docType} />}
                onClick={() => go(docRoute(node.memo))}
              />
            ),
          )}
        </List>
      )}
      <div className="h-[calc(24px+env(safe-area-inset-bottom))]" />
    </Page>
  );
}
