import { ExternalLinkIcon, InfoIcon, LibraryBigIcon, SettingsIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { workspaceDetailPath } from "@/router/routes";
import type { Workspace } from "@/types/proto/api/v1/workspace_service_pb";
import { useTranslate } from "@/utils/i18n";
import { WorkspaceCoverColorDialog, WorkspaceCoverImageDialog } from "./WorkspaceCoverDialogs";
import WorkspaceSortMenuItems from "./WorkspaceSortMenu";

interface Props {
  workspaces: Workspace[];
  value?: string;
  onChange: (name: string) => void;
  onOpenInNewTab?: () => void;
}

const WorkspaceSelector = ({ workspaces, value, onChange, onOpenInNewTab }: Props) => {
  const t = useTranslate();
  const [coverColorOpen, setCoverColorOpen] = useState(false);
  const [coverImageOpen, setCoverImageOpen] = useState(false);

  const current = workspaces.find((w) => w.name === value);

  return (
    <div className="w-full flex flex-row items-center gap-1">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="flex-1 min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <LibraryBigIcon className="w-4 h-4 shrink-0 opacity-70" />
            {/*
              The clamp has to live on a wrapper: SelectValue renders whatever Radix
              gives it, and a long title only shrinks if the element holding it is
              itself a min-w-0 flex item with overflow hidden.
            */}
            <span className="min-w-0 truncate">
              <SelectValue placeholder={t("notebook.select-workspace")} />
            </span>
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
          {/*
            Workspace-level management (create / rename / hide) lives on the detail
            page now; what stays here is the current workspace's browsing settings.
          */}
          {current && (
            <DropdownMenuItem asChild>
              <Link to={workspaceDetailPath(current.name)}>
                <InfoIcon className="w-4 h-4 mr-2" />
                {t("notebook.workspace-details")}
              </Link>
            </DropdownMenuItem>
          )}
          {current && onOpenInNewTab && (
            <DropdownMenuItem onClick={onOpenInNewTab}>
              <ExternalLinkIcon className="w-4 h-4 mr-2" />
              {t("notebook.open-in-new-tab")}
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
                  <WorkspaceSortMenuItems workspace={current} />
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
      {current && <WorkspaceCoverColorDialog workspace={current} open={coverColorOpen} onOpenChange={setCoverColorOpen} />}
      {current && <WorkspaceCoverImageDialog workspace={current} open={coverImageOpen} onOpenChange={setCoverImageOpen} />}
    </div>
  );
};

export default WorkspaceSelector;
