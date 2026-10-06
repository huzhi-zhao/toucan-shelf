/**
 * A document's icon (`memo.icon`) is one system emoji, or empty for the doc-type default. It is
 * stored off-content in the memo payload, so it never leaks into the title, link paths or a
 * memogit export.
 *
 * Only system emoji are supported: the picker offers a curated set and also accepts anything the
 * OS emoji keyboard types (⌃⌘Space on macOS, Win+. on Windows), as long as it is a single emoji.
 */

// One grapheme that is an emoji: a pictograph, a flag (regional-indicator pair) or a keycap.
const EMOJI_MARKER = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u;
const LETTER = /\p{L}/u;

const graphemes = (text: string): string[] => {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), (s) => s.segment);
  }
  return Array.from(text);
};

/** The input as a single emoji, or undefined when it is anything else (text, several emoji, empty). */
export function normalizeDocIcon(input: string): string | undefined {
  const text = input.trim();
  if (!text || LETTER.test(text)) return undefined;
  const parts = graphemes(text);
  if (parts.length !== 1 || !EMOJI_MARKER.test(parts[0])) return undefined;
  return parts[0];
}

/** The picker's ready-made choices, roughly grouped: documents & work, status, nature, objects, faces. */
// biome-ignore format: kept as a 10-wide grid, matching the picker.
export const DOC_ICON_PRESETS: readonly string[] = [
  // Documents & work
  "📄", "📝", "📒", "📓", "📔", "📕", "📗", "📘", "📙", "📚",
  "📖", "🗂️", "📁", "📂", "🗃️", "🗄️", "📋", "📌", "📍", "📎",
  "🔖", "🏷️", "📅", "🗓️", "📆", "⏰", "⏳", "📊", "📈", "📉",
  "🧾", "✉️", "📮", "📦", "💼", "🖋️", "✏️", "🖊️", "🔍", "💡",
  // Status & symbols
  "✅", "☑️", "❌", "⚠️", "❗", "❓", "⭐", "🌟", "✨", "🔥",
  "🎯", "🚀", "🏆", "🥇", "🎉", "🔒", "🔑", "🔗", "♻️", "🚧",
  "🔴", "🟠", "🟡", "🟢", "🔵", "🟣", "⚫", "⚪", "❤️", "💬",
  // Places, nature & travel
  "🏠", "🏢", "🏫", "🏥", "🏛️", "🌍", "🗺️", "✈️", "🚗", "⛰️",
  "🌳", "🌱", "🌸", "🍀", "☀️", "🌙", "⛅", "❄️", "🌊", "🐾",
  // Objects & activities
  "💻", "📱", "⌨️", "🖥️", "🧰", "🔧", "⚙️", "🧪", "🔬", "🧠",
  "🎨", "🎵", "🎬", "📷", "🎮", "⚽", "🍳", "☕", "🍎", "💰",
  // People
  "😀", "😊", "🤔", "😎", "🥳", "👍", "👏", "🙌", "💪", "🤝",
];
