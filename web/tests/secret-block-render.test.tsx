import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SecretBlock } from "@/components/MemoContent/SecretBlock";
import { extractLanguage } from "@/components/MemoContent/utils";
import { encryptSecret } from "@/utils/secret-crypto";

vi.mock("@/utils/i18n", () => ({ useTranslate: () => (key: string) => key }));

const mockAuth = vi.hoisted(() => ({ currentUser: undefined as unknown }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => mockAuth }));

// Nothing here should reach the network: every case under test is decided before
// a fetch would happen.
const client = vi.hoisted(() => ({
  getSecretBlock: vi.fn(() => Promise.reject(new Error("must not be called"))),
  createSecretBlock: vi.fn(() => Promise.reject(new Error("must not be called"))),
  updateSecretBlock: vi.fn(() => Promise.reject(new Error("must not be called"))),
}));
vi.mock("@/connect", () => ({ secretBlockServiceClient: client }));

// The block reaches for the document it lives in so it can write an id back; these
// tests never get that far.
const blockSource = vi.hoisted(() => ({ source: "", readonly: false, save: vi.fn() }));
vi.mock("@/components/MemoContent/BlockSourceContext", () => ({ useBlockSource: () => blockSource }));

// react-markdown hands CodeBlock a <code> element, not a bare string.
const codeChild = (body: string) => <code className="language-toucan-secret">{body}</code>;

describe("extractLanguage", () => {
  // `toucan-secret` used to come back as `toucan`, so the block never dispatched.
  it("keeps hyphens in the language identifier", () => {
    expect(extractLanguage("language-toucan-secret")).toBe("toucan-secret");
    expect(extractLanguage("language-objective-c")).toBe("objective-c");
    expect(extractLanguage("language-mermaid")).toBe("mermaid");
    expect(extractLanguage("no-language-here")).toBe("here");
  });
});

describe("SecretBlock", () => {
  it("offers unlock for an initialized reference", () => {
    mockAuth.currentUser = { id: 1 };
    render(<SecretBlock>{codeChild("v: 1\nid: abc123")}</SecretBlock>);
    expect(screen.getByText("secret-block.locked")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /secret-block.unlock/ })).toBeInTheDocument();
    // No confirmation field: this block already has a passphrase.
    expect(screen.queryByLabelText("secret-block.create.passphrase-confirm")).not.toBeInTheDocument();
  });

  // A local id means the block was inserted but never set up, so the action is to
  // choose a passphrase — no lookup needed to know that.
  it("offers passphrase setup for an uninitialized (local) reference", () => {
    mockAuth.currentUser = { id: 1 };
    render(<SecretBlock>{codeChild("v: 1\nid: local-deadbeef")}</SecretBlock>);
    expect(screen.getByRole("button", { name: /secret-block.set-passphrase/ })).toBeInTheDocument();
    expect(screen.getByLabelText("secret-block.create.passphrase-confirm")).toBeInTheDocument();
    expect(screen.getByLabelText("secret-block.hint-placeholder")).toBeInTheDocument();
  });

  // The hint is the card's title: it is what tells a reader what the block is for,
  // both here and in the raw markdown.
  it("uses the hint as the card title", () => {
    mockAuth.currentUser = { id: 1 };
    render(<SecretBlock>{codeChild("v: 1\nid: abc123\nhint: MinIO 安装过程")}</SecretBlock>);
    expect(screen.getByText("MinIO 安装过程")).toBeInTheDocument();
    expect(screen.queryByText("secret-block.locked")).not.toBeInTheDocument();
  });

  it("reports a malformed block instead of offering a passphrase", () => {
    mockAuth.currentUser = { id: 1 };
    render(<SecretBlock>{codeChild("v: 1\nid: not a valid id")}</SecretBlock>);
    expect(screen.getByText("secret-block.malformed")).toBeInTheDocument();
    expect(screen.queryByLabelText("secret-block.passphrase-placeholder")).not.toBeInTheDocument();
  });

  // Anonymous readers of a publicly shared document must not be offered the unlock
  // form at all: the ciphertext is never served to them, so a passphrase box would
  // only invite pointless guessing.
  it("asks an anonymous reader to sign in and offers no passphrase field", () => {
    mockAuth.currentUser = undefined;
    render(<SecretBlock>{codeChild("v: 1\nid: abc123")}</SecretBlock>);
    expect(screen.getByText("secret-block.sign-in-required")).toBeInTheDocument();
    expect(screen.queryByLabelText("secret-block.passphrase-placeholder")).not.toBeInTheDocument();
  });
});

// One end-to-end pass through unlock, using the real crypto at the supported floor
// so the round trip is genuine rather than stubbed.
describe("SecretBlock unlock", () => {
  it("decrypts and then offers edit, copy and passphrase rotation", async () => {
    mockAuth.currentUser = { id: 1 };
    const envelope = await encryptSecret("s3cr3t-value", "open sesame", { iterations: 100_000 });
    client.getSecretBlock.mockResolvedValueOnce({ name: "secretBlocks/abc123", hint: "MinIO", envelope } as never);

    render(<SecretBlock>{codeChild("v: 1\nid: abc123\nhint: MinIO")}</SecretBlock>);
    fireEvent.change(screen.getByLabelText("secret-block.passphrase-placeholder"), { target: { value: "open sesame" } });
    fireEvent.click(screen.getByRole("button", { name: /secret-block.unlock/ }));

    await waitFor(() => expect(screen.getByText("s3cr3t-value")).toBeInTheDocument());
    expect(screen.getByLabelText("secret-block.edit")).toBeInTheDocument();
    expect(screen.getByLabelText("secret-block.change-passphrase")).toBeInTheDocument();

    // Rotation asks for the new passphrase twice, like initial setup: there is no
    // recovery, so a typo here would lock the owner out of their own content.
    fireEvent.click(screen.getByLabelText("secret-block.change-passphrase"));
    expect(screen.getByLabelText("secret-block.new-passphrase")).toBeInTheDocument();
    expect(screen.getByLabelText("secret-block.create.passphrase-confirm")).toBeInTheDocument();
  }, 20_000);

  it("reports a wrong passphrase without opening", async () => {
    mockAuth.currentUser = { id: 1 };
    const envelope = await encryptSecret("s3cr3t-value", "open sesame", { iterations: 100_000 });
    client.getSecretBlock.mockResolvedValueOnce({ name: "secretBlocks/abc123", hint: "", envelope } as never);

    render(<SecretBlock>{codeChild("v: 1\nid: abc123")}</SecretBlock>);
    fireEvent.change(screen.getByLabelText("secret-block.passphrase-placeholder"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: /secret-block.unlock/ }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("secret-block.error.wrong-passphrase"));
    expect(screen.queryByText("s3cr3t-value")).not.toBeInTheDocument();
  }, 20_000);
});
