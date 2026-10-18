import { create } from "@bufbuild/protobuf";
import { FieldMaskSchema } from "@bufbuild/protobuf/wkt";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { favoriteServiceClient } from "@/connect";
import { FavoriteSchema } from "@/types/proto/api/v1/favorite_service_pb";

// The user's reading list (docs/dev/requirements/mobile-phase3.md §2). It is small and every change reorders
// it, so each write simply refetches the whole list.
export const favoriteKeys = {
  all: ["favorites"] as const,
};

/** Favorites, pinned first, then the most recently added first. */
export function useFavorites(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: favoriteKeys.all,
    queryFn: async () => (await favoriteServiceClient.listFavorites({})).favorites,
    enabled: options?.enabled ?? true,
  });
}

/** `memos/{uid}` → `favorites/{uid}`. */
export const favoriteName = (memoName: string) => memoName.replace(/^memos\//, "favorites/");

/** Adds or removes a document, by its resource name (`memos/{uid}`). */
export function useToggleFavorite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ memo, favorite }: { memo: string; favorite: boolean }) => {
      if (favorite) await favoriteServiceClient.addFavorite({ memo });
      else await favoriteServiceClient.deleteFavorite({ name: favoriteName(memo) });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: favoriteKeys.all }),
  });
}

export function useSetFavoritePinned() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, pinned }: { name: string; pinned: boolean }) =>
      favoriteServiceClient.updateFavorite({
        favorite: create(FavoriteSchema, { name, pinned }),
        updateMask: create(FieldMaskSchema, { paths: ["pinned"] }),
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: favoriteKeys.all }),
  });
}
