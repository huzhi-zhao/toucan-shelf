// The ```mask fenced block: text drawn on canvas a few characters at a time and
// visible only while held, so it has to be typed by hand. Presentation only —
// the text sits in the markdown source like any other block, so this is
// friction against copying, not secrecy. Inside a restricted secret block it
// marks the part of the decrypted payload that stays hidden.

export const MASK_BLOCK_LANGUAGE = "mask";

const MASK_FENCE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*mask(?=[ \t]|$)/im;

/** Whether a markdown document contains at least one ```mask block. */
export const containsMaskBlock = (markdown: string): boolean => MASK_FENCE_RE.test(markdown);

/** The fence body as shown: trailing newlines dropped so no empty last row is drawn. */
export const maskBlockText = (raw: string): string => raw.replace(/(\r?\n)+$/, "");
