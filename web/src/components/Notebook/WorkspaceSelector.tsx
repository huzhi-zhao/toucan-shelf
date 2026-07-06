import { ArrowDownIcon, ArrowUpIcon, LibraryBigIcon, SettingsIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateWorkspace, useDeleteWorkspace, useUpdateWorkspace } from "@/hooks/useWorkspaceQueries";
import type { Workspace } from "@/types/proto/api/v1/workspace_service_pb";
import { useTranslate } from "@/utils/i18n";
import { normalizeSortField, normalizeSortOrder } from "./notebookSort";
import PromptDialog from "./PromptDialog";
import { WorkspaceCoverColorDialog, WorkspaceCoverImageDialog } from "./WorkspaceCoverDialogs";

interface Props {
  workspaces: Workspace[];
  value?: string;
  onChange: (name: string) => void;
  onCreated?: (name: string) => void;
}

const WorkspaceSelector = ({ workspaces, value, onChange, onCreated }: Props) => {
  const t = useTranslate();
  const createWorkspace = useCreateWorkspace();
  const updateWorkspace = useUpdateWorkspace();
  const deleteWorkspace = useDeleteWorkspace();
  const [createOpen, setCreateOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [coverColorOpen, setCoverColorOpen] = useState(false);
  const [coverImageOpen, setCoverImageOpen] = useState(false);

  const current = workspaces.find((w) => w.name === value);
  const sortField = normalizeSortField(current?.sortField);
  const sortOrder = normalizeSortOrder(current?.sortOrder);

  return (
    <div className="w-full flex flex-row items-center gap-1">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="flex-1 min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <LibraryBigIcon className="w-4 h-4 shrink-0 opacity-70" />
            <SelectValue className="truncate" placeholder={t("notebook.select-workspace")} />
          </div>
        </SelectTrigger>
        <SelectContent>
          {workspaces.map((workspace) => (
            <SelectItem key={workspace.name} value={workspace.name}>
              {workspace.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="shrink-0">
            <SettingsIcon className="w-4 h-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setCreateOpen(true)}>{t("notebook.new-workspace")}</DropdownMenuItem>
          {current && <DropdownMenuItem onClick={() => setRenameOpen(true)}>{t("notebook.rename-workspace")}</DropdownMenuItem>}
          {current && workspaces.length > 1 && (
            <DropdownMenuItem
              variant="destructive"
              onClick={async () => {
                if (!window.confirm(t("notebook.delete-workspace-confirm"))) return;
                await deleteWorkspace.mutateAsync(current.name);
                const remaining = workspaces.filter((w) => w.name !== current.name);
                if (remaining[0]) onChange(remaining[0].name);
              }}
            >
              {t("common.delete")}
            </DropdownMenuItem>
          )}
          {current && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>{t("notebook.change-cover")}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={() => setCoverColorOpen(true)}>{t("notebook.set-cover-color")}</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setCoverImageOpen(true)}>{t("notebook.set-cover-image")}</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>{t("notebook.sort-by")}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuLabel>{t("notebook.sort-order")}</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={sortOrder}
                    onValueChange={(v) =>
                      updateWorkspace.mutateAsync({
                        workspace: { ...current, sortOrder: v },
                        updateMask: ["sort_order"],
                      })
                    }
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
                    onValueChange={(v) =>
                      updateWorkspace.mutateAsync({
                        workspace: { ...current, sortField: v },
                        updateMask: ["sort_field"],
                      })
                    }
                  >
                    <DropdownMenuRadioItem value="createTime">{t("notebook.sort-create-time")}</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="updateTime">{t("notebook.sort-update-time")}</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="alphabetical">{t("notebook.sort-alphabetical")}</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link to="/shelf">{t("notebook.go-to-bookshelf")}</Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <PromptDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={t("notebook.new-workspace")}
        placeholder={t("notebook.workspace-title-placeholder")}
        onConfirm={async (title) => {
          const workspace = await createWorkspace.mutateAsync(title);
          onCreated?.(workspace.name);
        }}
      />
      {current && (
        <PromptDialog
          open={renameOpen}
          onOpenChange={setRenameOpen}
          title={t("notebook.rename-workspace")}
          defaultValue={current.title}
          onConfirm={async (title) => {
            await updateWorkspace.mutateAsync({
              workspace: { ...current, title },
              updateMask: ["title"],
            });
          }}
        />
      )}
      {current && <WorkspaceCoverColorDialog workspace={current} open={coverColorOpen} onOpenChange={setCoverColorOpen} />}
      {current && <WorkspaceCoverImageDialog workspace={current} open={coverImageOpen} onOpenChange={setCoverImageOpen} />}
    </div>
  );
};

export default WorkspaceSelector;
