import { createContext, useContext, useMemo } from "react";
import { useWorkspaces } from "@/hooks/useWorkspaceQueries";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";

/**
 * The workspace ("workspaces/{uid}") that this editor's attachment uploads belong to.
 *
 * Attachments are uploaded before the memo exists, so the server cannot infer the workspace
 * from the memo the way it can for everything else — the client has to say which knowledge
 * base the blob belongs to, and it decides the blob's directory in S3 storage.
 */
const UploadWorkspaceContext = createContext<string | undefined>(undefined);

export const UploadWorkspaceProvider = ({ memo, children }: { memo?: Memo; children: React.ReactNode }) => {
  const { data: workspaces } = useWorkspaces();
  // Editing an existing memo pins the workspace exactly. When composing a brand-new memo
  // outside a workspace context (the flat memo list), fall back to the first workspace —
  // that is the same one the server will file the memo under (resolveOrCreateDefaultWorkspace),
  // so the blob and the memo end up in the same place.
  const workspace = useMemo(() => memo?.workspace || workspaces?.[0]?.name, [memo?.workspace, workspaces]);

  return <UploadWorkspaceContext.Provider value={workspace}>{children}</UploadWorkspaceContext.Provider>;
};

export const useUploadWorkspace = () => useContext(UploadWorkspaceContext);
