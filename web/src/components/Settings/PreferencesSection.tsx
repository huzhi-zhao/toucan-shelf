import { create } from "@bufbuild/protobuf";
import { useQuery } from "@tanstack/react-query";
import { RotateCcwIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ragServiceClient } from "@/connect";
import { useAuth } from "@/contexts/AuthContext";
import useSidebarMode from "@/hooks/useSidebarMode";
import { useUpdateUserGeneralSetting, useUpdateUserSetting, useUserSettings } from "@/hooks/useUserQueries";
import { handleError } from "@/lib/error";
import { Visibility } from "@/types/proto/api/v1/memo_service_pb";
import { UserSetting_GeneralSetting, UserSetting_GeneralSettingSchema, UserSettingSchema } from "@/types/proto/api/v1/user_service_pb";
import { loadLocale, useTranslate } from "@/utils/i18n";
import { convertVisibilityFromString, convertVisibilityToString } from "@/utils/memo";
import {
  LINE_SPACING_RANGE,
  PARAGRAPH_SPACING_RANGE,
  setCompactReading,
  setLineSpacing,
  setParagraphSpacing,
  useReadingDensity,
} from "@/utils/readingDensity";
import { setSidebarMode } from "@/utils/sidebarMode";
import { loadTheme } from "@/utils/theme";
import LocaleSelect from "../LocaleSelect";
import ThemeSelect from "../ThemeSelect";
import VisibilityIcon from "../VisibilityIcon";
import SecretKeySection from "./SecretKeySection";
import SettingGroup from "./SettingGroup";
import { SettingList, SettingListItem } from "./SettingList";
import SettingSection from "./SettingSection";

/**
 * Shared slider for the two reading-rhythm overrides. While no override is set the handle
 * still sits on the active preset's value, so the control never lies about the current text —
 * it just reports it as "auto" until the reader drags it. The reset button clears the
 * override, returning to whatever the preset suggests rather than to a hard-coded number.
 */
const SpacingSlider = ({
  label,
  value,
  effectiveValue,
  range,
  format,
  onChange,
}: {
  label: string;
  value: number | null;
  effectiveValue: number;
  range: { min: number; max: number; step: number };
  format: (value: number) => string;
  onChange: (value: number | null) => void;
}) => {
  const t = useTranslate();
  const isAuto = value === null;

  return (
    <div className="flex w-48 flex-col gap-1 sm:w-56">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs tabular-nums text-muted-foreground">
          {format(effectiveValue)}
          {isAuto && ` · ${t("setting.preference.spacing-auto")}`}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          disabled={isAuto}
          title={t("setting.preference.spacing-reset")}
          onClick={() => onChange(null)}
        >
          <RotateCcwIcon className="w-3 h-3" />
          {t("setting.preference.spacing-reset")}
        </Button>
      </div>
      <input
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={effectiveValue}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary"
      />
    </div>
  );
};

