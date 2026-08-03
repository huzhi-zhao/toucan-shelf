import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SecretBlock } from "@/components/MemoContent/SecretBlock";
import { extractLanguage } from "@/components/MemoContent/utils";
import { encryptSecret, encryptWithMasterKey, generateMasterKey, type MasterKey } from "@/utils/secret-crypto";

vi.mock("@/utils/i18n", () => ({
  useTranslate: () => (key: string) => key,
  // src/i18n.ts pulls this in at import time; without it the i18next backend
  // throws before any test body runs.
  findNearestMatchedLanguage: (lang: string) => lang,
}));

const mockAuth = vi.hoisted(() => ({ currentUser: undefined as unknown }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => mockAuth }));

// Nothing here should reach the network unless a test says so: every other case is
// decided before a fetch would happen.
const client = vi.hoisted(() => ({
  getSecretBlock: vi.fn(() => Promise.reject(new Error("must not be called"))),
  createSecretBlock: vi.fn(() => Promise.reject(new Error("must not be called"))),
  updateSecretBlock: vi.fn(() => Promise.reject(new Error("must not be called"))),
}));
vi.mock("@/connect", () => ({ secretBlockServiceClient: client }));

// The block reaches for the document it lives in so it can write an id back; most
// of these tests never get that far.
const blockSource = vi.hoisted(() => ({ source: "", readonly: false, save: vi.fn() }));
vi.mock("@/components/MemoContent/BlockSourceContext", () => ({ useBlockSource: () => blockSource }));

// The master key session, stubbed as a plain holder. Its real implementation is a
// module-level closure plus a react-query read of the user setting; neither is what
// these tests are about, and both would drag a QueryClientProvider in with them.
const session = vi.hoisted(() => ({
  key: null as Uint8Array | null,
  configured: true,
  unlock: vi.fn(),
}));
vi.mock("@/utils/secret-session", () => ({
  getSecretMasterKey: () => session.key,
  lockSecretSession: () => {
    session.key = null;
  },
}));
vi.mock("@/hooks/useSecretMasterKey", () => ({
  useSecretMasterKey: () => ({
    loading: false,
    configured: session.configured,
    unlocked: session.key !== null,
    unlock: session.unlock,
    lock: vi.fn(),
    setup: vi.fn(),
    changePassphrase: vi.fn(),
    reset: vi.fn(),
  }),
}));

// react-markdown hands CodeBlock a <code> element, not a bare string.
const codeChild = (body: string) => <code className="language-toucan-secret">{body}</code>;

const renderBlock = (body: string) =>
  render(
    <MemoryRouter>
      <SecretBlock>{codeChild(body)}</SecretBlock>
    </MemoryRouter>,
  );

let masterKey: MasterKey;

