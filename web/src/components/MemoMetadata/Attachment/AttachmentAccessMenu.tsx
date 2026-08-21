// The one entry point for an attachment's access mode (INHERIT / LOCKED / PUBLIC).
//
// It lives on the editor's attachment row and nowhere else. It used to sit in the
// read-only attachment list instead, which put it in the one place that never shows
// the most common case: an image inserted into the body is `origin = INLINE` and gets
// partitioned out of that list entirely (partitionInlinedAttachments), so there was no
// way at all to publish the picture in your document. The editor's list has the eye
// toggle that reveals inline attachments, so every attachment is reachable from here.
//
// The three modes are offered as a state machine rather than as two independent
// toggles, mirroring the storepb enum (决策 5 — "locked and public" must not be
// expressible):
//
//   INHERIT → 设为私密 | 设为公开直链
//   LOCKED  → 取消设为私密                  (nothing else: publishing a locked file
//                                            would be two conflicting intents in one
//                                            click, so it goes through INHERIT)
//   PUBLIC  → 复制链接 | 取消公开 | 设为私密  (both ways out are confirmed — they break
//                                            links that may live outside this app)

import { Code, ConnectError } from "@connectrpc/connect";
import copy from "copy-to-clipboard";
import { GlobeIcon, GlobeLockIcon, LinkIcon, LockIcon, LockOpenIcon, MoreVerticalIcon } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";
import ConfirmDialog from "@/components/ConfirmDialog";
import UnlockMasterKeyDialog from "@/components/Secret/UnlockMasterKeyDialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useInstance } from "@/contexts/InstanceContext";
import { useSetAttachmentAccess } from "@/hooks/useAttachmentAccess";
import { useAttachmentVault, VaultLockedError } from "@/hooks/useAttachmentVault";
import { type Attachment, AttachmentAccess } from "@/types/proto/api/v1/attachment_service_pb";
import { getAttachmentUrl } from "@/utils/attachment";
import { useTranslate } from "@/utils/i18n";

// Which mode the pending confirmation would move to, or "unlock-needed" while the
// master-passphrase dialog is standing in for a transition that has to wait for it.
type PendingAccess = AttachmentAccess.ACCESS_INHERIT | AttachmentAccess.ACCESS_LOCKED;

