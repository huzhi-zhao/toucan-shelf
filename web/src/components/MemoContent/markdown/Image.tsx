import { cn } from "@/lib/utils";
import { getMediaKindFromUrl } from "@/utils/attachment";
import type { ReactMarkdownProps } from "./types";

interface ImageProps extends React.ImgHTMLAttributes<HTMLImageElement>, ReactMarkdownProps {}

/**
 * Renders markdown `![]()` references. All image/video/audio media inserted by the editor
 * uses the same `![]()` syntax (see mediaInsertService.buildMediaMarkdown) — this component
 * tells them apart by the URL's file extension and renders the right native element, so
 * audio/video attachments referenced inline play back instead of showing as a broken image.
 */
export const Image = ({ className, alt, node: _node, height, width, style, src, ...props }: ImageProps) => {
  const mediaKind = getMediaKindFromUrl(src);
  const sizeStyle = { height: height ? `${height}px` : undefined, width: width ? `${width}px` : undefined, ...style };

  if (mediaKind === "video") {
    return <video className={cn("max-w-full my-2 rounded", className)} style={sizeStyle} src={src} controls preload="metadata" />;
  }

  if (mediaKind === "audio") {
    return <audio className={cn("w-full my-2", className)} style={sizeStyle} src={src} controls preload="metadata" />;
  }

  return <img className={cn("max-w-full my-2", !height && "h-auto", className)} alt={alt} style={sizeStyle} src={src} {...props} />;
};
