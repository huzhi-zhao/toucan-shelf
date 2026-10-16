import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PropertiesPanel } from "@/components/MemoContent/PropertiesPanel";
import type { MemoProperty } from "@/utils/frontmatter";

const properties: MemoProperty[] = [{ key: "owner", type: "text", value: "Alice" }];

const renderPanel = (onChange = vi.fn()) => {
  render(
    <div>
      <PropertiesPanel properties={properties} onChange={onChange} />
      <p>outside</p>
    </div>,
  );
  return onChange;
};

// Translations load asynchronously, so the first query waits for the panel to appear.
const enterEditMode = async () => fireEvent.click(await screen.findByRole("button", { name: "Edit properties" }));

describe("<PropertiesPanel> editing from the preview", () => {
  it("has no confirm step: the pencil goes away while editing", async () => {
    renderPanel();
    await enterEditMode();
    expect(screen.getByRole("textbox")).toHaveValue("Alice");
    expect(screen.queryByRole("button", { name: "Edit properties" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
  });

  it("leaves edit mode on a click outside the panel, keeping what was typed", async () => {
    const onChange = renderPanel();
    await enterEditMode();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Bob" } });
    // A real click blurs the field on mousedown, before the click lands.
    fireEvent.blur(input);
    fireEvent.click(screen.getByText("outside"));

    expect(onChange).toHaveBeenCalledWith("owner", "Bob");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Edit properties" })).toBeInTheDocument();
  });

  it("stays in edit mode on a click inside the panel", async () => {
    renderPanel();
    await enterEditMode();
    fireEvent.click(screen.getByText("owner"));
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("leaves edit mode on Escape", async () => {
    renderPanel();
    await enterEditMode();
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
