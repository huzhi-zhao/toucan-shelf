import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PERIODIC_SAVE_STORAGE_KEY } from "@/components/MemoEditor/constants";
import { usePeriodicSavePreference } from "@/components/MemoEditor/hooks/usePeriodicSave";

let api: { enabled: boolean; setEnabled: (next: boolean) => void };

function Probe({ memoName }: { memoName?: string }) {
  const [enabled, setEnabled] = usePeriodicSavePreference(memoName);
  api = { enabled, setEnabled };
  return null;
}

const readStore = () => JSON.parse(window.localStorage.getItem(PERIODIC_SAVE_STORAGE_KEY) ?? "{}");

describe("usePeriodicSavePreference", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("defaults to off and stores the opt-in under the document's name", () => {
    render(<Probe memoName="memos/alpha" />);

    expect(api.enabled).toBe(false);

    act(() => api.setEnabled(true));

    expect(api.enabled).toBe(true);
    expect(readStore()).toEqual({ "memos/alpha": true });
  });

  // The whole point of the per-document key: opting in on one document must not
  // silently auto-commit edits made in another one.
  it("does not leak an opt-in to a different document", () => {
    const { rerender } = render(<Probe memoName="memos/alpha" />);
    act(() => api.setEnabled(true));

    rerender(<Probe memoName="memos/beta" />);
    expect(api.enabled).toBe(false);

    rerender(<Probe memoName="memos/alpha" />);
    expect(api.enabled).toBe(true);
  });

  it("drops the entry when turned off instead of keeping a false flag", () => {
    render(<Probe memoName="memos/alpha" />);
    act(() => api.setEnabled(true));
    act(() => api.setEnabled(false));

    expect(api.enabled).toBe(false);
    expect(readStore()).toEqual({});
  });

  it("stays off and writes nothing when there is no document yet", () => {
    render(<Probe />);

    act(() => api.setEnabled(true));

    expect(api.enabled).toBe(false);
    expect(window.localStorage.getItem(PERIODIC_SAVE_STORAGE_KEY)).toBeNull();
  });
});
