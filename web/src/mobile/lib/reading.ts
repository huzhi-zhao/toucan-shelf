/** Reading settings, stored per device and independent of the web app's density setting (requirement §7). */
export const READER_FONT_SIZE_KEY = "reader-font-size";
export const READER_FONT_SIZE_DEFAULT = 17;
export const READER_FONT_SIZE_MIN = 15;
export const READER_FONT_SIZE_MAX = 22;

export const READER_LEADING_KEY = "reader-leading";
export const READER_LEADINGS = { compact: 1.6, normal: 1.75, loose: 1.95 } as const;
export type ReaderLeading = keyof typeof READER_LEADINGS;

/**
 * The renderer sizes its type in rem, so a plain font-size on the container
 * would only reach paragraphs. Scaling the whole content keeps headings, code
 * and tables in proportion; 16px is the size the renderer was designed at.
 */
export const readerZoom = (fontSize: number): number => fontSize / 16;
