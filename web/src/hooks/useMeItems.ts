import { create } from "@bufbuild/protobuf";
import { FieldMaskSchema } from "@bufbuild/protobuf/wkt";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { userServiceClient } from "@/connect";
import { buildUserSettingName } from "@/helpers/resource-names";
import { userKeys } from "@/hooks/useUserQueries";
import {
  UserSetting_Key,
  type UserSetting_MeGroup,
  type UserSetting_MeItem,
  UserSetting_MeItem_Style,
  UserSettingSchema,
} from "@/types/proto/api/v1/user_service_pb";

/** The "Me" page's items and the groups they are shown in, each in display order. */
export interface MeItems {
  items: UserSetting_MeItem[];
  groups: UserSetting_MeGroup[];
}

const meItemsKey = (userName: string) => [...userKeys.all, "meItems", userName] as const;

/** The custom items on the mobile "Me" page and their groups (ME_ITEMS user setting). */
export function useMeItems(userName?: string) {
  return useQuery({
    queryKey: meItemsKey(userName ?? ""),
    queryFn: async (): Promise<MeItems> => {
      const setting = await userServiceClient.getUserSetting({ name: buildUserSettingName(userName!, UserSetting_Key.ME_ITEMS) });
      return setting.value.case === "meItemsSetting"
        ? { items: setting.value.value.items, groups: setting.value.value.groups }
        : { items: [], groups: [] };
    },
    enabled: Boolean(userName),
  });
}

/**
 * Saves the whole setting: the server replaces it on every update. The page shows the change at once and rolls
 * back if the save fails, so dragging a row does not wait for the network.
 */
export function useSaveMeItems(userName?: string) {
  const queryClient = useQueryClient();
  const key = meItemsKey(userName ?? "");
  return useMutation({
    mutationFn: async ({ items, groups }: MeItems) => {
      const setting = create(UserSettingSchema, {
        name: buildUserSettingName(userName!, UserSetting_Key.ME_ITEMS),
        value: { case: "meItemsSetting", value: { items, groups } },
      });
      await userServiceClient.updateUserSetting({ setting, updateMask: create(FieldMaskSchema, { paths: ["me_items_setting"] }) });
    },
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<MeItems>(key);
      queryClient.setQueryData(key, next);
      return { previous };
    },
    onError: (_error, _next, context) => {
      queryClient.setQueryData(key, context?.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

/** One block of the "Me" page: a group (or, with no group, the items outside every group) and its items. */
export interface MeSection {
  group?: UserSetting_MeGroup;
  items: UserSetting_MeItem[];
}

/**
 * The page's blocks in display order: the items outside every group first, then each group. An item naming a
 * group that no longer exists counts as outside every group. Empty blocks are kept; the caller decides
 * whether to show them.
 */
export function meSections({ items, groups }: MeItems): MeSection[] {
  const known = new Set(groups.map((group) => group.id));
  return [
    { items: items.filter((item) => !known.has(item.group)) },
    ...groups.map((group) => ({ group, items: items.filter((item) => item.group === group.id) })),
  ];
}

/** Whether an item is a tile in the grid at the top of the page, shown there instead of in its group. */
export const isMeTile = (item: UserSetting_MeItem) => item.style === UserSetting_MeItem_Style.GRID;

/** The flat item list for a page's blocks: what is saved, so the stored order is the display order. */
export const flattenSections = (sections: MeSection[]): UserSetting_MeItem[] => sections.flatMap((section) => section.items);

/** A new id for an item or a group: random, so two devices adding at once do not collide. */
export const newMeId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
