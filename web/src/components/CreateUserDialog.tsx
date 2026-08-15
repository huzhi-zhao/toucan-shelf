import { create } from "@bufbuild/protobuf";
import { FieldMaskSchema } from "@bufbuild/protobuf/wkt";
import { useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { userServiceClient } from "@/connect";
import useLoading from "@/hooks/useLoading";
import { handleError } from "@/lib/error";
import { User, UserSchema } from "@/types/proto/api/v1/user_service_pb";
import { useTranslate } from "@/utils/i18n";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user?: User;
  onSuccess?: () => void;
}

function CreateUserDialog({ open, onOpenChange, user: initialUser, onSuccess }: Props) {
  const t = useTranslate();
  const [user, setUser] = useState(create(UserSchema, initialUser ? { name: initialUser.name, username: initialUser.username } : {}));
  const requestState = useLoading(false);
  const isCreating = !initialUser;

  useEffect(() => {
    if (initialUser) {
      setUser(create(UserSchema, { name: initialUser.name, username: initialUser.username }));
    } else {
      setUser(create(UserSchema, {}));
    }
  }, [initialUser]);

  const setPartialUser = (state: Partial<User>) => {
    setUser({
      ...user,
      ...state,
    });
  };

  const handleConfirm = async () => {
    if (isCreating && (!user.username || !user.password)) {
      toast.error("Username and password cannot be empty");
      return;
    }

    try {
      requestState.setLoading();
      if (isCreating) {
        await userServiceClient.createUser({ user });
        toast.success("Create user successfully");
      } else {
        const updateMask = [];
        if (user.username !== initialUser?.username) {
          updateMask.push("username");
        }
        if (user.password) {
          updateMask.push("password");
        }
        const userToUpdate = create(UserSchema, { ...user, name: initialUser?.name ?? user.name });
        await userServiceClient.updateUser({ user: userToUpdate, updateMask: create(FieldMaskSchema, { paths: updateMask }) });
        toast.success("Update user successfully");
      }
      requestState.setFinish();
      onSuccess?.();
      onOpenChange(false);
    } catch (error: unknown) {
      handleError(error, toast.error, {
        context: user ? "Update user" : "Create user",
        onError: () => requestState.setError(),
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{`${isCreating ? t("common.create") : t("common.edit")} ${t("common.user")}`}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="username">{t("common.username")}</Label>
            <Input
              id="username"
              type="text"
              placeholder={t("common.username")}
              value={user.username}
              onChange={(e) =>
                setPartialUser({
                  username: e.target.value,
                })
              }
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">{t("common.password")}</Label>
            <Input
              id="password"
              type="password"
              placeholder={t("common.password")}
              autoComplete="off"
              value={user.password}
              onChange={(e) =>
                setPartialUser({
                  password: e.target.value,
                })
              }
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={requestState.isLoading} onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button disabled={requestState.isLoading} onClick={handleConfirm}>
            {t("common.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default CreateUserDialog;
