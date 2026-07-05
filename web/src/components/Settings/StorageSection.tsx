import { create } from "@bufbuild/protobuf";
import { isEqual } from "lodash-es";
import React, { useEffect, useMemo, useState } from "react";
import { toast } from "react-hot-toast";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { instanceServiceClient } from "@/connect";
import { useInstance } from "@/contexts/InstanceContext";
import { useDialog } from "@/hooks/useDialog";
import { handleError } from "@/lib/error";
import {
  InstanceSetting_BackupSettingSchema,
  InstanceSetting_Key,
  InstanceSetting_StorageSetting,
  InstanceSetting_StorageSetting_S3ConfigSchema,
  InstanceSetting_StorageSetting_StorageType,
  InstanceSetting_StorageSettingSchema,
  InstanceSettingSchema,
} from "@/types/proto/api/v1/instance_service_pb";
import { useTranslate } from "@/utils/i18n";
import SettingGroup from "./SettingGroup";
import SettingRow from "./SettingRow";
import SettingSection from "./SettingSection";
import useInstanceSettingUpdater, { buildInstanceSettingName } from "./useInstanceSettingUpdater";

const DEFAULT_FILEPATH_TEMPLATE = "assets/{timestamp}_{uuid}_{filename}";

const activeStorageOptions = [
  { storageType: InstanceSetting_StorageSetting_StorageType.LOCAL, labelKey: "setting.storage.type-local" as const },
  { storageType: InstanceSetting_StorageSetting_StorageType.DATABASE, labelKey: "setting.storage.type-database" as const },
  { storageType: InstanceSetting_StorageSetting_StorageType.S3, labelKey: "setting.storage.type-s3" as const },
];

