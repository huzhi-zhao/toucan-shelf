// Client-side helpers for restricted secret blocks: the time-gated variant of a
// `toucan-secret` block. The gate itself is enforced by the server; nothing here
// decides whether a block may open. These helpers only shape what the reader sees
// and types. See docs/dev/requirements/editor/restricted-secret-block.md.

// The fixed sentences an emergency unlock must be typed with. Mirrored in
// server/router/api/v1/secret_block_restriction.go (secretEmergencyStatements) —
// the server accepts exactly these, so the two lists must change together.
export const EMERGENCY_STATEMENTS = {
  zh: "我确认这件事现在必须处理，不能等到明天",
  en: "I confirm this cannot wait until tomorrow",
} as const;

export const emergencyStatementFor = (language: string): string =>
  language.toLowerCase().startsWith("zh") ? EMERGENCY_STATEMENTS.zh : EMERGENCY_STATEMENTS.en;

// Same rule as the server: surrounding whitespace trimmed, inner runs collapsed,
// everything else (case, punctuation) exact.
export const normalizeTypedText = (text: string): string => text.trim().split(/\s+/).filter(Boolean).join(" ");

export const typedTextMatches = (typed: string, expected: string): boolean =>
  normalizeTypedText(expected) !== "" && normalizeTypedText(typed) === normalizeTypedText(expected);

export const MIN_EMERGENCY_REASON_LENGTH = 10;

// Counted in code points to match the server's rune count.
export const emergencyReasonLongEnough = (reason: string): boolean => Array.from(reason.trim()).length >= MIN_EMERGENCY_REASON_LENGTH;

// How many characters one press-and-hold reveals. Small enough that a single
// screenshot gives away little, large enough to type from comfortably.
export const SECRET_SEGMENT_SIZE = 4;

/**
 * Splits a secret into lines of fixed-size segments for the press-to-reveal
 * viewer. Splits by code point so a multi-byte character is never cut in half.
 * Empty lines are kept (as empty segment lists) so the layout matches the text.
 */
export const splitSecretSegments = (text: string, size = SECRET_SEGMENT_SIZE): string[][] =>
  text.split(/\r?\n/).map((line) => {
    const chars = Array.from(line);
    const segments: string[] = [];
    for (let i = 0; i < chars.length; i += size) {
      segments.push(chars.slice(i, i + size).join(""));
    }
    return segments;
  });

export type SecretCharClass = "digit" | "upper" | "lower" | "space" | "symbol" | "other";

// The label drawn under each revealed character, so 0/O and 1/l/I cannot be
// confused when the secret is typed by hand.
export const secretCharClass = (ch: string): SecretCharClass => {
  if (/^[0-9]$/.test(ch)) return "digit";
  if (/^[A-Z]$/.test(ch)) return "upper";
  if (/^[a-z]$/.test(ch)) return "lower";
  if (/^\s$/.test(ch)) return "space";
  if (/^[\x21-\x7e]$/.test(ch)) return "symbol";
  return "other";
};

export const browserTimeZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};