const AttachmentAccessMenu = ({ attachment }: { attachment: Attachment }) => {
  const t = useTranslate();
  const { profile } = useInstance();
  const vault = useAttachmentVault();
  const { mutateAsync: setAccess, isPending } = useSetAttachmentAccess();
  // Set while the master-passphrase dialog is open, so the transition that needed it
  // can be replayed once the key is available instead of making the user click twice.
  const [retryAfterUnlock, setRetryAfterUnlock] = useState<PendingAccess | null>(null);
  const [leavingPublicTo, setLeavingPublicTo] = useState<PendingAccess | null>(null);

  const access = attachment.access;
  const isLocked = access === AttachmentAccess.ACCESS_LOCKED;
  const isPublic = access === AttachmentAccess.ACCESS_PUBLIC;
  // Both the server-side gate on publishing (决策 6) and the only origin worth putting
  // on a clipboard. Without an instance URL the entries simply don't appear.
  const publicLinkOrigin = profile.instanceUrl;

  const copyPublicLink = () => {
    copy(`${publicLinkOrigin}${getAttachmentUrl(attachment)}`);
    toast.success(t("attachment.public.copy-success"));
  };

  // Every transition out of LOCKED needs an open vault, because the server treats
  // unlocking as a read of the passphrase gate (authorizeAttachmentAccessUpdate).
  // Returns false when the master passphrase itself is missing — the dialog is now
  // open and will replay the transition.
  const ensureVaultOpen = async (retryWith: PendingAccess): Promise<boolean> => {
    if (vault.unlocked) {
      return true;
    }
    try {
      await vault.unlock();
      return true;
    } catch (err) {
      if (err instanceof VaultLockedError) {
        setRetryAfterUnlock(retryWith);
        return false;
      }
      toast.error(t("attachment.vault.unlock-error"));
      return false;
    }
  };

  const applyAccess = async (next: AttachmentAccess) => {
    if (isLocked && !(await ensureVaultOpen(next as PendingAccess))) {
      return;
    }
    try {
      await setAccess({ name: attachment.name, access: next });
      if (next === AttachmentAccess.ACCESS_PUBLIC) {
        copyPublicLink();
      }
    } catch (err) {
      // The account has never set up a master passphrase, so locking would produce a
      // file it cannot open again (R8). Guide rather than just report.
      if (next === AttachmentAccess.ACCESS_LOCKED && err instanceof ConnectError && err.code === Code.FailedPrecondition) {
        setRetryAfterUnlock(AttachmentAccess.ACCESS_LOCKED);
        return;
      }
      toast.error(t("attachment.public.error"));
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild onClick={(event) => event.stopPropagation()}>
          <Button variant="ghost" size="icon-sm" title={t("attachment.access.menu")} aria-label={t("attachment.access.menu")}>
            {isLocked ? (
              <LockIcon className="h-3 w-3 text-muted-foreground" />
            ) : isPublic ? (
              <GlobeIcon className="h-3 w-3 text-muted-foreground" />
            ) : (
              <MoreVerticalIcon className="h-3 w-3 text-muted-foreground" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
          {isLocked && (
            <DropdownMenuItem disabled={isPending} onClick={() => applyAccess(AttachmentAccess.ACCESS_INHERIT)}>
              <LockOpenIcon className="h-4 w-4" />
              {t("attachment.access.unset-private")}
            </DropdownMenuItem>
          )}

          {isPublic && (
            <>
              <DropdownMenuItem onClick={copyPublicLink}>
                <LinkIcon className="h-4 w-4" />
                {t("attachment.public.copy-link")}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={isPending} onClick={() => setLeavingPublicTo(AttachmentAccess.ACCESS_INHERIT)}>
                <GlobeLockIcon className="h-4 w-4" />
                {t("attachment.public.make-private")}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={isPending} onClick={() => setLeavingPublicTo(AttachmentAccess.ACCESS_LOCKED)}>
                <LockIcon className="h-4 w-4" />
                {t("attachment.vault.make-private")}
              </DropdownMenuItem>
            </>
          )}

          {!isLocked && !isPublic && (
            <>
              <DropdownMenuItem disabled={isPending} onClick={() => applyAccess(AttachmentAccess.ACCESS_LOCKED)}>
                <LockIcon className="h-4 w-4" />
                {t("attachment.vault.make-private")}
              </DropdownMenuItem>
              {publicLinkOrigin !== "" && (
                <DropdownMenuItem disabled={isPending} onClick={() => applyAccess(AttachmentAccess.ACCESS_PUBLIC)}>
                  <GlobeIcon className="h-4 w-4" />
                  {t("attachment.public.make-public")}
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Leaving PUBLIC is the only transition whose blast radius is outside this app:
          the link may already be sitting in someone else's blog post or chat window. */}
      <ConfirmDialog
        open={leavingPublicTo !== null}
        onOpenChange={(open) => !open && setLeavingPublicTo(null)}
        title={t("attachment.public.leave-confirm-title")}
        description={t("attachment.public.leave-confirm-description", { filename: attachment.filename })}
        confirmLabel={t("common.confirm")}
        cancelLabel={t("common.cancel")}
        confirmVariant="destructive"
        onConfirm={async () => {
          const next = leavingPublicTo;
          setLeavingPublicTo(null);
          if (next !== null) {
            await applyAccess(next);
          }
        }}
      />

      <UnlockMasterKeyDialog
        open={retryAfterUnlock !== null}
        onOpenChange={(open) => !open && setRetryAfterUnlock(null)}
        onUnlocked={async () => {
          const next = retryAfterUnlock;
          setRetryAfterUnlock(null);
          if (next === null) {
            return;
          }
          try {
            // Locking only ever needed the master key (R8 checks it server-side);
            // unlocking additionally needs the vault cookie the proof buys.
            if (next !== AttachmentAccess.ACCESS_LOCKED) {
              await vault.unlock();
            }
            await setAccess({ name: attachment.name, access: next });
          } catch {
            toast.error(t("attachment.public.error"));
          }
        }}
      />
    </>
  );
};

export default AttachmentAccessMenu;
