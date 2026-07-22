import { SettingsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";
import {
  BACKGROUND_PRESETS,
  type EpubSettings,
  FONT_PRESETS,
  LETTER_SPACING_STEP,
  LINE_HEIGHT_STEP,
  MAX_LETTER_SPACING,
  MAX_LINE_HEIGHT,
  MIN_LETTER_SPACING,
  MIN_LINE_HEIGHT,
} from "./epubSettings";

interface Props {
  settings: EpubSettings;
  onChange: (patch: Partial<EpubSettings>) => void;
}

// Reading-appearance popover for the EPUB reader: background color, font family, and
// letter spacing. Lives in the toolbar (portaled into the document title bar).
export const EpubSettingsMenu = ({ settings, onChange }: Props) => {
  const t = useTranslate();
  // Preset label keys are dynamic strings; they're all valid translation keys, but the
  // typed `t` only accepts the literal union, so widen at the call boundary.
  const tt = t as (key: string) => string;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" title={t("epub.settings")}>
          <SettingsIcon className="w-4 h-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-4">
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">{t("epub.background")}</div>
          <div className="flex flex-wrap gap-2">
            {BACKGROUND_PRESETS.map((preset) => {
              const active = settings.background === preset.key;
              return (
                <button
                  key={preset.key}
                  type="button"
                  title={tt(preset.labelKey)}
                  aria-label={tt(preset.labelKey)}
                  onClick={() => onChange({ background: preset.key })}
                  className={cn(
                    "h-8 w-8 rounded-full border transition-shadow",
                    active ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : "border-border",
                  )}
                  style={
                    preset.bg
                      ? { background: preset.bg, color: preset.fg ?? undefined }
                      : { background: "linear-gradient(135deg, hsl(var(--background)) 50%, hsl(var(--foreground)) 50%)" }
                  }
                >
                  {preset.bg && <span className="text-sm font-serif">A</span>}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">{t("epub.font")}</div>
          <div className="flex flex-wrap gap-2">
            {FONT_PRESETS.map((preset) => {
              const active = settings.fontFamily === preset.key;
              return (
                <button
                  key={preset.key}
                  type="button"
                  onClick={() => onChange({ fontFamily: preset.key })}
                  style={preset.family ? { fontFamily: preset.family } : undefined}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-sm transition-colors",
                    active ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-accent",
                  )}
                >
                  {preset.label ?? tt(preset.labelKey ?? "")}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">{t("epub.letter-spacing")}</span>
            <span className="text-xs tabular-nums text-muted-foreground">{settings.letterSpacing.toFixed(2)}em</span>
          </div>
          <input
            type="range"
            min={MIN_LETTER_SPACING}
            max={MAX_LETTER_SPACING}
            step={LETTER_SPACING_STEP}
            value={settings.letterSpacing}
            onChange={(e) => onChange({ letterSpacing: Number(e.target.value) })}
            className="w-full accent-primary"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">{t("epub.line-height")}</span>
            <span className="text-xs tabular-nums text-muted-foreground">{settings.lineHeight.toFixed(1)}</span>
          </div>
          <input
            type="range"
            min={MIN_LINE_HEIGHT}
            max={MAX_LINE_HEIGHT}
            step={LINE_HEIGHT_STEP}
            value={settings.lineHeight}
            onChange={(e) => onChange({ lineHeight: Number(e.target.value) })}
            className="w-full accent-primary"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
};
