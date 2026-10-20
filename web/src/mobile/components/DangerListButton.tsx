import { ListButton } from "konsta/react";
import type { ComponentProps } from "react";

// konsta puts `className` on the row and colours the button itself from `colors`, so a red
// `className` never reaches the label: the text has to be set here.
const DANGER_COLORS = {
  textIos: "text-red-500",
  textMaterial: "text-red-500",
  bgIos: "active:bg-red-500/15",
};

/** A list button for destructive actions (delete, cancel, sign out), in red. */
export default function DangerListButton(props: ComponentProps<typeof ListButton>) {
  return <ListButton {...props} colors={DANGER_COLORS} />;
}
