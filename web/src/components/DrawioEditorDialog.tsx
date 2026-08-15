import { useCallback, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DRAWIO_EMBED_ORIGIN } from "@/utils/drawio";
import { useTranslate } from "@/utils/i18n";

interface DrawioEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The `mxfile` source to open the editor with. */
  xml: string;
  /** Receives the re-exported SVG (with the diagram source embedded again) when the user saves. */
  onSave: (svgText: string) => Promise<void> | void;
}

// `embed=1&proto=json` is draw.io's postMessage embed mode; `spin=1` shows its own loading
// spinner while the (fairly large) editor boots.
const EDITOR_URL = `${DRAWIO_EMBED_ORIGIN}/?embed=1&proto=json&spin=1&libraries=1`;

// Decodes the `data:image/svg+xml;base64,…` URI draw.io returns from an xmlsvg export.
const decodeExportedSvg = (data: string): string | null => {
  const marker = "base64,";
  const index = data.indexOf(marker);
  if (index < 0) return null;
  try {
    const binary = atob(data.slice(index + marker.length));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
};

/**
 * Full-screen draw.io editor over a diagram's own embedded source.
 *
 * The editor is a third-party iframe (see ADR-0017): everything runs in the browser, but the
 * message channel is still a trust boundary, so only messages whose origin is exactly the
 * configured draw.io origin are read — anything else is dropped without a look at its payload.
 */
export const DrawioEditorDialog = ({ open, onOpenChange, xml, onSave }: DrawioEditorDialogProps) => {
  const t = useTranslate();
  const frameRef = useRef<HTMLIFrameElement>(null);
  // Kept in a ref so the message listener never has to be re-subscribed mid-session
  // (re-subscribing between `init` and `save` would lose the exchange).
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const xmlRef = useRef(xml);
  xmlRef.current = xml;

  const post = useCallback((message: unknown) => {
    frameRef.current?.contentWindow?.postMessage(JSON.stringify(message), DRAWIO_EMBED_ORIGIN);
  }, []);

  useEffect(() => {
    if (!open) return;

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== DRAWIO_EMBED_ORIGIN) return;
      if (typeof event.data !== "string") return;
      let message: { event?: string; data?: string; format?: string };
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }

      switch (message.event) {
        case "init":
          // autosave off: the diagram is written back only on an explicit save.
          post({ action: "load", xml: xmlRef.current, autosave: 0 });
          break;
        case "save":
          // `xmlsvg` re-embeds the mxfile source in the exported SVG, so the saved file is
          // itself editable — the round trip can repeat indefinitely without degrading.
          post({ action: "export", format: "xmlsvg" });
          break;
        case "export": {
          const svgText = message.data ? decodeExportedSvg(message.data) : null;
          if (svgText) {
            void Promise.resolve(onSaveRef.current(svgText)).then(() => onOpenChange(false));
          }
          break;
        }
        case "exit":
          onOpenChange(false);
          break;
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onOpenChange, open, post]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* size="full" is what clears the default `md:max-w-md` cap; without it the editor
          would be squeezed into a phone-width column on desktop. */}
      <DialogContent
        size="full"
        className="w-[80vw]! max-w-[80vw]! h-[85vh] max-h-[85vh] p-0! sm:p-0! flex flex-col gap-0 [&>div]:gap-0 [&>div]:overflow-hidden"
      >
        <DialogHeader className="px-4 py-2 border-b">
          <DialogTitle className="text-sm font-medium">{t("drawio.editor-title")}</DialogTitle>
        </DialogHeader>
        <iframe
          ref={frameRef}
          className="w-full grow border-0"
          src={EDITOR_URL}
          title={t("drawio.editor-title")}
          sandbox="allow-scripts allow-same-origin"
        />
      </DialogContent>
    </Dialog>
  );
};

export default DrawioEditorDialog;
