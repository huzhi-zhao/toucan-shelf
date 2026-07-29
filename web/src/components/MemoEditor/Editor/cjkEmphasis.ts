import type { MarkdownConfig } from "@lezer/markdown";

/**
 * CommonMark refuses to close a `**` run whose last character is punctuation
 * when the character after the closing `**` is a letter. In Chinese that kills
 * the single most common bold pattern there is:
 *
 *     **注意：**这里要小心
 *
 * The reading view fixes this with `remark-cjk-friendly`, which implements the
 * CommonMark CJK-friendly emphasis proposal (full-width punctuation is treated
 * as an ideograph rather than punctuation when deciding whether a delimiter run
 * can open or close). Lezer's markdown parser — which drives the editor's
 * syntax highlighting — has no such extension and cannot be re-configured, so
 * this inline parser fills the same gap for the editor: it runs before Lezer's
 * own `Emphasis` parser and claims exactly the runs Lezer would get wrong,
 * leaving every case CommonMark already handles to Lezer untouched.
 */

const ASTERISK = 42;
const NEWLINE = 10;

/** Same broad definition Lezer uses: Unicode symbols and punctuation. */
const PUNCTUATION = /[\p{S}\p{P}]/u;

/** Wide and ambiguous-width punctuation CJK text is written with: 、。「」【】：，！？（）—…“” */
const CJK_PUNCTUATION = /[‐-‧　-〿！-｠￠-￮]/u;

/** Ideographs, kana and hangul, plus the punctuation that goes with them. */
const CJK = new RegExp(`[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}]|${CJK_PUNCTUATION.source}`, "u");

interface Flanking {
  canOpen: boolean;
  canClose: boolean;
}

/**
 * Lezer's flanking computation for a `*` run. `cjkFriendly` applies the two
 * relaxations of the CJK-friendly proposal: full-width punctuation next to the
 * run stops blocking it (a run may end in `：`), and a CJK character on the far
 * side counts as the punctuation the rules ask for (`**加粗-**继续` closes).
 */
function flanking(before: string, after: string, cjkFriendly: boolean): Flanking {
  // Whether the neighbour blocks the run…
  const blocks = (ch: string) => PUNCTUATION.test(ch) && !(cjkFriendly && CJK_PUNCTUATION.test(ch));
  // …and whether it satisfies the "adjacent to punctuation" allowance.
  const allows = (ch: string) => PUNCTUATION.test(ch) || (cjkFriendly && CJK.test(ch));
  const sBefore = /\s|^$/.test(before);
  const sAfter = /\s|^$/.test(after);
  const leftFlanking = !sAfter && (!blocks(after) || sBefore || allows(before));
  const rightFlanking = !sBefore && (!blocks(before) || sAfter || allows(after));
  // For `*` (as opposed to `_`) the intraword restriction does not apply.
  return { canOpen: leftFlanking, canClose: rightFlanking };
}

/**
 * Characters that start some other inline construct. The element this parser
 * emits is a leaf — its content is not parsed further — so a run containing any
 * of them is left to Lezer rather than swallowing the nested markup.
 */
const NESTED_INLINE = /[*_`[\]<>\\$~!&]/;

export const cjkEmphasis: MarkdownConfig = {
  parseInline: [
    {
      name: "CjkStrongEmphasis",
      before: "Emphasis",
      parse(cx, next, start) {
        // Only a run of exactly two asterisks, taken at its first character.
        if (next !== ASTERISK) return -1;
        if (cx.char(start - 1) === ASTERISK || cx.char(start + 1) !== ASTERISK || cx.char(start + 2) === ASTERISK) return -1;

        const openBefore = cx.slice(start - 1, start);
        const openAfter = cx.slice(start + 2, start + 3);
        if (!flanking(openBefore, openAfter, true).canOpen) return -1;

        // Find the closing run: the next `**` on this line, with nothing in
        // between that belongs to another inline construct.
        let pos = start + 2;
        for (; pos < cx.end; pos++) {
          const ch = cx.char(pos);
          if (ch === NEWLINE) return -1;
          if (ch === ASTERISK) break;
          if (NESTED_INLINE.test(String.fromCharCode(ch))) return -1;
        }
        if (pos >= cx.end || pos === start + 2) return -1;
        if (cx.char(pos + 1) !== ASTERISK || cx.char(pos + 2) === ASTERISK) return -1;

        const closeBefore = cx.slice(pos - 1, pos);
        const closeAfter = cx.slice(pos + 2, pos + 3);
        // Claim the run only when the CJK-friendly rules rescue a closing
        // delimiter that CommonMark rejects; anything else is Lezer's job.
        if (!flanking(closeBefore, closeAfter, true).canClose) return -1;
        if (flanking(closeBefore, closeAfter, false).canClose) return -1;

        const end = pos + 2;
        return cx.addElement(
          cx.elt("StrongEmphasis", start, end, [cx.elt("EmphasisMark", start, start + 2), cx.elt("EmphasisMark", pos, end)]),
        );
      },
    },
  ],
};
