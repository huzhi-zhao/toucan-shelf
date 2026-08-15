import { create } from "@bufbuild/protobuf";
import { FieldMaskSchema } from "@bufbuild/protobuf/wkt";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { workspaceServiceClient } from "@/connect";
import type { Workspace, WorkspaceGrant_Role } from "@/types/proto/api/v1/workspace_service_pb";
import { WorkspaceGrantSchema, WorkspaceSchema } from "@/types/proto/api/v1/workspace_service_pb";

export const workspaceKeys = {
  all: ["workspaces"] as const,
  lists: () => [...workspaceKeys.all, "list"] as const,
  list: (showHidden: boolean) => [...workspaceKeys.lists(), { showHidden }] as const,
  detail: (name?: string) => [...workspaceKeys.all, "detail", name] as const,
  tree: (name?: string, archived?: boolean) => [...workspaceKeys.all, "tree", name, archived] as const,
  grants: () => [...workspaceKeys.all, "grants"] as const,
  grantsForUser: (user?: string) => [...workspaceKeys.grants(), { user }] as const,
};

// Exported so callers that only need the list *on demand* (e.g. the logo button resolving the
// last-opened document) can go through queryClient.fetchQuery with the same key, reusing the
// cache instead of mounting the query on every page.
export async function fetchWorkspaces(showHidden = false): Promise<Workspace[]> {
  const { workspaces } = await workspaceServiceClient.listWorkspaces({ showHidden });
  return workspaces;
}

/**
 * The user's workspaces, ordered by the server (display_order, then create time).
 * `showHidden` is only set by the bookshelf's restore view — everywhere else must
 * see the visible-only list, which is what makes hiding mean anything.
 */
export function useWorkspaces(showHidden = false) {
  return useQuery({
    queryKey: workspaceKeys.list(showHidden),
    queryFn: () => fetchWorkspaces(showHidden),
  });
}

export function useWorkspaceTree(name: string | undefined, archived: boolean) {
  return useQuery({
    queryKey: workspaceKeys.tree(name, archived),
    queryFn: async () => {
      const { nodes } = await workspaceServiceClient.getWorkspaceTree({
        name: name!,
        archived,
      });
      return nodes;
    },
    enabled: !!name,
  });
}

export function useCreateWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (title: string) => {
      const workspace = create(WorkspaceSchema, { title });
      return workspaceServiceClient.createWorkspace({ workspace });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workspaceKeys.lists() });
    },
  });
}

export function useUpdateWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ workspace, updateMask }: { workspace: Workspace; updateMask: string[] }) => {
      return workspaceServiceClient.updateWorkspace({
        workspace,
        updateMask: create(FieldMaskSchema, { paths: updateMask }),
      });
    },
    // Invalidate the whole namespace, not just the lists: the detail page reads a
    // workspace through its own query key and would otherwise show stale values.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workspaceKeys.all });
    },
  });
}

/**
 * A single workspace by resource name. The detail page uses this rather than picking
 * out of the list: a hidden workspace is absent from the default list but must still
 * open by URL, otherwise it could never be restored.
 */
export function useWorkspace(name: string | undefined) {
  return useQuery({
    queryKey: workspaceKeys.detail(name),
    queryFn: () => workspaceServiceClient.getWorkspace({ name: name! }),
    enabled: !!name,
  });
}

/** Hide (soft delete) or restore a workspace. */
export function useSetWorkspaceHidden() {
  const update = useUpdateWorkspace();
  return {
    ...update,
    mutateAsync: ({ workspace, hidden }: { workspace: Workspace; hidden: boolean }) =>
      update.mutateAsync({ workspace: { ...workspace, hidden }, updateMask: ["hidden"] }),
  };
}

/** Set a workspace's manual position on the shelf. Smaller sorts first. */
export function useSetWorkspaceOrder() {
  const update = useUpdateWorkspace();
  return {
    ...update,
    mutateAsync: ({ workspace, displayOrder }: { workspace: Workspace; displayOrder: number }) =>
      update.mutateAsync({ workspace: { ...workspace, displayOrder }, updateMask: ["display_order"] }),
  };
}

/**
 * Permanently deletes a workspace. No longer reachable from the UI — hiding is the
 * product-level delete. Kept because the RPC still exists; wire it up deliberately.
 */
export function useDeleteWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      await workspaceServiceClient.deleteWorkspace({ name });
      return name;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workspaceKeys.lists() });
    },
  });
}

export function useCreateWorkspaceFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ parent, path }: { parent: string; path: string }) => {
      return workspaceServiceClient.createWorkspaceFolder({
        parent,
        folder: { name: "", path },
      });
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.tree(variables.parent, false),
      });
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.tree(variables.parent, true),
      });
    },
  });
}

export function useRenameWorkspaceFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ parent, oldPath, newPath }: { parent: string; oldPath: string; newPath: string }) => {
      return workspaceServiceClient.renameWorkspaceFolder({
        parent,
        oldPath,
        newPath,
      });
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.tree(variables.parent, false),
      });
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.tree(variables.parent, true),
      });
    },
  });
}

export function useMoveWorkspaceFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      parent,
      path,
      destinationWorkspace,
      destinationFolderPath,
    }: {
      parent: string;
      path: string;
      destinationWorkspace: string;
      destinationFolderPath: string;
    }) => {
      return workspaceServiceClient.moveWorkspaceFolder({
        parent,
        path,
        destinationWorkspace,
        destinationFolderPath,
      });
    },
    // Both ends of the move change, so the destination workspace's tree has to be
    // dropped too — it is a different query key from the source's.
    onSuccess: (_data, variables) => {
      for (const workspace of [variables.parent, variables.destinationWorkspace]) {
        queryClient.invalidateQueries({ queryKey: workspaceKeys.tree(workspace, false) });
        queryClient.invalidateQueries({ queryKey: workspaceKeys.tree(workspace, true) });
      }
    },
  });
}

export function useDeleteWorkspaceFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ parent, path }: { parent: string; path: string }) => {
      return workspaceServiceClient.deleteWorkspaceFolder({ parent, path });
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.tree(variables.parent, false),
      });
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.tree(variables.parent, true),
      });
    },
  });
}

/**
 * One member's knowledge-base assignments, across every base. The admin-only member
 * settings page asks this way round; the wildcard parent is what the API takes for
 * "not scoped to a single base".
 */
export function useWorkspaceGrantsForUser(user: string | undefined) {
  return useQuery({
    queryKey: workspaceKeys.grantsForUser(user),
    queryFn: async () => {
      const { grants } = await workspaceServiceClient.listWorkspaceGrants({ parent: "workspaces/-", user: user! });
      return grants;
    },
    enabled: !!user,
  });
}

export function useCreateWorkspaceGrant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ workspace, user, role }: { workspace: string; user: string; role: WorkspaceGrant_Role }) => {
      return workspaceServiceClient.createWorkspaceGrant({
        parent: workspace,
        grant: create(WorkspaceGrantSchema, { user, role }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workspaceKeys.grants() });
    },
  });
}

export function useUpdateWorkspaceGrant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, role }: { name: string; role: WorkspaceGrant_Role }) => {
      return workspaceServiceClient.updateWorkspaceGrant({
        grant: create(WorkspaceGrantSchema, { name, role }),
        updateMask: create(FieldMaskSchema, { paths: ["role"] }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workspaceKeys.grants() });
    },
  });
}

export function useDeleteWorkspaceGrant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      await workspaceServiceClient.deleteWorkspaceGrant({ name });
      return name;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workspaceKeys.grants() });
    },
  });
}
