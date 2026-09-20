import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ReferenceListView from "@/components/MemoMetadata/Reference/ReferenceListView";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";

vi.mock("@/utils/i18n", () => ({ useTranslate: () => (key: string) => key }));

const subDoc = (name: string, title: string) => ({ name, title, content: "body" }) as Memo;

// Whether the References section appears on an empty document is decided by
// whether there is anything to do in it. Getting this wrong is invisible in the
// common case and fatal in the empty one: a self-hiding editor block makes the
// FIRST sub-document impossible to create, since its section is the only place
// the create controls live.
describe("<ReferenceListView> empty state", () => {
  it("renders nothing for a reader when there are no sub-documents", () => {
    const { container } = render(<ReferenceListView subDocs={[]} parentMemoName="memos/p1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("still renders for a writer when there are no sub-documents", () => {
    render(<ReferenceListView subDocs={[]} parentMemoName="memos/p1" actions={<button type="button">add</button>} />);
    expect(screen.getByRole("button", { name: "add" })).toBeInTheDocument();
  });

  it("lists sub-documents for a reader once there are any", () => {
    render(<ReferenceListView subDocs={[subDoc("memos/s1", "Appendix")]} parentMemoName="memos/p1" />);
    expect(screen.getByText("Appendix")).toBeInTheDocument();
  });

  it("opens an entry in a new tab rather than navigating in place", () => {
    render(<ReferenceListView subDocs={[subDoc("memos/s1", "Appendix")]} parentMemoName="memos/p1" />);
    const link = screen.getByRole("link", { name: /Appendix/ });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("href", "/memos/s1");
  });
});
