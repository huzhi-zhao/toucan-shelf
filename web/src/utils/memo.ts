import type { Memo } from "@/types/proto/api/v1/memo_service_pb";
import { Visibility } from "@/types/proto/api/v1/memo_service_pb";

/**
 * Filesystem-safe base name for a memo, falling back to its uid when untitled.
 * Used for downloaded file names, and as the reader page's `document.title` —
 * which is what browsers offer as the default name when printing to PDF.
 */
export const buildMemoFileBaseName = (memo: Pick<Memo, "name" | "title">) => {
  const fallback = memo.name.split("/").pop() || "memo";
  return (memo.title || fallback).trim().replace(/[\\/:*?"<>|]+/g, "-") || fallback;
};

export const convertVisibilityFromString = (visibility: string) => {
  switch (visibility) {
    case "PUBLIC":
      return Visibility.PUBLIC;
    case "PROTECTED":
      return Visibility.PROTECTED;
    case "PRIVATE":
      return Visibility.PRIVATE;
    default:
      return Visibility.PUBLIC;
  }
};

export const convertVisibilityToString = (visibility: Visibility) => {
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
