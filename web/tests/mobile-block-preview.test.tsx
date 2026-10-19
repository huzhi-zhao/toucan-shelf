import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DocumentLinkProvider } from "@/components/MemoContent/DocumentLinkContext";
import GridPreview from "@/mobile/components/GridPreview";
import KanbanPreview from "@/mobile/components/KanbanPreview";

// The mobile reader's read-only kanban and grid blocks (mobile-phase3.md §4).

const KANBAN = `statusOrder: [todo, doing]
items:
  - { title: Write spec, status: todo, priority: high, owner: amy, link: ./spec.md }
  - { title: Ship it, status: doing, done: true }
  - { title: Loose end }`;

describe("KanbanPreview", () => {
  it("stacks the columns in board order with their counts", () => {
    render(<KanbanPreview content={KANBAN} />);
    const headings = screen.getAllByText(/^(todo|doing|未分组)$/).map((el) => el.textContent);
    expect(headings).toEqual(["todo", "doing", "未分组"]);
    expect(screen.getByText("高")).toBeInTheDocument();
  });

  it("shows a card's details, custom fields included, when tapped; the linked title opens the document", () => {
    const navigate = vi.fn();
    render(
      <DocumentLinkProvider value={{ resolve: (h) => (h === "./spec.md" ? "memos/spec" : undefined), navigate }}>
        <KanbanPreview content={KANBAN} />
      </DocumentLinkProvider>,
    );
    fireEvent.click(screen.getByText("Write spec"));
    expect(screen.getByText("owner")).toBeInTheDocument();
    expect(screen.getByText("amy")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Write spec" });
    fireEvent.click(link);
    expect(navigate).toHaveBeenCalledWith("memos/spec", "./spec.md");
  });

  it("has nothing to tick", () => {
    render(<KanbanPreview content={KANBAN} />);
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText(/添加/)).toBeNull();
  });

  it("says so when the board is empty", () => {
    render(<KanbanPreview content="items: []" />);
    expect(screen.getByText("看板里还没有卡片")).toBeInTheDocument();
  });
});

describe("GridPreview", () => {
  it("draws cover cards and opens a linked document through the reader", () => {
    const navigate = vi.fn();
    render(
      <DocumentLinkProvider value={{ resolve: (h) => (h === "/a.md" ? "memos/a" : undefined), navigate }}>
        <GridPreview content={"- title: A\n  cover: a.png\n  url: /a.md\n- title: B\n  url: https://example.com"} />
      </DocumentLinkProvider>,
    );
    fireEvent.click(screen.getByText("A"));
    expect(navigate).toHaveBeenCalledWith("memos/a", "/a.md");
    expect(screen.getByText("B").closest("a")).toHaveAttribute("target", "_blank");
    expect(document.querySelectorAll("img")).toHaveLength(1);
  });

  it("lays out text cards with the shared slots", () => {
    render(<GridPreview content={"- title: Flat\n  price: 4200\n  area: 60m2\n  date: 2026-10-19"} />);
    expect(screen.getByText("4200")).toBeInTheDocument();
    expect(screen.getByText("2026-10-19")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });

  it("draws a longbar grid as one list", () => {
    render(<GridPreview content={"style: longbar\n- title: One\n  subtitle: first\n- title: Two"} />);
    expect(screen.getByText("One")).toBeInTheDocument();
    expect(screen.getByText("first")).toBeInTheDocument();
    expect(screen.getByText("Two")).toBeInTheDocument();
  });
});
