import { create } from "@bufbuild/protobuf";
import { FieldMaskSchema } from "@bufbuild/protobuf/wkt";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { userServiceClient } from "@/connect";
import { buildUserSettingName } from "@/helpers/resource-names";
import { userKeys } from "@/hooks/useUserQueries";
import { UserSetting_Key, type UserSetting_MeItem, UserSettingSchema } from "@/types/proto/api/v1/user_service_pb";

const meItemsKey = (userName: string) => [...userKeys.all, "meItems", userName] as const;

/** The custom items on the mobile "Me" page, in display order (ME_ITEMS user setting). */
export function useMeItems(userName?: string) {
  return useQuery({
    queryKey: meItemsKey(userName ?? ""),
    queryFn: async () => {
      const setting = await userServiceClient.getUserSetting({ name: buildUserSettingName(userName!, UserSetting_Key.ME_ITEMS) });
      return setting.value.case === "meItemsSetting" ? setting.value.value.items : [];
    },
    enabled: Boolean(userName),
  });
}

/**
 * Saves the whole list: the server replaces it on every update. The list shows the change at once and rolls
 * back if the save fails, so dragging a row does not wait for the network.
 */
export function useSaveMeItems(userName?: string) {
  const queryClient = useQueryClient();
  const key = meItemsKey(userName ?? "");
  return useMutation({
    mutationFn: async (items: UserSetting_MeItem[]) => {
      const setting = create(UserSettingSchema, {
        name: buildUserSettingName(userName!, UserSetting_Key.ME_ITEMS),
        value: { case: "meItemsSetting", value: { items } },
      });
      await userServiceClient.updateUserSetting({ setting, updateMask: create(FieldMaskSchema, { paths: ["me_items_setting"] }) });
    },
    onMutate: async (items) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<UserSetting_MeItem[]>(key);
      queryClient.setQueryData(key, items);
      return { previous };
    },
    onError: (_error, _items, context) => {
      queryClient.setQueryData(key, context?.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}
