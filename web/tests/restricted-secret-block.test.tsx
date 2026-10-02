import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SecretBlock } from "@/components/MemoContent/SecretBlock";
import {
  SecretBlockPolicy_Preset,
  SecretBlockPolicySchema,
  SecretBlockRestriction_UnlockState,
  SecretBlockRestrictionSchema,
  type SecretBlockSummary,
  SecretBlockSummarySchema,
} from "@/types/proto/api/v1/secret_block_service_pb";
import { encryptWithMasterKey, generateMasterKey, type MasterKey } from "@/utils/secret-crypto";

vi.mock("@/utils/i18n", () => ({
  useTranslate: () => (key: string) => key,
  findNearestMatchedLanguage: (lang: string) => lang,
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "zh-Hans" } }) }));

const mockAuth = vi.hoisted(() => ({ currentUser: { id: 1 } as unknown }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => mockAuth, useSoftBreakDefault: () => false }));

const client = vi.hoisted(() => ({
  getSecretBlock: vi.fn(),
  createSecretBlock: vi.fn(),
  updateSecretBlock: vi.fn(),
  getSecretBlockSummary: vi.fn(),
  requestSecretBlockUnlock: vi.fn(),
  cancelSecretBlockUnlock: vi.fn(),
  updateSecretBlockPolicy: vi.fn(),
  cancelSecretBlockPolicyChange: vi.fn(),
}));
vi.mock("@/connect", () => ({ secretBlockServiceClient: client }));

const blockSource = vi.hoisted(() => ({ source: "", readonly: false, save: vi.fn() }));
vi.mock("@/components/MemoContent/BlockSourceContext", () => ({ useBlockSource: () => blockSource }));

const session = vi.hoisted(() => ({ key: null as Uint8Array | null }));
vi.mock("@/utils/secret-session", () => ({ getSecretMasterKey: () => session.key, lockSecretSession: () => undefined }));
vi.mock("@/hooks/useSecretMasterKey", () => ({
  useSecretMasterKey: () => ({
    loading: false,
    configured: true,
    unlocked: session.key !== null,
    unlock: vi.fn(),
    lock: vi.fn(),
    setup: vi.fn(),
    changePassphrase: vi.fn(),
    reset: vi.fn(),
  }),
}));

const CONFIRM = "我已想清楚，明早再处理也来得及";
const PROMPT = "真的必须现在吗";
const SECRET = "Zx9-admin-PW";

const restrictedSummary = (state: SecretBlockRestriction_UnlockState, extra: Record<string, unknown> = {}): SecretBlockSummary =>
  create(SecretBlockSummarySchema, {
    name: "secretBlocks/abc123",
    hint: "Mac admin",
    restriction: create(SecretBlockRestrictionSchema, {
      policy: create(SecretBlockPolicySchema, {
        preset: SecretBlockPolicy_Preset.HIGH_IMPACT,
        timeZone: "Asia/Shanghai",
        prompt: PROMPT,
        confirmText: CONFIRM,
        viewSeconds: 600,
        emergencyQuota: 1,
      }),
      unlockState: state,
      emergencyRemaining: 1,
      ...extra,
    }),
  });

const renderBlock = (body: string) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <SecretBlock>
          <code className="language-toucan-secret">{body}</code>
        </SecretBlock>
      </MemoryRouter>
    </QueryClientProvider>,
  );

let masterKey: MasterKey;

beforeEach(() => {
  masterKey = generateMasterKey();
  session.key = masterKey;
  for (const fn of Object.values(client)) fn.mockReset();
  blockSource.save.mockReset();
});

