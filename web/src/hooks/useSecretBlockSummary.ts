import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { secretBlockServiceClient } from "@/connect";
import type { SecretBlockSummary } from "@/types/proto/api/v1/secret_block_service_pb";

// A secret block's metadata, never its envelope. For a restricted block this is
// how the card learns its unlock state: fetching the envelope itself would start
// the viewing window, so it is only fetched when the reader asks to view.

export const secretBlockSummaryKeys = {
  all: ["secret-block-summary"] as const,
  detail: (name: string) => [...secretBlockSummaryKeys.all, name] as const,
};

export const fetchSecretBlockSummary = (name: string): Promise<SecretBlockSummary> =>
  secretBlockServiceClient.getSecretBlockSummary({ name });

export function useSecretBlockSummary(name: string | undefined) {
  return useQuery({
    queryKey: secretBlockSummaryKeys.detail(name ?? ""),
    queryFn: () => fetchSecretBlockSummary(name ?? ""),
    enabled: !!name,
    // Unlock state is time-based and decided by the server; refetch when the
    // reader comes back rather than trusting a stale "pending".
    refetchOnWindowFocus: true,
    retry: false,
  });
}

/** Writes a summary returned by a mutation straight into the cache. */
export function useSetSecretBlockSummary() {
  const queryClient = useQueryClient();
  return useCallback(
    (summary: SecretBlockSummary) => queryClient.setQueryData(secretBlockSummaryKeys.detail(summary.name), summary),
    [queryClient],
  );
}
