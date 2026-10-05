import { createContext } from "react";

// A decrypted payload is rendered as markdown, so it could itself contain a
// `toucan-secret` fence. This flag stops that from nesting unlock cards inside
// unlock cards; nested fences fall through to a plain locked card with no form.
// Shared by the ordinary and the restricted card, which both render payloads.
export const InsideSecretBlock = createContext(false);

// Decrypted payloads never resolve @mentions: they are private to the owner.
export const NO_MENTIONS = new Set<string>();
