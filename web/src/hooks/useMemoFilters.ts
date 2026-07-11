import { useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useMemoFilterContext } from "@/contexts/MemoFilterContext";
import { buildMemoCreatorFilter } from "@/helpers/resource-names";
import { Visibility } from "@/types/proto/api/v1/memo_service_pb";

const getVisibilityName = (visibility: Visibility): string => {
  switch (visibility) {
    case Visibility.PUBLIC:
      return "PUBLIC";
    case Visibility.PROTECTED:
      return "PROTECTED";
    case Visibility.PRIVATE:
      return "PRIVATE";
    default:
      return "PRIVATE";
  }
};

const getShortcutId = (name: string): string => {
  const parts = name.split("/");
  return parts.length === 4 ? parts[3] : "";
};

const escapeFilterValue = (value: string): string => JSON.stringify(value);

// Doc types that are structural/organizational rather than browsable content,
// and therefore excluded from content feeds (e.g. Explore). This is THE single
// place deciding which doc types are feed-worthy — do not duplicate this
// judgment elsewhere.
export const FEED_EXCLUDED_DOC_TYPES = ["VIEW"];

export interface UseMemoFiltersOptions {
  creatorName?: string;
  includeShortcuts?: boolean;
  includePinned?: boolean;
  visibilities?: Visibility[];
  /** Exclude non-content doc types (FEED_EXCLUDED_DOC_TYPES) from the result. Set by feed pages like Explore. */
  excludeNonFeedDocTypes?: boolean;
}

export const useMemoFilters = (options: UseMemoFiltersOptions = {}): string | undefined => {
  const { creatorName, includeShortcuts = false, includePinned = false, visibilities, excludeNonFeedDocTypes = false } = options;

  const { shortcuts } = useAuth();
  const { filters, shortcut: currentShortcut } = useMemoFilterContext();

  // Get selected shortcut if needed
  const selectedShortcut = useMemo(() => {
    if (!includeShortcuts) return undefined;
    return shortcuts.find((shortcut) => getShortcutId(shortcut.name) === currentShortcut);
  }, [includeShortcuts, currentShortcut, shortcuts]);

  // Build filter
  return useMemo(() => {
    const conditions: string[] = [];

    // Add creator filter if provided
    if (creatorName) {
      const creatorFilter = buildMemoCreatorFilter(creatorName);
      if (creatorFilter) {
        conditions.push(creatorFilter);
      }
    }

    // Add shortcut filter if enabled and selected
    if (includeShortcuts && selectedShortcut?.filter) {
      conditions.push(selectedShortcut.filter);
    }

    // Add active filters from context
    const selectedVisibilityNames: string[] = [];
    for (const filter of filters) {
      if (filter.factor === "contentSearch") {
        conditions.push(`content.contains(${escapeFilterValue(filter.value)})`);
      } else if (filter.factor === "tagSearch") {
        conditions.push(`tag in [${escapeFilterValue(filter.value)}]`);
      } else if (filter.factor === "pinned") {
        if (includePinned) {
          conditions.push(`pinned`);
        }
      } else if (filter.factor === "property.hasLink") {
        conditions.push(`has_link`);
      } else if (filter.factor === "property.hasTaskList") {
        conditions.push(`has_task_list`);
      } else if (filter.factor === "property.hasCode") {
        conditions.push(`has_code`);
      } else if (filter.factor === "displayTime") {
        const [year, month, day] = filter.value.split("-").map(Number);
        const startTimestamp = Math.floor(new Date(year, month - 1, day).getTime() / 1000);
        const endTimestamp = startTimestamp + 60 * 60 * 24;

        conditions.push(`created_ts >= timestamp(${startTimestamp}) && created_ts < timestamp(${endTimestamp})`);
      } else if (filter.factor === "workspace") {
        conditions.push(`workspace == ${escapeFilterValue(filter.value)}`);
      } else if (filter.factor === "visibility") {
        selectedVisibilityNames.push(filter.value);
      }
      // "archived" is not a CEL condition; callers read it via getFiltersByFactor
      // and map it to ListMemosRequest.state instead.
    }

    // Add visibility filter: an explicit user selection (e.g. Explore's
    // multi-select) takes precedence over the caller-provided default.
    if (selectedVisibilityNames.length > 0) {
      const visibilityValues = selectedVisibilityNames.map((name) => `"${name}"`).join(", ");
      conditions.push(`visibility in [${visibilityValues}]`);
    } else if (visibilities && visibilities.length > 0) {
      const visibilityValues = visibilities.map((v) => `"${getVisibilityName(v)}"`).join(", ");
      conditions.push(`visibility in [${visibilityValues}]`);
    }

    if (excludeNonFeedDocTypes) {
      for (const docType of FEED_EXCLUDED_DOC_TYPES) {
        conditions.push(`doc_type != ${escapeFilterValue(docType)}`);
      }
    }

    return conditions.length > 0 ? conditions.join(" && ") : undefined;
  }, [creatorName, includeShortcuts, includePinned, visibilities, selectedShortcut, filters, excludeNonFeedDocTypes]);
};
