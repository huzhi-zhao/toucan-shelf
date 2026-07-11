import { LayoutGridIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useTranslate } from "@/utils/i18n";
import {
  DEFAULT_GALLERY_CONFIG,
  type GalleryCoverRule,
  type GallerySort,
  type GalleryViewConfig,
  parseGalleryViewConfig,
  serializeGalleryViewConfig,
} from "./types";

interface Props {
  content: string;
  onSave: (content: string) => void;
  onCancel: () => void;
}

// Guided editor for VIEW documents: pick a view style (gallery only for now,
// listed so future styles like calendar can slot in), then fill the fixed,
// hand-written form for that style. Submitting stores only the config JSON
// (plus the optional markdown intro) as the document content.
const GalleryViewForm = ({ content, onSave, onCancel }: Props) => {
  const t = useTranslate();
  const existing = parseGalleryViewConfig(content);
  const [styleChosen, setStyleChosen] = useState(!!existing);
  const [description, setDescription] = useState(existing?.description ?? "");
  const [scopeType, setScopeType] = useState<"folder" | "tag">(existing?.scope.type ?? "folder");
  const [tag, setTag] = useState(existing?.scope.type === "tag" ? existing.scope.tag : "");
  const [sort, setSort] = useState<GallerySort>(existing?.sort ?? DEFAULT_GALLERY_CONFIG.sort);
  const [cover, setCover] = useState<GalleryCoverRule>(existing?.cover ?? DEFAULT_GALLERY_CONFIG.cover);

  if (!styleChosen) {
    return (
      <div className="w-full max-w-lg mx-auto flex flex-col gap-3">
        <div className="text-sm text-muted-foreground">{t("gallery.choose-style")}</div>
        <button
          type="button"
          className="flex items-center gap-3 rounded-lg border border-border p-4 text-left hover:bg-accent/60 transition-colors"
          onClick={() => setStyleChosen(true)}
        >
          <LayoutGridIcon className="w-6 h-6 text-primary shrink-0" />
          <div>
            <div className="font-medium">{t("gallery.style-gallery")}</div>
            <div className="text-sm text-muted-foreground">{t("gallery.style-gallery-description")}</div>
          </div>
        </button>
      </div>
    );
  }

  const handleSubmit = () => {
    const config: GalleryViewConfig = {
      viewType: "gallery",
      description: description.trim() ? description : undefined,
      scope: scopeType === "tag" ? { type: "tag", tag: tag.trim() } : { type: "folder" },
      sort,
      cover,
    };
    onSave(serializeGalleryViewConfig(config));
  };

  return (
    <div className="w-full max-w-lg mx-auto flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="gallery-description">{t("gallery.description-label")}</Label>
        <Textarea
          id="gallery-description"
          rows={4}
          placeholder={t("gallery.description-placeholder")}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{t("gallery.scope-label")}</Label>
        <RadioGroup value={scopeType} onValueChange={(v) => setScopeType(v as "folder" | "tag")} className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <RadioGroupItem value="folder" id="gallery-scope-folder" />
            <Label htmlFor="gallery-scope-folder" className="font-normal cursor-pointer">
              {t("gallery.scope-folder")}
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="tag" id="gallery-scope-tag" />
            <Label htmlFor="gallery-scope-tag" className="font-normal cursor-pointer">
              {t("gallery.scope-tag")}
            </Label>
          </div>
        </RadioGroup>
        {scopeType === "tag" && <Input placeholder={t("gallery.tag-placeholder")} value={tag} onChange={(e) => setTag(e.target.value)} />}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{t("gallery.sort-label")}</Label>
        <Select value={sort} onValueChange={(v) => setSort(v as GallerySort)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="updated_desc">{t("gallery.sort-updated-desc")}</SelectItem>
            <SelectItem value="updated_asc">{t("gallery.sort-updated-asc")}</SelectItem>
            <SelectItem value="created_desc">{t("gallery.sort-created-desc")}</SelectItem>
            <SelectItem value="created_asc">{t("gallery.sort-created-asc")}</SelectItem>
            <SelectItem value="title_asc">{t("gallery.sort-title-asc")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{t("gallery.cover-label")}</Label>
        <Select value={cover} onValueChange={(v) => setCover(v as GalleryCoverRule)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="first_image">{t("gallery.cover-first-image")}</SelectItem>
            <SelectItem value="none">{t("gallery.cover-none")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button onClick={handleSubmit} disabled={scopeType === "tag" && !tag.trim()}>
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
};

export default GalleryViewForm;
