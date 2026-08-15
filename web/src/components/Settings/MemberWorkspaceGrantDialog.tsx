import { LoaderIcon } from "lucide-react";
import { useMemo } from "react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  useCreateWorkspaceGrant,
  useDeleteWorkspaceGrant,
  useUpdateWorkspaceGrant,
  useWorkspaceGrantsForUser,
  useWorkspaces,
} from "@/hooks/useWorkspaceQueries";
import { handleError } from "@/lib/error";
import type { User } from "@/types/proto/api/v1/user_service_pb";
import { WorkspaceGrant_Role } from "@/types/proto/api/v1/workspace_service_pb";
import { useTranslate } from "@/utils/i18n";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member?: User;
}

/**
 * Assigns knowledge bases to one member. Every change is written through immediately
 * rather than collected behind a save button: each row is one grant on the server, and
 * a batched form would have to invent a diff the API has no call for.
 */
const MemberWorkspaceGrantDialog = ({ open, onOpenChange, member }: Props) => {
  const t = useTranslate();
  // Hidden bases are included: hiding is a shelf-level preference of the admin's, not
  // a reason a member should be unable to hold access to what is in there.
  const { data: workspaces = [], isLoading: workspacesLoading } = useWorkspaces(true);
  const { data: grants = [], isLoading: grantsLoading } = useWorkspaceGrantsForUser(open ? member?.name : undefined);
  const createGrant = useCreateWorkspaceGrant();
  const updateGrant = useUpdateWorkspaceGrant();
  const deleteGrant = useDeleteWorkspaceGrant();

  const grantByWorkspace = useMemo(() => new Map(grants.map((grant) => [grant.workspace, grant])), [grants]);
  const isBusy = createGrant.isPending || updateGrant.isPending || deleteGrant.isPending;

  const handleToggle = async (workspaceName: string, assigned: boolean) => {
    if (!member) return;
    try {
      const existing = grantByWorkspace.get(workspaceName);
      if (assigned && !existing) {
        // A newly assigned member starts as a viewer: widening to editor is one click
        // away, while the reverse mistake silently hands out write access.
        await createGrant.mutateAsync({
          workspace: workspaceName,
          user: member.name,
          role: WorkspaceGrant_Role.VIEWER,
        });
      } else if (!assigned && existing) {
        await deleteGrant.mutateAsync(existing.name);
      }
    } catch (error: unknown) {
      handleError(error, toast.error, { context: "Update workspace grant" });
    }
  };

  const handleRoleChange = async (workspaceName: string, role: WorkspaceGrant_Role) => {
    const existing = grantByWorkspace.get(workspaceName);
    if (!existing) return;
    try {
      await updateGrant.mutateAsync({ name: existing.name, role });
    } catch (error: unknown) {
      handleError(error, toast.error, { context: "Update workspace grant" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("setting.member.assign-workspaces")}</DialogTitle>
          <DialogDescription>
            {member
              ? t("setting.member.assign-workspaces-description", {
                  username: member.username,
                })
              : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
          {workspacesLoading || grantsLoading ? (
            <div className="flex items-center justify-center py-6 text-muted-foreground">
              <LoaderIcon className="h-5 w-5 animate-spin" />
            </div>
          ) : workspaces.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("setting.member.no-workspaces-to-assign")}</p>
          ) : (
            workspaces.map((workspace) => {
              const grant = grantByWorkspace.get(workspace.name);
              return (
                <div key={workspace.name} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/50">
                  <Checkbox
                    id={`grant-${workspace.name}`}
                    checked={!!grant}
                    disabled={isBusy}
                    onCheckedChange={(checked) => handleToggle(workspace.name, checked === true)}
                  />
                  <label htmlFor={`grant-${workspace.name}`} className="min-w-0 flex-1 truncate text-sm">
                    {workspace.title}
                  </label>
                  <Select
                    value={String(grant?.role ?? WorkspaceGrant_Role.VIEWER)}
                    disabled={!grant || isBusy}
                    onValueChange={(value) => handleRoleChange(workspace.name, Number(value) as WorkspaceGrant_Role)}
                  >
                    <SelectTrigger className="w-28" size="sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={String(WorkspaceGrant_Role.VIEWER)}>{t("setting.member.grant-role-viewer")}</SelectItem>
                      <SelectItem value={String(WorkspaceGrant_Role.EDITOR)}>{t("setting.member.grant-role-editor")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              );
            })
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default MemberWorkspaceGrantDialog;