describe("restricted secret block", () => {
  // The whole design rests on this: the envelope fetch is what the server gates,
  // and for a restricted block it starts the viewing window. Rendering, opening
  // the request form, and requesting must never fetch it.
  it("renders the restricted card from the summary and never fetches the envelope while locked", async () => {
    client.getSecretBlockSummary.mockResolvedValue(restrictedSummary(SecretBlockRestriction_UnlockState.LOCKED));
    renderBlock("v: 1\nid: abc123\nhint: Mac admin");

    await waitFor(() => expect(screen.getByText("secret-block.restricted.locked")).toBeInTheDocument());
    expect(screen.getByText("secret-block.restricted.badge-high")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "secret-block.restricted.request" }));
    expect(client.getSecretBlock).not.toHaveBeenCalled();
  });

  it("draws the prompt and confirmation text on canvas, never as DOM text", async () => {
    client.getSecretBlockSummary.mockResolvedValue(restrictedSummary(SecretBlockRestriction_UnlockState.LOCKED));
    const { container } = renderBlock("v: 1\nid: abc123");
    await waitFor(() => screen.getByRole("button", { name: "secret-block.restricted.request" }));
    fireEvent.click(screen.getByRole("button", { name: "secret-block.restricted.request" }));

    expect(container.textContent).not.toContain(CONFIRM);
    expect(container.textContent).not.toContain(PROMPT);
    expect(container.querySelectorAll("canvas").length).toBeGreaterThanOrEqual(2);
  });

  it("only submits a hand-typed, matching confirmation", async () => {
    client.getSecretBlockSummary.mockResolvedValue(restrictedSummary(SecretBlockRestriction_UnlockState.LOCKED));
    client.requestSecretBlockUnlock.mockResolvedValue(
      restrictedSummary(SecretBlockRestriction_UnlockState.PENDING, { availableTime: timestampFromDate(new Date("2026-10-03T00:00:00Z")) }),
    );
    renderBlock("v: 1\nid: abc123");
    await waitFor(() => screen.getByRole("button", { name: "secret-block.restricted.request" }));
    fireEvent.click(screen.getByRole("button", { name: "secret-block.restricted.request" }));

    const input = screen.getByLabelText("secret-block.restricted.confirm-instruction");
    const submit = screen.getByRole("button", { name: "secret-block.restricted.submit-request" });

    // Pasting is refused.
    const paste = createEvent.paste(input);
    fireEvent(input, paste);
    expect(paste.defaultPrevented).toBe(true);

    fireEvent.change(input, { target: { value: "我已想清楚" } });
    expect(submit).toBeDisabled();
    fireEvent.change(input, { target: { value: CONFIRM } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() =>
      expect(client.requestSecretBlockUnlock).toHaveBeenCalledWith(
        expect.objectContaining({ name: "secretBlocks/abc123", confirmText: CONFIRM, emergency: false }),
      ),
    );
    await waitFor(() => expect(screen.getByText("secret-block.restricted.pending")).toBeInTheDocument());
    expect(client.getSecretBlock).not.toHaveBeenCalled();
  });

  it("requires the emergency statement and a reason for an emergency unlock", async () => {
    client.getSecretBlockSummary.mockResolvedValue(restrictedSummary(SecretBlockRestriction_UnlockState.LOCKED));
    client.requestSecretBlockUnlock.mockResolvedValue(restrictedSummary(SecretBlockRestriction_UnlockState.READY));
    renderBlock("v: 1\nid: abc123");
    await waitFor(() => screen.getByRole("button", { name: /secret-block.restricted.emergency$/ }));
    fireEvent.click(screen.getByRole("button", { name: /secret-block.restricted.emergency$/ }));

    const submit = screen.getByRole("button", { name: "secret-block.restricted.emergency-submit" });
    fireEvent.change(screen.getByLabelText("secret-block.restricted.confirm-instruction"), { target: { value: CONFIRM } });
    fireEvent.change(screen.getByLabelText("secret-block.restricted.emergency-statement"), {
      target: { value: "我确认这件事现在必须处理，不能等到明天" },
    });
    fireEvent.change(screen.getByLabelText("secret-block.restricted.emergency-reason"), { target: { value: "太急了" } });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("secret-block.restricted.emergency-reason"), {
      target: { value: "线上服务挂了需要管理员权限重启" },
    });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() =>
      expect(client.requestSecretBlockUnlock).toHaveBeenCalledWith(
        expect.objectContaining({
          emergency: true,
          emergencyText: "我确认这件事现在必须处理，不能等到明天",
          emergencyReason: "线上服务挂了需要管理员权限重启",
        }),
      ),
    );
  });

  it("shows an opened secret only as press-to-reveal canvas segments", async () => {
    const expire = timestampFromDate(new Date(Date.now() + 10 * 60 * 1000));
    client.getSecretBlockSummary.mockResolvedValue(restrictedSummary(SecretBlockRestriction_UnlockState.READY, { expireTime: expire }));
    client.getSecretBlock.mockResolvedValue({
      name: "secretBlocks/abc123",
      hint: "Mac admin",
      envelope: await encryptWithMasterKey(SECRET, masterKey),
      restriction: restrictedSummary(SecretBlockRestriction_UnlockState.OPEN, { expireTime: expire }).restriction,
    });
    const { container } = renderBlock("v: 1\nid: abc123");
    await waitFor(() => screen.getByRole("button", { name: "secret-block.restricted.view" }));
    fireEvent.click(screen.getByRole("button", { name: "secret-block.restricted.view" }));

    // "Zx9-admin-PW" is 12 characters: three segments of four.
    await waitFor(() => expect(screen.getAllByRole("button", { name: "secret-block.restricted.segment" })).toHaveLength(3));
    expect(client.getSecretBlock).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain(SECRET);
    expect(container.textContent).not.toContain("Zx9-");

    const copy = createEvent.copy(container.firstElementChild as Element);
    fireEvent(container.firstElementChild as Element, copy);
    expect(copy.defaultPrevented).toBe(true);
  });

  // Replacing never shows the old content, so it needs no unlock and never
  // fetches the envelope.
  it("replaces content without fetching the old envelope", async () => {
    client.getSecretBlockSummary.mockResolvedValue(restrictedSummary(SecretBlockRestriction_UnlockState.LOCKED));
    client.updateSecretBlock.mockImplementation(async ({ secretBlock }) => ({
      ...secretBlock,
      restriction: restrictedSummary(SecretBlockRestriction_UnlockState.LOCKED).restriction,
    }));
    renderBlock("v: 1\nid: abc123");
    await waitFor(() => screen.getByRole("button", { name: "secret-block.restricted.replace" }));
    fireEvent.click(screen.getByRole("button", { name: "secret-block.restricted.replace" }));
    fireEvent.change(screen.getByPlaceholderText("secret-block.restricted.content-placeholder"), { target: { value: "new-password" } });
    fireEvent.click(screen.getByRole("button", { name: "secret-block.restricted.replace-save" }));

    await waitFor(() => expect(client.updateSecretBlock).toHaveBeenCalledTimes(1));
    expect(client.getSecretBlock).not.toHaveBeenCalled();
  });

  // If the reader clicks Unlock before the summary has arrived, the ordinary card
  // must ask first rather than fetch: for a restricted block that fetch would
  // spend the viewing window.
  it("checks restriction before the ordinary unlock fetches an envelope", async () => {
    client.getSecretBlockSummary
      .mockImplementationOnce(() => new Promise(() => undefined))
      .mockResolvedValue(restrictedSummary(SecretBlockRestriction_UnlockState.READY));
    renderBlock("v: 1\nid: abc123");
    fireEvent.click(screen.getByRole("button", { name: /secret-block.unlock/ }));

    await waitFor(() => expect(screen.getByRole("button", { name: "secret-block.restricted.view" })).toBeInTheDocument());
    expect(client.getSecretBlock).not.toHaveBeenCalled();
  });
});

