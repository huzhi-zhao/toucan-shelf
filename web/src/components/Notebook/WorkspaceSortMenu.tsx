import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useUpdateWorkspace } from "@/hooks/useWorkspaceQueries";
import type { Workspace } from "@/types/proto/api/v1/workspace_service_pb";
import { useTranslate } from "@/utils/i18n";
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

export default WorkspaceSortMenuItems;
