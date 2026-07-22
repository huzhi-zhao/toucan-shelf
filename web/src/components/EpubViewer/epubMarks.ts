// EPUB marks use the shared text-mark palette (see utils/markColors), so a highlight made in a
// book and one made in a notebook document mean and look the same. Re-exported under the EPUB
// names this module has always used, to keep the reader's call sites unchanged.
export { DEFAULT_MARK_COLOR, getMarkColor, MARK_COLORS as EPUB_MARK_COLORS, type MarkColor as EpubMarkColor } from "@/utils/markColors";
