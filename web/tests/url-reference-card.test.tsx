import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import UrlReferenceCard from "@/components/MemoMetadata/Reference/UrlReferenceCard";

const metadata = vi.hoisted(() => ({ current: undefined as { title: string; favicon: string } | undefined }));
vi.mock("@/hooks/useMemoQueries", () => ({ useLinkMetadata: () => ({ data: metadata.current }) }));

const url = "https://docs.google.com/spreadsheets/d/abc";

describe("<UrlReferenceCard>", () => {
  it("heads the card with the note, then the page title and host", async () => {
    metadata.current = { title: "Monthly Living Expenses In Canada", favicon: "" };
    render(<UrlReferenceCard reference={{ url, note: "Open before changing the budget" }} />);
    expect(await screen.findByText("Open before changing the budget")).toHaveClass("font-medium");
    expect(screen.getByText("Monthly Living Expenses In Canada · docs.google.com")).toBeInTheDocument();
  });

  it("falls back to the page title as heading when there is no note", async () => {
    metadata.current = { title: "Monthly Living Expenses In Canada", favicon: "" };
    render(<UrlReferenceCard reference={{ url, note: "" }} />);
    expect(await screen.findByText("Monthly Living Expenses In Canada")).toHaveClass("font-medium");
    expect(screen.getByText("docs.google.com")).toBeInTheDocument();
  });

  it("falls back to the host when the page gave no title", async () => {
    metadata.current = undefined;
    render(<UrlReferenceCard reference={{ url, note: "Open before changing the budget" }} />);
    expect(await screen.findByText("Open before changing the budget")).toBeInTheDocument();
    expect(screen.getByText("docs.google.com")).toBeInTheDocument();
  });
});