beforeEach(() => {
  masterKey = generateMasterKey();
  session.key = masterKey;
  session.configured = true;
  session.unlock.mockReset();
  client.getSecretBlock.mockReset();
  client.createSecretBlock.mockReset();
  client.updateSecretBlock.mockReset();
});

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
  // The whole point of the master key: with the session already unlocked there is
  // nothing to type, and the card must not imply otherwise.
  it("offers a bare unlock button, with no passphrase field, for an initialized reference", () => {
    mockAuth.currentUser = { id: 1 };
    renderBlock("v: 1\nid: abc123");
    expect(screen.getByText("secret-block.locked")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /secret-block.unlock/ })).toBeInTheDocument();
    expect(screen.queryByLabelText("secret-block.master-passphrase-placeholder")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("secret-block.legacy-passphrase-placeholder")).not.toBeInTheDocument();
  });

  // A local id means the block was inserted but never set up. Setting it up is now
  // just naming it — the key already exists at the account level.
  it("asks only for a label when creating an uninitialized (local) block", () => {
    mockAuth.currentUser = { id: 1 };
    renderBlock("v: 1\nid: local-deadbeef");
    expect(screen.getByRole("button", { name: /secret-block.create-block/ })).toBeInTheDocument();
    expect(screen.getByLabelText("secret-block.hint-placeholder")).toBeInTheDocument();
    expect(screen.queryByLabelText("secret-block.master-passphrase-placeholder")).not.toBeInTheDocument();
  });

  // Creating a block before there is a key to encrypt it with would produce
  // something unopenable, so the card sends the user to set one instead.
  it("points at settings when no master passphrase has been configured", () => {
    mockAuth.currentUser = { id: 1 };
    session.configured = false;
    session.key = null;
    renderBlock("v: 1\nid: local-deadbeef");
    expect(screen.getByText("secret-block.no-master-key")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /secret-block.create-block/ })).not.toBeInTheDocument();
  });

  // A locked session still lets the block be created — the passphrase field is the
  // way through, not a dead end.
  it("asks for the master passphrase when creating with the session locked", () => {
    mockAuth.currentUser = { id: 1 };
    session.key = null;
    renderBlock("v: 1\nid: local-deadbeef");
    expect(screen.getByLabelText("secret-block.master-passphrase-placeholder")).toBeInTheDocument();
    expect(screen.getByLabelText("secret-block.hint-placeholder")).toBeInTheDocument();
  });

  // The hint is the card's title: it is what tells a reader what the block is for,
  // both here and in the raw markdown.
  it("uses the hint as the card title", () => {
    mockAuth.currentUser = { id: 1 };
    renderBlock("v: 1\nid: abc123\nhint: MinIO 安装过程");
    expect(screen.getByText("MinIO 安装过程")).toBeInTheDocument();
    expect(screen.queryByText("secret-block.locked")).not.toBeInTheDocument();
  });

  it("reports a malformed block instead of offering a passphrase", () => {
    mockAuth.currentUser = { id: 1 };
    renderBlock("v: 1\nid: not a valid id");
    expect(screen.getByText("secret-block.malformed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /secret-block.unlock/ })).not.toBeInTheDocument();
  });

  // Anonymous readers of a publicly shared document must not be offered the unlock
  // form at all: the ciphertext is never served to them, so a passphrase box would
  // only invite pointless guessing.
  it("asks an anonymous reader to sign in and offers no passphrase field", () => {
    mockAuth.currentUser = undefined;
    renderBlock("v: 1\nid: abc123");
    expect(screen.getByText("secret-block.sign-in-required")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /secret-block.unlock/ })).not.toBeInTheDocument();
  });
});