const PreferencesSection = () => {
  const t = useTranslate();
  const { currentUser, userGeneralSetting: generalSetting, refetchSettings } = useAuth();
  const { mutate: updateUserGeneralSetting } = useUpdateUserGeneralSetting(currentUser?.name);
  const sidebarMode = useSidebarMode();
  const { compact: compactReading, lineSpacing, paragraphSpacing, effectiveLineSpacing, effectiveParagraphSpacing } = useReadingDensity();

  // RAG search preferences (per-user).
  const { data: userSettings } = useUserSettings(currentUser?.name);
  const { mutate: updateUserSetting } = useUpdateUserSetting();
  const ragSearchSetting = userSettings?.settings.find((s) => s.name.endsWith("/settings/RAG_SEARCH"))?.value;
  const ragMaxResultDocs = ragSearchSetting?.case === "ragSearchSetting" ? ragSearchSetting.value.maxResultDocs || 20 : 20;
  const ragMode = ragSearchSetting?.case === "ragSearchSetting" ? ragSearchSetting.value.mode || "MIXED" : "MIXED";

  // Search index status + user-level rebuild (re-indexes the current user's own docs,
  // e.g. to recover documents whose indexing failed due to a transient embedding error).
  const { data: indexStatus, refetch: refetchIndexStatus } = useQuery({
    queryKey: ["rag-index-status"],
    queryFn: () => ragServiceClient.getIndexStatus({}),
  });
  const [rebuilding, setRebuilding] = useState(false);

  const handleRebuildIndex = async () => {
    setRebuilding(true);
    try {
      const response = await ragServiceClient.rebuildIndex({});
      toast.success(t("setting.preference.search-rebuild-done", { count: response.enqueued }));
      refetchIndexStatus();
    } catch (error) {
      handleError(error, toast.error, { context: t("setting.preference.search-rebuild") });
    } finally {
      setRebuilding(false);
    }
  };

  const updateRagSearch = (patch: { maxResultDocs?: number; mode?: string }, updateMask: string[]) => {
    if (!currentUser?.name) return;
    updateUserSetting({
      setting: create(UserSettingSchema, {
        name: `${currentUser.name}/settings/RAG_SEARCH`,
        value: {
          case: "ragSearchSetting",
          value: {
            maxResultDocs: patch.maxResultDocs ?? ragMaxResultDocs,
            mode: patch.mode ?? ragMode,
          },
        },
      }),
      updateMask,
    });
  };

  const handleLocaleSelectChange = (locale: Locale) => {
    // Apply locale immediately for instant UI feedback and persist to localStorage
    loadLocale(locale);
    // Persist to user settings
    updateUserGeneralSetting(
      { generalSetting: { locale }, updateMask: ["locale"] },
      {
        onSuccess: () => {
          refetchSettings();
        },
      },
    );
  };

  const handleDefaultMemoVisibilityChanged = (value: string) => {
    updateUserGeneralSetting(
      { generalSetting: { memoVisibility: value }, updateMask: ["memo_visibility"] },
      {
        onSuccess: () => {
          refetchSettings();
        },
      },
    );
  };

  const handleSoftBreakDefaultChange = (softBreakDefault: boolean) => {
    updateUserGeneralSetting(
      { generalSetting: { softBreakDefault }, updateMask: ["soft_break_default"] },
      {
        onSuccess: () => {
          refetchSettings();
        },
      },
    );
  };

  const handleThemeChange = (theme: string) => {
    // Apply theme immediately for instant UI feedback
    loadTheme(theme);
    // Persist to user settings
    updateUserGeneralSetting(
      { generalSetting: { theme }, updateMask: ["theme"] },
      {
        onSuccess: () => {
          refetchSettings();
        },
      },
    );
  };

  // Provide default values if setting is not loaded yet
  const setting: UserSetting_GeneralSetting =
    generalSetting ||
    create(UserSetting_GeneralSettingSchema, {
      locale: "en",
      memoVisibility: "PRIVATE",
      theme: "system",
    });

  return (
    <SettingSection title={t("setting.preference.label")}>
      <SettingGroup title={t("setting.preference.appearance-title")} description={t("setting.preference.appearance-description")}>
        <SettingList>
          <SettingListItem label={t("common.language")} description={t("setting.preference.language-description")}>
            <LocaleSelect value={setting.locale} onChange={handleLocaleSelectChange} />
          </SettingListItem>

          <SettingListItem label={t("setting.preference.theme")} description={t("setting.preference.theme-description")}>
            <ThemeSelect value={setting.theme} onValueChange={handleThemeChange} />
          </SettingListItem>

          <SettingListItem label={t("setting.preference.mini-menu")} description={t("setting.preference.mini-menu-description")}>
            <Switch checked={sidebarMode === "mini"} onCheckedChange={(checked) => setSidebarMode(checked ? "mini" : "default")} />
          </SettingListItem>

          {/* A reader preference, so it applies to every document — unlike the per-document
              settings (width, outline, tree, properties) in a document's own ⋮ menu. Kept on
              this device rather than synced: the right density depends on the screen. */}
          <SettingListItem
            label={t("setting.preference.compact-reading")}
            description={t("setting.preference.compact-reading-description")}
          >
            <Switch checked={compactReading} onCheckedChange={setCompactReading} />
          </SettingListItem>

          {/* Fine-tuning on top of the density preset above. "Auto" keeps whatever the preset
              says, so a reader only opts into a fixed value if they actually want one. */}
          <SettingListItem label={t("setting.preference.line-spacing")} description={t("setting.preference.line-spacing-description")}>
            <SpacingSlider
              label={t("setting.preference.line-spacing")}
              value={lineSpacing}
              effectiveValue={effectiveLineSpacing}
              range={LINE_SPACING_RANGE}
              format={(v) => v.toFixed(2)}
              onChange={setLineSpacing}
            />
          </SettingListItem>

          <SettingListItem
            label={t("setting.preference.paragraph-spacing")}
            description={t("setting.preference.paragraph-spacing-description")}
          >
            <SpacingSlider
              label={t("setting.preference.paragraph-spacing")}
              value={paragraphSpacing}
              effectiveValue={effectiveParagraphSpacing}
              range={PARAGRAPH_SPACING_RANGE}
              format={(v) => `${Math.round(v * 16)}px`}
              onChange={setParagraphSpacing}
            />
          </SettingListItem>
        </SettingList>
      </SettingGroup>

      <SettingGroup
        title={t("setting.preference.memo-defaults-title")}
        description={t("setting.preference.memo-defaults-description")}
        showSeparator
      >
        <SettingList>
          <SettingListItem
            label={t("setting.preference.default-memo-visibility")}
            description={t("setting.preference.default-memo-visibility-description")}
          >
            <Select value={setting.memoVisibility || "PRIVATE"} onValueChange={handleDefaultMemoVisibilityChanged}>
              <SelectTrigger className="min-w-fit">
                <div className="flex items-center gap-2">
                  <VisibilityIcon visibility={convertVisibilityFromString(setting.memoVisibility)} />
                  <SelectValue />
                </div>
              </SelectTrigger>
              <SelectContent>
                {[Visibility.PRIVATE, Visibility.PROTECTED, Visibility.PUBLIC]
                  .map((v) => convertVisibilityToString(v))
                  .map((item) => (
                    <SelectItem key={item} value={item} className="whitespace-nowrap">
                      {t(`memo.visibility.${item.toLowerCase() as Lowercase<typeof item>}`)}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </SettingListItem>

          {/* Not a reader preference: it decides what the markdown *means*, so it is synced and
              applies to every reader of the document. A document that sets `softBreak` for itself
              (imported files and agent-written ones do, from the moment they are created) ignores
              this — see the same switch in a document's ⋮ menu. */}
          <SettingListItem
            label={t("setting.preference.soft-line-breaks")}
            description={t("setting.preference.soft-line-breaks-description")}
          >
            <Switch checked={setting.softBreakDefault} onCheckedChange={handleSoftBreakDefaultChange} />
          </SettingListItem>
        </SettingList>
      </SettingGroup>

      <SecretKeySection />

      <SettingGroup title={t("setting.preference.search-title")} description={t("setting.preference.search-description")} showSeparator>
        <SettingList>
          <SettingListItem label={t("setting.preference.search-mode")} description={t("setting.preference.search-mode-description")}>
            <Select value={ragMode} onValueChange={(value) => updateRagSearch({ mode: value }, ["mode"])}>
              <SelectTrigger className="min-w-fit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MIXED">{t("setting.preference.search-mode-mixed")}</SelectItem>
                <SelectItem value="KEYWORD">{t("setting.preference.search-mode-keyword")}</SelectItem>
                <SelectItem value="SEMANTIC">{t("setting.preference.search-mode-semantic")}</SelectItem>
                <SelectItem value="LIKE">{t("setting.preference.search-mode-like")}</SelectItem>
              </SelectContent>
            </Select>
          </SettingListItem>

          <SettingListItem
            label={t("setting.preference.search-max-docs")}
            description={t("setting.preference.search-max-docs-description")}
          >
            <Input
              type="number"
              min={1}
              max={100}
              className="w-24"
              defaultValue={ragMaxResultDocs}
              onBlur={(e) => {
                const value = Math.max(1, Math.min(100, Number(e.target.value) || 20));
                if (value !== ragMaxResultDocs) updateRagSearch({ maxResultDocs: value }, ["max_result_docs"]);
              }}
            />
          </SettingListItem>

          <SettingListItem
            label={t("setting.preference.search-rebuild")}
            description={
              indexStatus
                ? t("setting.preference.search-index-status", {
                    done: indexStatus.done,
                    pending: indexStatus.pending + indexStatus.processing,
                    failed: indexStatus.failed,
                  })
                : t("setting.preference.search-rebuild-description")
            }
          >
            <Button variant="outline" disabled={rebuilding} onClick={handleRebuildIndex}>
              {rebuilding ? t("setting.preference.search-rebuilding") : t("setting.preference.search-rebuild")}
            </Button>
          </SettingListItem>
        </SettingList>
      </SettingGroup>
    </SettingSection>
  );
};

export default PreferencesSection;
