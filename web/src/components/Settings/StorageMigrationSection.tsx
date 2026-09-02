import { create } from "@bufbuild/protobuf";
import { AlertTriangleIcon, CheckCircle2Icon, LoaderIcon } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { instanceServiceClient } from "@/connect";
import { useInstance } from "@/contexts/InstanceContext";
import { useDialog } from "@/hooks/useDialog";
import { handleError } from "@/lib/error";
import {
  InstanceSetting,
  InstanceSetting_Key,
  type InstanceSetting_StorageMigrationSetting,
  InstanceSetting_StorageMigrationSetting_State,
  InstanceSetting_StorageMigrationSettingSchema,
  InstanceSetting_StorageSetting_S3ConfigSchema,
  InstanceSettingSchema,
} from "@/types/proto/api/v1/instance_service_pb";
import { useTranslate } from "@/utils/i18n";
import SettingGroup from "./SettingGroup";
import SettingRow from "./SettingRow";
import { buildInstanceSettingName } from "./useInstanceSettingUpdater";

const MIGRATION_SETTING_NAME = buildInstanceSettingName(InstanceSetting_Key.STORAGE_MIGRATION);

const State = InstanceSetting_StorageMigrationSetting_State;

// While the worker is copying, the only source of truth for progress is the server, so the panel
// polls. It stops as soon as the migration reaches a state that only a person can move it out of.
const POLL_INTERVAL_MS = 3000;
const RUNNING_STATES = [State.FROZEN, State.MIGRATING, State.RECONCILING];

const stateLabelKeys = {
  [State.DRAFT]: "setting.storage.migration.state-draft",
  [State.PRECHECKED]: "setting.storage.migration.state-prechecked",
  [State.FROZEN]: "setting.storage.migration.state-frozen",
  [State.MIGRATING]: "setting.storage.migration.state-migrating",
  [State.RECONCILING]: "setting.storage.migration.state-reconciling",
  [State.READY]: "setting.storage.migration.state-ready",
} as const;

const emptyMigration = () => create(InstanceSetting_StorageMigrationSettingSchema, {});