// End-to-end passes through unlock, using the real crypto so the round trips are
// genuine rather than stubbed.
describe("SecretBlock unlock", () => {
  it("opens a master block in one click when the session is unlocked", async () => {
    mockAuth.currentUser = { id: 1 };
    const envelope = await encryptWithMasterKey("s3cr3t-value", masterKey);
    client.getSecretBlock.mockResolvedValueOnce({ name: "secretBlocks/abc123", hint: "MinIO", envelope } as never);

    renderBlock("v: 1\nid: abc123\nhint: MinIO");
    fireEvent.click(screen.getByRole("button", { name: /secret-block.unlock/ }));

    await waitFor(() => expect(screen.getByText("s3cr3t-value")).toBeInTheDocument());
    expect(screen.getByLabelText("secret-block.edit")).toBeInTheDocument();
    // A master block has no passphrase of its own to rotate; that lives in settings.
    expect(screen.queryByLabelText("secret-block.change-passphrase")).not.toBeInTheDocument();
  });

  // The card cannot know which passphrase to ask for until it has seen the
  // envelope, so the first click is what makes the field appear.
  it("asks for the master passphrase only after learning the block needs one", async () => {
    mockAuth.currentUser = { id: 1 };
    session.key = null;
    const envelope = await encryptWithMasterKey("s3cr3t-value", masterKey);
    client.getSecretBlock.mockResolvedValue({ name: "secretBlocks/abc123", hint: "", envelope } as never);
    session.unlock.mockImplementation(async () => {
      session.key = masterKey;
    });

    renderBlock("v: 1\nid: abc123");
    expect(screen.queryByLabelText("secret-block.master-passphrase-placeholder")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /secret-block.unlock/ }));
    await waitFor(() => expect(screen.getByLabelText("secret-block.master-passphrase-placeholder")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("secret-block.master-passphrase-placeholder"), { target: { value: "correct horse battery" } });
    fireEvent.click(screen.getByRole("button", { name: /secret-block.unlock/ }));

    await waitFor(() => expect(screen.getByText("s3cr3t-value")).toBeInTheDocument());
    expect(session.unlock).toHaveBeenCalledWith("correct horse battery");
  });

  // Blocks written before the master key existed keep working untouched, and are
  // the only ones that still show a per-block rotation control.
  it("falls back to the block's own passphrase for a legacy envelope", async () => {
    mockAuth.currentUser = { id: 1 };
    const envelope = await encryptSecret("s3cr3t-value", "open sesame", { iterations: 100_000 });
    client.getSecretBlock.mockResolvedValue({ name: "secretBlocks/abc123", hint: "", envelope } as never);

    renderBlock("v: 1\nid: abc123");
    fireEvent.click(screen.getByRole("button", { name: /secret-block.unlock/ }));
    await waitFor(() => expect(screen.getByLabelText("secret-block.legacy-passphrase-placeholder")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("secret-block.legacy-passphrase-placeholder"), { target: { value: "open sesame" } });
    fireEvent.click(screen.getByRole("button", { name: /secret-block.unlock/ }));

    await waitFor(() => expect(screen.getByText("s3cr3t-value")).toBeInTheDocument());
    expect(screen.getByLabelText("secret-block.change-passphrase")).toBeInTheDocument();
    // With the session unlocked, the migration offer is live rather than advisory.
    expect(screen.getByRole("button", { name: /secret-block.migrate/ })).toBeEnabled();
  }, 20_000);

  it("reports a wrong passphrase without opening", async () => {
    mockAuth.currentUser = { id: 1 };
    const envelope = await encryptSecret("s3cr3t-value", "open sesame", { iterations: 100_000 });
    client.getSecretBlock.mockResolvedValue({ name: "secretBlocks/abc123", hint: "", envelope } as never);

    renderBlock("v: 1\nid: abc123");
    fireEvent.click(screen.getByRole("button", { name: /secret-block.unlock/ }));
    await waitFor(() => expect(screen.getByLabelText("secret-block.legacy-passphrase-placeholder")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("secret-block.legacy-passphrase-placeholder"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: /secret-block.unlock/ }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("secret-block.error.wrong-passphrase"));
    expect(screen.queryByText("s3cr3t-value")).not.toBeInTheDocument();
  }, 20_000);

  // Migration is what makes "keep the old blocks" a transitional state rather than
  // a permanent second mode. It must overwrite the record, not add one.
  it("re-encrypts a legacy block against the master key on migration", async () => {
    mockAuth.currentUser = { id: 1 };
    const envelope = await encryptSecret("s3cr3t-value", "open sesame", { iterations: 100_000 });
    client.getSecretBlock.mockResolvedValue({ name: "secretBlocks/abc123", hint: "", envelope } as never);
    client.updateSecretBlock.mockResolvedValue({} as never);

    renderBlock("v: 1\nid: abc123");
    fireEvent.click(screen.getByRole("button", { name: /secret-block.unlock/ }));
    await waitFor(() => expect(screen.getByLabelText("secret-block.legacy-passphrase-placeholder")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("secret-block.legacy-passphrase-placeholder"), { target: { value: "open sesame" } });
    fireEvent.click(screen.getByRole("button", { name: /secret-block.unlock/ }));
    await waitFor(() => expect(screen.getByText("s3cr3t-value")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /secret-block.migrate/ }));

    await waitFor(() => expect(client.updateSecretBlock).toHaveBeenCalledTimes(1));
    const written = client.updateSecretBlock.mock.calls[0][0] as unknown as {
      secretBlock: { name: string; envelope: { kdf: string } };
    };
    expect(written.secretBlock.name).toBe("secretBlocks/abc123");
    expect(written.secretBlock.envelope.kdf).toBe("master-v1");
    // The rotation control goes away with the passphrase it rotated.
    await waitFor(() => expect(screen.queryByLabelText("secret-block.change-passphrase")).not.toBeInTheDocument());
  }, 20_000);
});
