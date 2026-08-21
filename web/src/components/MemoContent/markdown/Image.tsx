import PublicAttachmentBadge from "@/components/MemoMetadata/Attachment/PublicAttachmentBadge";
import { cn } from "@/lib/utils";
import { getMediaKindFromUrl } from "@/utils/attachment";
import { isSvgUrl } from "@/utils/drawio";
import { useTranslate } from "@/utils/i18n";
import { usePublicInlineAttachment } from "../InlineAttachmentContext";
import { DrawioSvgImage } from "./DrawioSvgImage";
import type { ReactMarkdownProps } from "./types";

interface ImageProps extends React.ImgHTMLAttributes<HTMLImageElement>, ReactMarkdownProps {}

/**
 * Renders markdown `![]()` references. All image/video/audio media inserted by the editor
 * uses the same `![]()` syntax (see mediaInsertService.buildMediaMarkdown) — this component
 * tells them apart by the URL's file extension and renders the right native element, so
 * audio/video attachments referenced inline play back instead of showing as a broken image.
 */
export const Image = ({ className, alt, node: _node, height, width, style, src, ...props }: ImageProps) => {
  const t = useTranslate();
  const mediaKind = getMediaKindFromUrl(src);
  const publicAttachment = usePublicInlineAttachment(src);
  const sizeStyle = { height: height ? `${height}px` : undefined, width: width ? `${width}px` : undefined, ...style };

  if (mediaKind === "video") {
    return <video className={cn("max-w-full my-2 rounded", className)} style={sizeStyle} src={src} controls preload="metadata" />;
  }

  if (mediaKind === "audio") {
    return <audio className={cn("w-full my-2", className)} style={sizeStyle} src={src} controls preload="metadata" />;
  }

  // SVGs may be draw.io exports carrying their own editable source; that component falls back
  // to a plain <img> when they aren't (see utils/drawio.ts).
  if (src && isSvgUrl(src)) {
    return <DrawioSvgImage className={className} alt={alt} sizeStyle={sizeStyle} src={src} {...props} />;
  }

  const img = <img className={cn("max-w-full my-2", !height && "h-auto", className)} alt={alt} style={sizeStyle} src={src} {...props} />;

  // A public image gets a hover badge in its corner. The wrapper is `inline-block` and
  // carries no styling of its own so it takes the image's own box — anything wider would
  // push the badge away from the picture in a centered or narrow-image layout.
  if (!publicAttachment) {
    return img;
  }

  return (
    <span className="group/media relative inline-block max-w-full leading-none">
      {img}
      <PublicAttachmentBadge attachment={publicAttachment} label={t("attachment.public.badge")} />
    </span>
  );
};
