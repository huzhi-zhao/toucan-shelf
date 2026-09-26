import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useUpdateWorkspace, useUpdateWorkspaceFolderSort } from "@/hooks/useWorkspaceQueries";
import type { Workspace } from "@/types/proto/api/v1/workspace_service_pb";
import { useTranslate } from "@/utils/i18n";
import type { NotebookSortField, NotebookSortOrder } from "./notebookSort";
import { normalizeSortField, normalizeSortOrder } from "./notebookSort";

/**
 * The workspace's document-sorting controls, as bare menu items. It renders no
 * container of its own so the caller can drop it into either a submenu (the
 * notebook sidebar's settings menu) or a plain dropdown (the workspace detail
 * page's action bar) without the two drifting apart.
 */
const WorkspaceSortMenuItems = ({ workspace }: { workspace: Workspace }) => {
  const t = useTranslate();
  const updateWorkspace = useUpdateWorkspace();
  const sortField = normalizeSortField(workspace.sortField);
  const sortOrder = normalizeSortOrder(workspace.sortOrder);

  return (
    <>
      <DropdownMenuLabel>{t("notebook.sort-order")}</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={sortOrder}
        onValueChange={(v) => updateWorkspace.mutateAsync({ workspace: { ...workspace, sortOrder: v }, updateMask: ["sort_order"] })}
      >
        <DropdownMenuRadioItem value="desc">
          <ArrowDownIcon className="w-3.5 h-3.5 mr-2" />
          {t("notebook.sort-desc")}
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="asc">
          <ArrowUpIcon className="w-3.5 h-3.5 mr-2" />
          {t("notebook.sort-asc")}
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>{t("notebook.sort-field")}</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={sortField}
        onValueChange={(v) => updateWorkspace.mutateAsync({ workspace: { ...workspace, sortField: v }, updateMask: ["sort_field"] })}
      >
        <DropdownMenuRadioItem value="createTime">{t("notebook.sort-create-time")}</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="updateTime">{t("notebook.sort-update-time")}</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="alphabetical">{t("notebook.sort-alphabetical")}</DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
      <DropdownMenuCheckboxItem
        checked={workspace.foldersFirst}
        onCheckedChange={(checked) =>
          updateWorkspace.mutateAsync({ workspace: { ...workspace, foldersFirst: checked === true }, updateMask: ["folders_first"] })
        }
      >
        {t("notebook.sort-folders-first")}
      </DropdownMenuCheckboxItem>
    </>
  );
};

/**
 * One folder's sort override, as bare menu items for the folder row's ⋮ menu.
 *
 * The extra choice a folder has over a workspace is "inherit", which is also
 * every folder's starting state — hence INHERIT standing in for the empty string
 * the API uses, since a radio group cannot hold "" as a distinct value. The
 * inherited option spells out what it resolves to, so the menu answers "what is
 * this folder sorted by right now" without the reader having to walk up the tree.
 */
const INHERIT = "inherit";

interface FolderSortMenuItemsProps {
  // "workspaces/{uid}" — the folder's knowledge base.
  workspaceName: string;
  // The folder's workspace-relative path.
  path: string;
  // The folder's OWN override, empty when it inherits.
  sortField: string;
  sortOrder: string;
  // What this folder would sort by with no override of its own.
  inheritedField: NotebookSortField;
  inheritedOrder: NotebookSortOrder;
}

export const FolderSortMenuItems = ({
  workspaceName,
  path,
  sortField,
  sortOrder,
  inheritedField,
  inheritedOrder,
}: FolderSortMenuItemsProps) => {
  const t = useTranslate();
  const updateFolderSort = useUpdateWorkspaceFolderSort();
  // The API sets both halves at once, so the one the user did not touch is sent
  // back as-is — its OWN value, not the resolved one, or picking a field would
  // silently freeze an inherited direction onto the folder.
  const apply = (field: string, order: string) =>
    updateFolderSort.mutateAsync({ parent: workspaceName, path, sortField: field, sortOrder: order });

  const fieldLabel = (field: NotebookSortField) =>
    t(
      field === "updateTime"
        ? "notebook.sort-update-time"
        : field === "alphabetical"
          ? "notebook.sort-alphabetical"
          : "notebook.sort-create-time",
    );

  return (
    <>
      <DropdownMenuLabel>{t("notebook.sort-field")}</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={sortField || INHERIT} onValueChange={(v) => apply(v === INHERIT ? "" : v, sortOrder)}>
        <DropdownMenuRadioItem value={INHERIT}>
          {t("notebook.sort-inherit-value", { value: fieldLabel(inheritedField) })}
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="createTime">{t("notebook.sort-create-time")}</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="updateTime">{t("notebook.sort-update-time")}</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="alphabetical">{t("notebook.sort-alphabetical")}</DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>{t("notebook.sort-order")}</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={sortOrder || INHERIT} onValueChange={(v) => apply(sortField, v === INHERIT ? "" : v)}>
        <DropdownMenuRadioItem value={INHERIT}>
          {t("notebook.sort-inherit-value", { value: t(inheritedOrder === "asc" ? "notebook.sort-asc" : "notebook.sort-desc") })}
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="desc">
          <ArrowDownIcon className="w-3.5 h-3.5 mr-2" />
          {t("notebook.sort-desc")}
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="asc">
          <ArrowUpIcon className="w-3.5 h-3.5 mr-2" />
          {t("notebook.sort-asc")}
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </>
  );
};

export default WorkspaceSortMenuItems;
