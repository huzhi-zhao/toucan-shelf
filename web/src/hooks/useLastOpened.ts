import { create } from "@bufbuild/protobuf";
import { FieldMaskSchema } from "@bufbuild/protobuf/wkt";
import { useCallback } from "react";
import { userServiceClient } from "@/connect";
import { buildUserSettingName } from "@/helpers/resource-names";
import { UserSetting_Key, UserSettingSchema } from "@/types/proto/api/v1/user_service_pb";

// Reads and writes the LAST_OPENED user setting (workspace + memo last viewed
// in the Notebook page), so the page can restore the user's place on load.
export function useLastOpened(currentUserName?: string) {
  const getLastOpened = useCallback(async (): Promise<{ workspace: string; memo: string } | undefined> => {
    if (!currentUserName) return undefined;
    try {
      const name = buildUserSettingName(currentUserName, UserSetting_Key.LAST_OPENED);
      const setting = await userServiceClient.getUserSetting({ name });
      if (setting.value.case === "lastOpenedSetting") {
        return {
          workspace: setting.value.value.workspace,
          memo: setting.value.value.memo,
        };
      }
      return undefined;
    } catch {
      return undefined;
    }
  }, [currentUserName]);

  const setLastOpened = useCallback(
    async (workspace: string, memo: string) => {
      if (!currentUserName) return;
      const name = buildUserSettingName(currentUserName, UserSetting_Key.LAST_OPENED);
      const setting = create(UserSettingSchema, {
        name,
        value: { case: "lastOpenedSetting", value: { workspace, memo } },
      });
      try {
        await userServiceClient.updateUserSetting({
          setting,
          updateMask: create(FieldMaskSchema, {
            paths: ["lastOpenedSetting"],
          }),
        });
      } catch {
        // Best-effort; failing to persist the last-opened pointer shouldn't block the UI.
      }
    },
    [currentUserName],
  );

  return { getLastOpened, setLastOpened };
}