const StorageSection = () => {
  const t = useTranslate();
  const saveInstanceSetting = useInstanceSettingUpdater();
  const { storageSetting: originalSetting, backupSetting } = useInstance();

  // Storage Configuration: only the S3 credentials/config, persisted independently of which
  // storage backend is currently active. storageType here is never touched by this section.
  const [s3Draft, setS3Draft] = useState<InstanceSetting_StorageSetting>(originalSetting);
  useEffect(() => {
    setS3Draft(originalSetting);
  }, [originalSetting]);

  const hasExistingS3Config = originalSetting.s3Config !== undefined;

  const allowSaveS3Config = useMemo(() => {
    if (
      !s3Draft.filepathTemplate ||
      !s3Draft.s3Config?.accessKeyId ||
      (!hasExistingS3Config && !s3Draft.s3Config?.accessKeySecret) ||
      !s3Draft.s3Config?.endpoint ||
      !s3Draft.s3Config?.region ||
      !s3Draft.s3Config?.bucket
    ) {
      return false;
    }
    return !isEqual(originalSetting.s3Config, s3Draft.s3Config) || originalSetting.filepathTemplate !== s3Draft.filepathTemplate;
  }, [s3Draft, originalSetting, hasExistingS3Config]);

  const handleFilepathTemplateChanged = (event: React.ChangeEvent<HTMLInputElement>) => {
    setS3Draft(
      create(InstanceSetting_StorageSettingSchema, {
        ...s3Draft,
        filepathTemplate: event.target.value,
      }),
    );
  };

  // Trim these fields on save: whitespace/newlines picked up from copy-pasting credentials out
  // of a cloud console are otherwise stored verbatim and signed as part of the S3 request,
  // producing SignatureDoesNotMatch against the provider.
  const trimmedS3Fields = new Set(["accessKeyId", "accessKeySecret", "endpoint", "region", "bucket"]);

  const handleS3FieldChange = (field: string, value: string | boolean) => {
    const existing = s3Draft.s3Config;
    const normalizedValue = typeof value === "string" && trimmedS3Fields.has(field) ? value.trim() : value;
    setS3Draft(
      create(InstanceSetting_StorageSettingSchema, {
        ...s3Draft,
        s3Config: create(InstanceSetting_StorageSetting_S3ConfigSchema, {
          accessKeyId: existing?.accessKeyId ?? "",
          accessKeySecret: existing?.accessKeySecret ?? "",
          endpoint: existing?.endpoint ?? "",
          region: existing?.region ?? "",
          bucket: existing?.bucket ?? "",
          usePathStyle: existing?.usePathStyle ?? false,
          insecureSkipTlsVerify: existing?.insecureSkipTlsVerify ?? false,
          [field]: normalizedValue,
        }),
      }),
    );
  };

  const saveS3Config = async () => {
    await saveInstanceSetting({
      key: InstanceSetting_Key.STORAGE,
      setting: create(InstanceSettingSchema, {
        name: buildInstanceSettingName(InstanceSetting_Key.STORAGE),
        value: {
          case: "storageSetting",
          value: create(InstanceSetting_StorageSettingSchema, {
            ...originalSetting,
            filepathTemplate: s3Draft.filepathTemplate || DEFAULT_FILEPATH_TEMPLATE,
            s3Config: s3Draft.s3Config,
          }),
        },
      }),
      errorContext: "Update S3 storage configuration",
    });
  };

  const isS3Active = originalSetting.storageType === InstanceSetting_StorageSetting_StorageType.S3;
  const deleteS3ConfigDialog = useDialog();

  const deleteS3Config = async () => {
    await saveInstanceSetting({
      key: InstanceSetting_Key.STORAGE,
      setting: create(InstanceSettingSchema, {
        name: buildInstanceSettingName(InstanceSetting_Key.STORAGE),
        value: {
          case: "storageSetting",
          value: create(InstanceSetting_StorageSettingSchema, {
            ...originalSetting,
            s3Config: undefined,
          }),
        },
      }),
      errorContext: "Delete S3 storage configuration",
    });
  };

  // Attachment storage: only decides which already-configured backend is active.
  const switchActiveTypeDialog = useDialog();
  const [pendingStorageType, setPendingStorageType] = useState<InstanceSetting_StorageSetting_StorageType | undefined>(undefined);

  const requestStorageTypeChange = (storageType: InstanceSetting_StorageSetting_StorageType) => {
    if (storageType === originalSetting.storageType) {
      return;
    }
    setPendingStorageType(storageType);
    switchActiveTypeDialog.open();
  };

  const confirmStorageTypeChange = async () => {
    if (pendingStorageType === undefined) {
      return;
    }
    await saveInstanceSetting({
      key: InstanceSetting_Key.STORAGE,
      setting: create(InstanceSettingSchema, {
        name: buildInstanceSettingName(InstanceSetting_Key.STORAGE),
        value: {
          case: "storageSetting",
          value: create(InstanceSetting_StorageSettingSchema, {
            ...originalSetting,
            storageType: pendingStorageType,
            filepathTemplate: originalSetting.filepathTemplate || DEFAULT_FILEPATH_TEMPLATE,
          }),
        },
      }),
      errorContext: "Update active attachment storage",
    });
    setPendingStorageType(undefined);
  };

  // Database Backup: manual trigger for the weekly SQLite -> S3 backup job. Backend rejects this
  // outright for non-sqlite instances or when S3 isn't configured, surfaced via the toast below.
  const [backupRunning, setBackupRunning] = useState(false);
  const [lastBackup, setLastBackup] = useState(backupSetting);
  useEffect(() => {
    setLastBackup(backupSetting);
  }, [backupSetting]);

  const [pathTemplateDraft, setPathTemplateDraft] = useState(backupSetting.pathTemplate);
  useEffect(() => {
    setPathTemplateDraft(backupSetting.pathTemplate);
  }, [backupSetting.pathTemplate]);

  const savePathTemplate = async () => {
    await saveInstanceSetting({
      key: InstanceSetting_Key.BACKUP,
      setting: create(InstanceSettingSchema, {
        name: buildInstanceSettingName(InstanceSetting_Key.BACKUP),
        value: {
          case: "backupSetting",
          value: create(InstanceSetting_BackupSettingSchema, { ...backupSetting, pathTemplate: pathTemplateDraft }),
        },
      }),
      errorContext: "Update backup path template",
    });
  };

  const runBackupNow = async () => {
    setBackupRunning(true);
    try {
      await instanceServiceClient.backupNow({});
      const updated = await instanceServiceClient.getInstanceSetting({ name: buildInstanceSettingName(InstanceSetting_Key.BACKUP) });
      if (updated.value.case === "backupSetting") {
        setLastBackup(updated.value.value);
      }
      toast.success(t("setting.storage.backup-success"));
    } catch (error) {
      handleError(error, toast.error, { context: "Backup now" });
    } finally {
      setBackupRunning(false);
    }
  };

  return (
    <SettingSection title={t("setting.storage.label")}>
      <SettingGroup
        title={t("setting.storage.s3-configuration")}
        description={t("setting.storage.s3-configuration-description")}
      >
        <SettingRow label={t("setting.storage.accesskey")} description={t("setting.storage.accesskey-description")}>
          <Input className="w-64" value={s3Draft.s3Config?.accessKeyId ?? ""} onChange={(e) => handleS3FieldChange("accessKeyId", e.target.value)} />
        </SettingRow>

        <SettingRow
          label={t("setting.storage.secretkey")}
          description={hasExistingS3Config ? t("setting.storage.secretkey-preserve-description") : t("setting.storage.secretkey-description")}
        >
          <Input
            className="w-64"
            type="password"
            value={s3Draft.s3Config?.accessKeySecret ?? ""}
            onChange={(e) => handleS3FieldChange("accessKeySecret", e.target.value)}
          />
        </SettingRow>

        <SettingRow label={t("setting.storage.endpoint")} description={t("setting.storage.endpoint-description")}>
          <Input className="w-64" value={s3Draft.s3Config?.endpoint ?? ""} onChange={(e) => handleS3FieldChange("endpoint", e.target.value)} />
        </SettingRow>

        <SettingRow label={t("setting.storage.region")} description={t("setting.storage.region-description")}>
          <Input className="w-64" value={s3Draft.s3Config?.region ?? ""} onChange={(e) => handleS3FieldChange("region", e.target.value)} />
        </SettingRow>

        <SettingRow label={t("setting.storage.bucket")} description={t("setting.storage.bucket-description")}>
          <Input className="w-64" value={s3Draft.s3Config?.bucket ?? ""} onChange={(e) => handleS3FieldChange("bucket", e.target.value)} />
        </SettingRow>

        <SettingRow label={t("setting.storage.use-path-style")} description={t("setting.storage.use-path-style-description")}>
          <Switch checked={s3Draft.s3Config?.usePathStyle ?? false} onCheckedChange={(checked) => handleS3FieldChange("usePathStyle", checked)} />
        </SettingRow>

        <SettingRow label={t("setting.storage.insecure-skip-tls-verify")} description={t("setting.storage.insecure-skip-tls-verify-description")}>
          <Switch
            checked={s3Draft.s3Config?.insecureSkipTlsVerify ?? false}
            onCheckedChange={(checked) => handleS3FieldChange("insecureSkipTlsVerify", checked)}
          />
        </SettingRow>

        <SettingRow label={t("setting.storage.filepath-template")} description={t("setting.storage.filepath-template-description")} vertical>
          <Input
            className="w-full max-w-lg font-mono"
            value={s3Draft.filepathTemplate}
            placeholder={DEFAULT_FILEPATH_TEMPLATE}
            onChange={handleFilepathTemplateChanged}
          />
        </SettingRow>

        <div className="w-full flex justify-end gap-2">
          {hasExistingS3Config && (
            <Button variant="destructive" disabled={isS3Active} onClick={deleteS3ConfigDialog.open}>
              {t("common.delete")}
            </Button>
          )}
          <Button disabled={!allowSaveS3Config} onClick={saveS3Config}>
            {t("common.save")}
          </Button>
        </div>
        {hasExistingS3Config && isS3Active && <p className="text-xs text-muted-foreground">{t("setting.storage.delete-blocked-active")}</p>}
      </SettingGroup>

      <SettingGroup title={t("setting.storage.current-storage")} description={t("setting.storage.current-storage-description")} showSeparator>
        <SettingRow label={t("setting.storage.active-backend")}>
          <Select value={String(originalSetting.storageType)} onValueChange={(v) => requestStorageTypeChange(Number(v))}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {activeStorageOptions.map((option) => (
                <SelectItem
                  key={option.storageType}
                  value={String(option.storageType)}
                  disabled={option.storageType === InstanceSetting_StorageSetting_StorageType.S3 && !hasExistingS3Config}
                >
                  {t(option.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t("setting.storage.backup-title")} description={t("setting.storage.backup-description")} showSeparator>
        <SettingRow label={t("setting.storage.backup-path-template")} description={t("setting.storage.backup-path-template-description")} vertical>
          <div className="flex w-full max-w-lg items-center gap-2">
            <Input
              className="font-mono"
              value={pathTemplateDraft}
              placeholder={backupSetting.pathTemplate}
              onChange={(e) => setPathTemplateDraft(e.target.value)}
            />
            <Button variant="outline" disabled={!pathTemplateDraft || pathTemplateDraft === backupSetting.pathTemplate} onClick={savePathTemplate}>
              {t("common.save")}
            </Button>
          </div>
        </SettingRow>

        <SettingRow label={t("setting.storage.backup-last-run")}>
          <div className="text-sm text-muted-foreground">
            {lastBackup.lastBackupTime
              ? t("setting.storage.backup-last-run-value", {
                  time: new Date(Number(lastBackup.lastBackupTime.seconds) * 1000).toLocaleString(),
                  status: lastBackup.lastBackupSuccess ? t("setting.storage.backup-status-success") : t("setting.storage.backup-status-failed"),
                })
              : t("setting.storage.backup-never-run")}
          </div>
        </SettingRow>
        {lastBackup.lastBackupTime && !lastBackup.lastBackupSuccess && (
          <p className="text-xs text-destructive">{lastBackup.lastBackupError}</p>
        )}
        <div className="w-full flex justify-end">
          <Button disabled={backupRunning} onClick={runBackupNow}>
            {t("setting.storage.backup-now")}
          </Button>
        </div>
      </SettingGroup>

      <ConfirmDialog
        open={switchActiveTypeDialog.isOpen}
        onOpenChange={(open) => {
          if (!open) {
            setPendingStorageType(undefined);
          }
          switchActiveTypeDialog.setOpen(open);
        }}
        title={t("setting.storage.switch-warning-title")}
        description={t("setting.storage.switch-warning-description")}
        confirmLabel={t("common.confirm")}
        cancelLabel={t("common.cancel")}
        onConfirm={confirmStorageTypeChange}
      />

      <ConfirmDialog
        open={deleteS3ConfigDialog.isOpen}
        onOpenChange={deleteS3ConfigDialog.setOpen}
        title={t("setting.storage.delete-config-warning-title")}
        description={t("setting.storage.delete-config-warning-description")}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        onConfirm={deleteS3Config}
        confirmVariant="destructive"
      />
    </SettingSection>
  );
};

export default StorageSection;
