import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MemoContent from "@/components/MemoContent";
import { containsMaskBlock, maskBlockText } from "@/utils/mask-block";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ currentUser: undefined }), useSoftBreakDefault: () => false }));

describe("containsMaskBlock", () => {
  it("finds a mask fence opened with backticks or tildes", () => {
    expect(containsMaskBlock("账户：AAA\n```mask\naaaa\n```")).toBe(true);
    expect(containsMaskBlock("~~~mask\naaaa\n~~~")).toBe(true);
    expect(containsMaskBlock("  ```MASK\naaaa\n```")).toBe(true);
    expect(containsMaskBlock("```mask title=x\naaaa\n```")).toBe(true);
  });

  it("ignores other languages and text that only mentions the word", () => {
    expect(containsMaskBlock("```masking\naaaa\n```")).toBe(false);
    expect(containsMaskBlock("```text\nmask\n```")).toBe(false);
    expect(containsMaskBlock("use ```mask to hide")).toBe(false);
    expect(containsMaskBlock("    ```mask\nindented code\n```")).toBe(false);
  });

  it("drops trailing newlines from the fence body", () => {
    expect(maskBlockText("aaaa\n")).toBe("aaaa");
    expect(maskBlockText("a\nb\n\n")).toBe("a\nb");
  });
});

const renderContent = (content: string) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoContent content={content} />
    </QueryClientProvider>,
  );

describe("```mask in an ordinary document", () => {
  it("renders the surrounding text normally and the masked text only on canvas", () => {
    const { container } = renderContent("Mac 管理员账户：AAA 密码:\n\n```mask\nZx9-admin-PW\n```");

    expect(container.textContent).toContain("Mac 管理员账户：AAA");
    expect(container.textContent).not.toContain("Zx9-admin-PW");
    expect(container.textContent).not.toContain("Zx9-");
    // 12 characters → three held-to-reveal segments, each a canvas.
    expect(screen.getAllByRole("button", { pressed: false })).toHaveLength(3);
    expect(container.querySelectorAll("button canvas")).toHaveLength(3);
  });

  it("refuses copy from the masked block", () => {
    const { container } = renderContent("```mask\nsecret\n```");
    const block = container.querySelector("canvas")?.closest("div.select-none") as Element;
    const copy = createEvent.copy(block);
    fireEvent(block, copy);
    expect(copy.defaultPrevented).toBe(true);
  });
});
