import { EyeIcon, EyeOffIcon } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";
import { Input } from "./input";

/**
 * A passphrase field that browsers do not treat as a password field.
 *
 * `<input type="password">` is what triggers Chrome's "save this password?"
 * prompt, and there is no way to opt out: `autocomplete="off"` is ignored on
 * password inputs by design, and `autocomplete="new-password"` makes it worse by
 * actively inviting the password generator. The only reliable escape is to stop
 * being a password field — a text input masked in CSS instead.
 *
 * That is the right trade for `toucan-secret` passphrases specifically. These
 * unlock content inside a document; they are not site credentials, and a password
 * manager offering to save one for "this site" would be saving it under an
 * identity it does not belong to. Sign-in fields elsewhere in the app stay
 * `type="password"`, where that offer is genuinely useful.
 *
 * `-webkit-text-security` covers Chrome, Safari and Edge. Firefox does not
 * implement it, so `revealable` gives those users a way to check what they typed
 * rather than typing a long passphrase blind — see `masked-input` in index.css,
 * where the fallback is defined.
 */
export interface MaskedInputProps extends Omit<React.ComponentProps<"input">, "type"> {
  /** Shows a toggle that reveals the value. Off by default. */
  revealable?: boolean;
}

function MaskedInput({ className, revealable = false, ...props }: MaskedInputProps) {
  const [revealed, setRevealed] = React.useState(false);

  const input = (
    <Input
      {...props}
      type="text"
      data-masked={revealed ? undefined : ""}
      // Not a password field as far as the DOM is concerned, so these actually
      // take effect here — unlike on a real password input.
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      className={cn("masked-input", revealable ? "pr-8" : className)}
    />
  );

  if (!revealable) {
    return input;
  }

  // The wrapper carries the caller's sizing so the toggle sits inside the field
  // rather than beside it; the input itself then fills the wrapper.
  return (
    <div className={cn("relative", className)}>
      {input}
      <button
        type="button"
        tabIndex={-1}
        aria-label={revealed ? "Hide" : "Show"}
        className="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-muted-foreground hover:text-foreground"
        onClick={() => setRevealed((open) => !open)}
      >
        {revealed ? <EyeOffIcon className="w-3.5 h-3.5" /> : <EyeIcon className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

export { MaskedInput };
