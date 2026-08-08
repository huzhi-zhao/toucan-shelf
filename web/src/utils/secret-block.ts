// Parsing and serialization for the `toucan-secret` fenced block.
//
// The block body carries a reference and a label — no salt, no nonce, no
// ciphertext. Everything cryptographic lives in the `secret_block` record the id
// points at. Keeping the document side this thin is deliberate: a superseded
// envelope must leave no copy behind in memo history or in a memogit checkout,
// which is only possible if the document never held the envelope in the first
// place. See docs/dev/requirements/editor/secret-block.md.

export const SECRET_BLOCK_LANGUAGE = "toucan-secret";

// The format version of the block body. Parsing rejects anything else rather than
// guessing: if a later format gives `id` a different meaning, an older client must
// say "I don't understand this block" instead of confidently opening the wrong
// record.
export const SECRET_BLOCK_VERSION = 1;

export interface SecretBlockRef {
  version: number;
  // The uid half of the `secretBlocks/{uid}` resource name.
  id: string;
  /**
   * A human label for the block — "MinIO 安装过程", "prod database". It is the
   * block's title in the rendered card, and it is the only thing that says what a
   * block is for when you read the raw markdown in a memogit checkout.
   *
   * Plain text on purpose. It describes the secret, it is not part of it.
   */
  hint: string;
}

// Server-issued uids are shortuuid-style; accept the conservative superset that
// survives a markdown round-trip untouched.
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// A freshly inserted block has no server record yet, so it carries a locally
// generated id instead. That id is what makes the block addressable in the raw
// markdown: without it, two uninitialized blocks in one document would be
// indistinguishable and writing the real id back could land on the wrong one.
//
// The prefix also means "not yet initialized" can be decided without a lookup.
export const LOCAL_SECRET_ID_PREFIX = "local-";

export const isLocalSecretId = (id: string): boolean => id.startsWith(LOCAL_SECRET_ID_PREFIX);

export const newLocalSecretId = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return LOCAL_SECRET_ID_PREFIX + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

// parseSecretBlock reads a `toucan-secret` block body. Returns null for anything
// malformed — the renderer shows a broken-block state rather than throwing, matching
// how the other fenced blocks degrade.
export const parseSecretBlock = (source: string): SecretBlockRef | null => {
  let version: number | undefined;
  let id: string | undefined;
  let hint = "";

  for (const rawLine of source.split("\n")) {
    const line = rawLine.trim();
    if (line === "") {
      continue;
    }
    const separator = line.indexOf(":");
    if (separator === -1) {
      return null;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();

    switch (key) {
      case "v": {
        // Reject "1abc" and friends: Number.parseInt would happily accept them.
        if (!/^\d+$/.test(value)) {
          return null;
        }
        version = Number.parseInt(value, 10);
        break;
      }
      case "id":
        id = value;
        break;
      case "hint":
        hint = value;
        break;
      default:
        // Unknown keys are a format error rather than something to skip. A block we
        // do not fully understand may be a newer format whose id means something
        // different, and silently honoring just the id could unlock the wrong record.
        return null;
    }
  }

  if (version !== SECRET_BLOCK_VERSION || id === undefined || !ID_PATTERN.test(id)) {
    return null;
  }
  return { version, id, hint };
};

// A hint is a single line in a line-oriented format, so anything that would break
// out of it is dropped rather than escaped.
export const sanitizeSecretHint = (hint: string): string => hint.replace(/[\r\n]+/g, " ").trim();

// serializeSecretBlock renders the block body (without the surrounding fences).
export const serializeSecretBlock = (id: string, hint = ""): string => {
  if (!ID_PATTERN.test(id)) {
    throw new Error(`invalid secret block id: ${id}`);
  }
  const cleanHint = sanitizeSecretHint(hint);
  const lines = [`v: ${SECRET_BLOCK_VERSION}`, `id: ${id}`];
  if (cleanHint !== "") {
    lines.push(`hint: ${cleanHint}`);
  }
  return lines.join("\n");
};

// secretBlockFence renders the complete fenced block, ready to splice into a
// document body.
export const secretBlockFence = (id: string, hint = ""): string => {
  return `\`\`\`${SECRET_BLOCK_LANGUAGE}\n${serializeSecretBlock(id, hint)}\n\`\`\``;
};

const FENCE_START_RE = /^```toucan-secret\s*$/;
const FENCE_END_RE = /^```\s*$/;

/**
 * Rewrites the body of the `toucan-secret` block currently carrying `fromId`.
 *
 * Used when initialization turns a local id into a server uid, and when the label
 * changes. Returns null when no such block is found, so the caller can refuse to
 * save rather than silently persist a document whose block still points nowhere.
 */
export const rewriteSecretBlock = (source: string, fromId: string, next: { id: string; hint: string }): string | null => {
  const lines = source.split("\n");
  let fenceStart = -1;
  let bodyStart = -1;
  let bodyEnd = -1;

  for (let i = 0; i < lines.length; i++) {
    if (fenceStart === -1) {
      if (FENCE_START_RE.test(lines[i])) {
        fenceStart = i;
        bodyStart = i + 1;
      }
      continue;
    }
    if (FENCE_END_RE.test(lines[i])) {
      // Closing fence: this block is done. Check whether it was the one we wanted.
      bodyEnd = i;
      const body = lines.slice(bodyStart, bodyEnd).join("\n");
      const ref = parseSecretBlock(body);
      if (ref?.id === fromId) {
        return [...lines.slice(0, bodyStart), ...serializeSecretBlock(next.id, next.hint).split("\n"), ...lines.slice(bodyEnd)].join("\n");
      }
      fenceStart = -1;
      bodyStart = -1;
      bodyEnd = -1;
    }
  }

  return null;
};
