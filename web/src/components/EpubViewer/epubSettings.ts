// Reader appearance settings for the EPUB viewer. These are a reader-wide preference
// (not per-book), persisted to localStorage so they carry across books and sessions.

// "scrolled-doc" is a continuous vertical scroll (竖屏/连续阅读); "paginated" is
// left/right page flipping. Defined here (not in useEpubRendition) so EpubSettings can
// reference it without a circular import.
export type EpubFlow = "paginated" | "scrolled-doc";

export interface EpubSettings {
  /** Reading layout: continuous vertical scroll vs. horizontal page flipping. */
  flow: EpubFlow;
  /** Background preset key (see BACKGROUND_PRESETS). "theme" follows the app's own theme. */
  background: string;
  /** Font-family preset key (see FONT_PRESETS). "default" keeps the book's own fonts. */
  fontFamily: string;
  /** Letter spacing in em. */
  letterSpacing: number;
  /** Line height as a unitless multiplier (inherits to paragraphs). */
  lineHeight: number;
}

export interface BackgroundPreset {
  key: string;
  labelKey: string;
  /** Swatch/background color, or null for "theme" (resolved from app CSS vars at render time). */
  bg: string | null;
  fg: string | null;
}

// Fixed reading backgrounds. "theme" defers to the app theme; the rest are classic
// e-reader paper tones with a matching text color for contrast.
export const BACKGROUND_PRESETS: BackgroundPreset[] = [
  { key: "theme", labelKey: "epub.bg-theme", bg: null, fg: null },
  { key: "paper", labelKey: "epub.bg-paper", bg: "#ffffff", fg: "#1a1a1a" },
  { key: "sepia", labelKey: "epub.bg-sepia", bg: "#f5ecd9", fg: "#5b4636" },
  { key: "green", labelKey: "epub.bg-green", bg: "#e3ede3", fg: "#2f3a2f" },
  { key: "night", labelKey: "epub.bg-night", bg: "#1c1c1e", fg: "#c9c9cd" },
];

export interface FontPreset {
  key: string;
  /** i18n key for generic labels (Default, System, 宋体…). Mutually exclusive with `label`. */
  labelKey?: string;
  /** Literal display name for concrete named fonts (Arial, Georgia…), shown as-is. */
  label?: string;
  /** CSS font-family value, or null to keep the book's own fonts. */
  family: string | null;
}

// Font families offered in the reader. The browser sandbox can't enumerate the OS's
// installed fonts (queryLocalFonts() is permission-gated and Chromium-only), so these are
// well-known system font stacks: each name resolves to that font if the OS has it and
// falls back gracefully otherwise. `labelKey` is the i18n key for generic labels; `label`
// is a literal name used as-is for concrete named fonts (Arial, Georgia…).
export const FONT_PRESETS: FontPreset[] = [
  { key: "default", labelKey: "epub.font-default", family: null },
  {
    key: "system",
    labelKey: "epub.font-system",
    // San Francisco on macOS/iOS, Segoe UI on Windows, Roboto on Android.
    family: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", Roboto, system-ui, sans-serif',
  },
  { key: "arial", label: "Arial", family: "Arial, Helvetica, sans-serif" },
  { key: "helvetica", label: "Helvetica", family: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
  { key: "verdana", label: "Verdana", family: "Verdana, Geneva, sans-serif" },
  { key: "georgia", label: "Georgia", family: 'Georgia, "Times New Roman", serif' },
  { key: "times", label: "Times", family: '"Times New Roman", Times, serif' },
  { key: "serif-cn", labelKey: "epub.font-serif-cn", family: '"Songti SC", "SimSun", "Noto Serif SC", serif' },
  { key: "sans-cn", labelKey: "epub.font-sans-cn", family: '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif' },
  { key: "kai", labelKey: "epub.font-kai", family: '"Kaiti SC", "KaiTi", "STKaiti", serif' },
];

export const MIN_LETTER_SPACING = 0;
export const MAX_LETTER_SPACING = 0.3;
export const LETTER_SPACING_STEP = 0.02;

export const MIN_LINE_HEIGHT = 1.2;
export const MAX_LINE_HEIGHT = 2.4;
export const LINE_HEIGHT_STEP = 0.1;

export const DEFAULT_SETTINGS: EpubSettings = {
  flow: "scrolled-doc",
  background: "theme",
  fontFamily: "default",
  letterSpacing: 0,
  lineHeight: 1.5,
};

const STORAGE_KEY = "epub-reader-settings";

export function loadEpubSettings(): EpubSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<EpubSettings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveEpubSettings(settings: EpubSettings) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage disabled/full — settings just won't persist.
  }
}

export const getBackgroundPreset = (key: string) => BACKGROUND_PRESETS.find((p) => p.key === key) ?? BACKGROUND_PRESETS[0];
export const getFontPreset = (key: string) => FONT_PRESETS.find((p) => p.key === key) ?? FONT_PRESETS[0];
