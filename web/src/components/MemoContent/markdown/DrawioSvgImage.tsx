import { create } from "@bufbuild/protobuf";
import { FieldMaskSchema } from "@bufbuild/protobuf/wkt";
import { CodeIcon, DownloadIcon, MaximizeIcon, PencilIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import DrawioEditorDialog from "@/components/DrawioEditorDialog";
import { useMemoViewContextOptional } from "@/components/MemoView/MemoViewContext";
import PreviewImageDialog from "@/components/PreviewImageDialog";
import { attachmentServiceClient } from "@/connect";
import { cn } from "@/lib/utils";
import { AttachmentSchema } from "@/types/proto/api/v1/attachment_service_pb";
import { getAttachmentNameFromUrl } from "@/utils/attachment";
import { compactDrawioSvg, optimizeDrawioSvg, probeDrawioXml } from "@/utils/drawio";
import { useTranslate } from "@/utils/i18n";

interface DrawioSvgImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  sizeStyle: React.CSSProperties;
}

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

const baseFileName = (src: string) => {
  const path = src.split(/[?#]/)[0];
  const last = decodeURIComponent(path.split("/").pop() || "diagram.svg");
  return last.replace(/\.svg$/i, "") || "diagram";
};

/**
 * An `.svg` markdown image that may turn out to be a draw.io export. The diagram source is
 * probed after the image has loaded (that fetch hits the http cache the `<img>` already
 * filled); until and unless the probe succeeds this renders exactly like a plain image, so
 * ordinary SVGs never grow extra controls.
 */
export const DrawioSvgImage = ({ className, alt, src, sizeStyle, ...props }: DrawioSvgImageProps) => {
  const t = useTranslate();
  const [xml, setXml] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  // Bumped after a successful save. The attachment keeps its URL, and while images are now
  // served with `no-cache` + an ETag (so a plain reload does pick the edit up), a fresh query
  // string skips the revalidation round trip and makes the new diagram appear immediately.
  const [revision, setRevision] = useState(0);

  const attachmentName = getAttachmentNameFromUrl(src);
  const readonly = useMemoViewContextOptional()?.readonly ?? true;
  // The server is the real gate (creator or admin, and never for locked attachments); this only
  // keeps the button off diagrams the reader plainly can't change.
  const canEdit = !readonly && !!attachmentName;

  const displaySrc = revision === 0 ? src : `${src}${src.includes("?") ? "&" : "?"}v=${revision}`;

  useEffect(() => {
    setXml(null);
    setLoaded(false);
  }, [displaySrc]);

  useEffect(() => {
    if (!loaded) return;
    const controller = new AbortController();
    probeDrawioXml(displaySrc, controller.signal).then((result) => {
      if (!controller.signal.aborted) setXml(result);
    });
    return () => controller.abort();
  }, [loaded, displaySrc]);

  // Downloads the picture, not the editable source: the embedded `<mxfile>` copy is typically
  // most of the file's bytes and is useless to anything but draw.io. The original stays one
  // "copy image URL" away for anyone who wants to re-import it.
  const handleDownloadSvg = useCallback(async () => {
    const response = await fetch(displaySrc);
    const optimized = optimizeDrawioSvg(await response.text());
    downloadBlob(new Blob([optimized], { type: "image/svg+xml" }), `${baseFileName(src)}.svg`);
  }, [displaySrc, src]);

  const handleDownloadXml = useCallback(() => {
    if (!xml) return;
    downloadBlob(new Blob([xml], { type: "application/xml" }), `${baseFileName(src)}.drawio`);
  }, [src, xml]);

  const handleSave = useCallback(
    async (svgText: string) => {
      if (!attachmentName) return;
      // draw.io re-adds the raster text fallbacks on every export, so the compaction has to run
      // on each save, not just at upload time.
      const stored = compactDrawioSvg(svgText) ?? svgText;
      try {
        await attachmentServiceClient.updateAttachment({
          attachment: create(AttachmentSchema, { name: attachmentName, content: new TextEncoder().encode(stored) }),
          updateMask: create(FieldMaskSchema, { paths: ["content"] }),
        });
        setRevision((current) => current + 1);
        toast.success(t("drawio.saved"));
      } catch (error) {
        toast.error(t("drawio.save-failed"));
        // Rethrow so the editor stays open: closing it on a failed save would look exactly
        // like a successful one and throw away work the user can't get back.
        throw error;
      }
    },
    [attachmentName, t],
  );

  const image = (
    <img
      className={cn("max-w-full my-2", !sizeStyle.height && "h-auto", className)}
      alt={alt}
      style={sizeStyle}
      src={displaySrc}
      onLoad={() => setLoaded(true)}
      {...props}
    />
  );

  if (!xml) {
    return image;
  }

  return (
    <span className="inline-flex flex-col items-start">
      {image}
      <span className="flex flex-row items-center gap-3 text-xs text-muted-foreground">
        {canEdit && (
          <button type="button" className="flex items-center gap-1 hover:text-foreground" onClick={() => setEditing(true)}>
            <PencilIcon className="h-3 w-3" />
            {t("drawio.edit")}
          </button>
        )}
        <button type="button" className="flex items-center gap-1 hover:text-foreground" onClick={handleDownloadSvg}>
          <DownloadIcon className="h-3 w-3" />
          {t("drawio.download-svg")}
        </button>
        <button type="button" className="flex items-center gap-1 hover:text-foreground" onClick={handleDownloadXml}>
          <CodeIcon className="h-3 w-3" />
          {t("drawio.download-xml")}
        </button>
        <button type="button" className="flex items-center gap-1 hover:text-foreground" onClick={() => setPreviewing(true)}>
          <MaximizeIcon className="h-3 w-3" />
          {t("drawio.preview")}
        </button>
      </span>
      {previewing && <PreviewImageDialog open={previewing} onOpenChange={setPreviewing} imgUrls={[displaySrc]} />}
      {editing && <DrawioEditorDialog open={editing} onOpenChange={setEditing} xml={xml} onSave={handleSave} />}
    </span>
  );
};