describe("creating a restricted secret block", () => {
  it("preselects restricted mode for a block inserted from the restricted menu item", () => {
    client.getSecretBlockSummary.mockResolvedValue(undefined);
    renderBlock("v: 1\nid: local-r-0011223344556677");
    expect(screen.getByLabelText("secret-block.restricted.confirm-text-placeholder")).toBeInTheDocument();
    expect(screen.getByText("secret-block.restricted.offline-backup")).toBeInTheDocument();
  });

  it("creates the record with its policy and content, and does not show the secret afterwards", async () => {
    blockSource.source = "```toucan-secret\nv: 1\nid: local-r-0011223344556677\n```";
    client.createSecretBlock.mockImplementation(async ({ secretBlock }) => ({
      name: "secretBlocks/newuid",
      hint: secretBlock.hint,
      envelope: secretBlock.envelope,
      restriction: restrictedSummary(SecretBlockRestriction_UnlockState.LOCKED).restriction,
    }));
    renderBlock("v: 1\nid: local-r-0011223344556677");

    const createButton = screen.getByRole("button", { name: /secret-block.create-block/ });
    fireEvent.change(screen.getByLabelText("secret-block.hint-placeholder"), { target: { value: "Mac admin" } });
    fireEvent.change(screen.getByLabelText("secret-block.restricted.confirm-text-placeholder"), { target: { value: CONFIRM } });
    fireEvent.change(screen.getByLabelText("secret-block.restricted.content-placeholder"), { target: { value: SECRET } });
    // High impact cannot be created without acknowledging an offline copy.
    expect(createButton).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(createButton).toBeEnabled();
    fireEvent.click(createButton);

    await waitFor(() => expect(client.createSecretBlock).toHaveBeenCalledTimes(1));
    const request = client.createSecretBlock.mock.calls[0][0];
    expect(request.policy).toMatchObject({ preset: SecretBlockPolicy_Preset.HIGH_IMPACT, confirmText: CONFIRM });
    expect(request.policy.timeZone).toBeTruthy();
    expect(request.secretBlock.envelope.ciphertext).not.toContain(SECRET);
    expect(blockSource.save).toHaveBeenCalledWith(expect.stringContaining("id: newuid"));
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument();
  });
});