const StorageMigrationSection = () => {
  const t = useTranslate();
  const { storageSetting } = useInstance();
  const [migration, setMigration] = useState<InstanceSetting_StorageMigrationSetting>(emptyMigration);
  const [busy, setBusy] = useState(false);

  // Draft of the target form. It is seeded from the current location so the admin edits the two
  // or three fields that actually move rather than retyping a whole connection.
  const [draft, setDraft] = useState(() => create(InstanceSetting_StorageSetting_S3ConfigSchema, {}));
  const [draftDirty, setDraftDirty] = useState(false);

  const applyResponse = useCallback((setting: InstanceSetting) => {
    if (setting.value.case === "storageMigrationSetting") {
      setMigration(setting.value.value);
      setDraftDirty(false);
    }
  }, []);

  const fetchMigration = useCallback(async () => {
    try {
      const setting = await instanceServiceClient.getInstanceSetting({ name: MIGRATION_SETTING_NAME });
      applyResponse(setting);
    } catch (error) {
      await handleError(error, toast.error, { context: "Load storage migration" });
    }
  }, [applyResponse]);

  useEffect(() => {
    void fetchMigration();
  }, [fetchMigration]);

  const running = RUNNING_STATES.includes(migration.state);
  useEffect(() => {
    if (!running) {
      return;
    }
    const timer = setInterval(() => {
      void fetchMigration();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [running, fetchMigration]);

  // Seed the form once, and keep it in step with the server whenever the admin has no unsaved
  // edits — otherwise a poll would wipe what they are typing.
  useEffect(() => {
    if (draftDirty) {
      return;
    }
    const target = migration.targetS3Config;
    const current = storageSetting.s3Config;
    setDraft(
      create(InstanceSetting_StorageSetting_S3ConfigSchema, {
        endpoint: target?.endpoint ?? current?.endpoint ?? "",
        region: target?.region ?? current?.region ?? "",
        bucket: target?.bucket ?? current?.bucket ?? "",
        rootPrefix: target?.rootPrefix ?? current?.rootPrefix ?? "",
        accessKeyId: target?.accessKeyId ?? current?.accessKeyId ?? "",
        accessKeySecret: "",
        usePathStyle: target?.usePathStyle ?? current?.usePathStyle ?? false,
        insecureSkipTlsVerify: target?.insecureSkipTlsVerify ?? current?.insecureSkipTlsVerify ?? false,
      }),
    );
  }, [migration, storageSetting, draftDirty]);

  const startDialog = useDialog();
  const switchDialog = useDialog();
  const abandonDialog = useDialog();

  const run = async (context: string, action: () => Promise<InstanceSetting>) => {
    setBusy(true);
    try {
      applyResponse(await action());
    } catch (error) {
      await handleError(error, toast.error, { context });
    } finally {
      setBusy(false);
    }
  };

  const updateDraft = (field: string, value: string | boolean) => {
    setDraftDirty(true);
    setDraft((prev) => create(InstanceSetting_StorageSetting_S3ConfigSchema, { ...prev, [field]: value }));
  };

  const saveTarget = () =>
    run("Save migration target", async () =>
      instanceServiceClient.updateInstanceSetting({
        setting: create(InstanceSettingSchema, {
          name: MIGRATION_SETTING_NAME,
          value: {
            case: "storageMigrationSetting",
            value: create(InstanceSetting_StorageMigrationSettingSchema, { targetS3Config: draft }),
          },
        }),
      }),
    );

  const precheck = () => run("Precheck storage migration", () => instanceServiceClient.precheckStorageMigration({}));
  const start = () => run("Start storage migration", () => instanceServiceClient.startStorageMigration({}));
  const retry = () => run("Retry storage migration", () => instanceServiceClient.retryStorageMigration({}));
  const abandon = () => run("Abandon storage migration", () => instanceServiceClient.abandonStorageMigration({}));
  const switchOver = async () => {
    await run("Switch storage migration", () => instanceServiceClient.switchStorageMigration({}));
    // The live storage setting just changed server-side, without going through the context's own
    // update path -- and the context caches each setting after its first fetch, so asking it to
    // refetch is a no-op. Reloading is blunt, but this happens once per migration and leaving the
    // page showing the old bucket after switching to a new one would be worse.
    window.location.reload();
  };

  // Nothing in S3 means nothing to move; the whole panel is noise on such an instance.
  if (!storageSetting.s3Config) {
    return null;
  }

  const progress = migration.progress;
  const failed = Number(progress?.failed ?? 0n);
  const precheckResult = migration.precheck;
  const editable = migration.state === State.STATE_UNSPECIFIED || migration.state === State.DRAFT;

  return (
    <SettingGroup
      title={t("setting.storage.migration.title")}
      description={t("setting.storage.migration.description")}
      showSeparator
      actions={
        migration.state in stateLabelKeys ? (
          <Badge variant="secondary">{t(stateLabelKeys[migration.state as keyof typeof stateLabelKeys])}</Badge>
        ) : undefined
      }
    >
      <SettingRow label={t("setting.storage.endpoint")}>
        <Input
          className="w-64"
          value={draft.endpoint}
          disabled={!editable}
          onChange={(e) => updateDraft("endpoint", e.target.value.trim())}
        />
      </SettingRow>
      <SettingRow label={t("setting.storage.region")}>
        <Input className="w-64" value={draft.region} disabled={!editable} onChange={(e) => updateDraft("region", e.target.value.trim())} />
      </SettingRow>
      <SettingRow label={t("setting.storage.bucket")}>
        <Input className="w-64" value={draft.bucket} disabled={!editable} onChange={(e) => updateDraft("bucket", e.target.value.trim())} />
      </SettingRow>
      <SettingRow label={t("setting.storage.root-prefix")} description={t("setting.storage.root-prefix-description")}>
        <Input
          className="w-64 font-mono"
          value={draft.rootPrefix}
          disabled={!editable}
          onChange={(e) => updateDraft("rootPrefix", e.target.value.trim())}
        />
      </SettingRow>
      <SettingRow label={t("setting.storage.accesskey")}>
        <Input
          className="w-64"
          value={draft.accessKeyId}
          disabled={!editable}
          onChange={(e) => updateDraft("accessKeyId", e.target.value.trim())}
        />
      </SettingRow>
      <SettingRow
        label={t("setting.storage.secretkey")}
        description={migration.targetS3Config ? t("setting.storage.secretkey-preserve-description") : undefined}
      >
        <Input
          className="w-64"
          type="password"
          value={draft.accessKeySecret}
          disabled={!editable}
          onChange={(e) => updateDraft("accessKeySecret", e.target.value.trim())}
        />
      </SettingRow>
      <SettingRow label={t("setting.storage.use-path-style")}>
        <Switch checked={draft.usePathStyle} disabled={!editable} onCheckedChange={(checked) => updateDraft("usePathStyle", checked)} />
      </SettingRow>

      {precheckResult && (
        <div className="flex items-start gap-2 text-xs">
          {precheckResult.passed ? (
            <CheckCircle2Icon className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
          ) : (
            <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          )}
          <div className="flex flex-col gap-1">
            <span className={precheckResult.passed ? "text-muted-foreground" : "text-destructive"}>
              {precheckResult.passed
                ? t("setting.storage.migration.precheck-passed")
                : t("setting.storage.migration.precheck-failed", { error: precheckResult.error })}
            </span>
            {precheckResult.passed && (
              <span className="text-muted-foreground">
                {precheckResult.serverSideCopy
                  ? t("setting.storage.migration.copy-mode-server")
                  : t("setting.storage.migration.copy-mode-transfer")}
              </span>
            )}
          </div>
        </div>
      )}
      {!precheckResult && editable && <p className="text-xs text-muted-foreground">{t("setting.storage.migration.precheck-never")}</p>}

      {progress && migration.state !== State.STATE_UNSPECIFIED && (
        <p className="text-xs text-muted-foreground">
          {t("setting.storage.migration.progress", {
            done: String(progress.done),
            total: String(progress.total),
            pending: String(progress.pending),
            skipped: String(progress.skipped),
            failed: String(progress.failed),
          })}
        </p>
      )}
      {Number(progress?.skipped ?? 0n) > 0 && (
        <p className="text-xs text-muted-foreground">{t("setting.storage.migration.skipped-note")}</p>
      )}
      {failed > 0 && <p className="text-xs text-destructive">{t("setting.storage.migration.failed-note")}</p>}
      {migration.lastError && (
        <p className="text-xs text-destructive">{t("setting.storage.migration.worker-error", { error: migration.lastError })}</p>
      )}
      {running && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <LoaderIcon className="h-3.5 w-3.5 animate-spin" />
          {t("setting.storage.migration.frozen-note")}
        </p>
      )}
      {migration.state === State.READY && <p className="text-xs text-muted-foreground">{t("setting.storage.migration.frozen-note")}</p>}

      <div className="flex w-full flex-wrap justify-end gap-2">
        {migration.state !== State.STATE_UNSPECIFIED && (
          <Button variant="outline" disabled={busy} onClick={abandonDialog.open}>
            {t("setting.storage.migration.abandon")}
          </Button>
        )}
        {editable && (
          <>
            <Button variant="outline" disabled={busy} onClick={saveTarget}>
              {t("setting.storage.migration.save-target")}
            </Button>
            <Button disabled={busy || draftDirty || !migration.targetS3Config} onClick={precheck}>
              {busy ? t("setting.storage.migration.precheck-running") : t("setting.storage.migration.precheck")}
            </Button>
          </>
        )}
        {migration.state === State.PRECHECKED && (
          <Button disabled={busy || !precheckResult?.passed} onClick={startDialog.open}>
            {t("setting.storage.migration.start")}
          </Button>
        )}
        {/* Retry has to be reachable while the migration is still running, not only at the end:
            a worker that parked itself on an error stays in the copying state, and abandoning
            would be the only way out otherwise. */}
        {(failed > 0 || migration.lastError !== "") && migration.state !== State.STATE_UNSPECIFIED && editable === false && (
          <Button variant="outline" disabled={busy} onClick={retry}>
            {t("setting.storage.migration.retry")}
          </Button>
        )}
        {migration.state === State.READY && (
          <Button disabled={busy || failed > 0} onClick={switchDialog.open}>
            {t("setting.storage.migration.switch")}
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={startDialog.isOpen}
        onOpenChange={startDialog.setOpen}
        title={t("setting.storage.migration.start-warning-title")}
        description={t("setting.storage.migration.start-warning-description")}
        confirmLabel={t("common.confirm")}
        cancelLabel={t("common.cancel")}
        onConfirm={start}
      />
      <ConfirmDialog
        open={switchDialog.isOpen}
        onOpenChange={switchDialog.setOpen}
        title={t("setting.storage.migration.switch-warning-title")}
        description={t("setting.storage.migration.switch-warning-description")}
        confirmLabel={t("common.confirm")}
        cancelLabel={t("common.cancel")}
        onConfirm={switchOver}
      />
      <ConfirmDialog
        open={abandonDialog.isOpen}
        onOpenChange={abandonDialog.setOpen}
        title={t("setting.storage.migration.abandon-warning-title")}
        description={t("setting.storage.migration.abandon-warning-description")}
        confirmLabel={t("common.confirm")}
        cancelLabel={t("common.cancel")}
        onConfirm={abandon}
        confirmVariant="destructive"
      />
    </SettingGroup>
  );
};

export default StorageMigrationSection as React.FC;
