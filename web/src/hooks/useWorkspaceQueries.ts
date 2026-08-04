import { create } from "@bufbuild/protobuf";
import { FieldMaskSchema } from "@bufbuild/protobuf/wkt";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { workspaceServiceClient } from "@/connect";
import type { Workspace } from "@/types/proto/api/v1/workspace_service_pb";
import { WorkspaceSchema } from "@/types/proto/api/v1/workspace_service_pb";

export const workspaceKeys = {
  all: ["workspaces"] as const,
  lists: () => [...workspaceKeys.all, "list"] as const,
  tree: (name?: string, archived?: boolean) => [...workspaceKeys.all, "tree", name, archived] as const,
};

// Exported so callers that only need the list *on demand* (e.g. the logo button resolving the
// last-opened document) can go through queryClient.fetchQuery with the same key, reusing the
// cache instead of mounting the query on every page.
export async function fetchWorkspaces(): Promise<Workspace[]> {
  const { workspaces } = await workspaceServiceClient.listWorkspaces({});
  return workspaces;
}

export function useWorkspaces() {
  return useQuery({
    queryKey: workspaceKeys.lists(),
    queryFn: fetchWorkspaces,
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workspaceKeys.lists() });
    },
  });
}

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
