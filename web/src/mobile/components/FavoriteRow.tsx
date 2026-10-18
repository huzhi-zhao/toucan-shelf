import { ListItem } from "konsta/react";
import { PinIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { Favorite } from "@/types/proto/api/v1/favorite_service_pb";
import DocGlyph from "./DocGlyph";

/** One favorite: the document, its knowledge base, and a pin mark or a control on the right. */
export default function FavoriteRow({ favorite, onOpen, after }: { favorite: Favorite; onOpen: () => void; after?: ReactNode }) {
  return (
    <ListItem
      link={!after}
      chevron={!after}
      title={<span className="block truncate">{favorite.title}</span>}
      text={favorite.workspaceTitle}
      media={<DocGlyph icon={favorite.icon} docType={favorite.docType} size={22} />}
      after={after ?? (favorite.pinned ? <PinIcon className="h-4 w-4 text-black/35 dark:text-white/35" /> : undefined)}
      onClick={onOpen}
    />
  );
}
