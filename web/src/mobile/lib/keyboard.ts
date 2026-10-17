import { useEffect, useRef } from "react";

const isTextField = (element: Element | null): element is HTMLElement =>
  element instanceof HTMLTextAreaElement ||
  (element instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit", "range"].includes(element.type)) ||
  (element instanceof HTMLElement && element.isContentEditable);

/** Takes focus off the focused text field, which closes the keyboard. */
export function blurTextField() {
  const active = document.activeElement;
  if (isTextField(active)) active.blur();
}

/**
 * iOS gives the keyboard back to the focused field when a home-screen app returns to the foreground, even when
 * that field is off screen (a closed sheet stays mounted). Dropping focus on the way out means coming back
 * never opens a keyboard nobody asked for; a field being typed in saves on blur as usual.
 */
export function useBlurTextFieldWhenHidden() {
  useEffect(() => {
    const onChange = () => {
      if (document.visibilityState === "hidden") blurTextField();
    };
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
}

/** Drops focus when a sheet closes: it slides away but stays mounted, and its field would keep the keyboard up. */
export function useBlurOnClose(opened: boolean) {
  const wasOpened = useRef(opened);
  useEffect(() => {
    if (wasOpened.current && !opened) blurTextField();
    wasOpened.current = opened;
  }, [opened]);
}
