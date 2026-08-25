import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { getRequestToken, refreshAccessToken } from "@/connect";
import { useAuth } from "@/contexts/AuthContext";
import { memoKeys } from "@/hooks/useMemoQueries";
import { userKeys } from "@/hooks/useUserQueries";

/**
 * Reconnection parameters for SSE connection.
 */
const INITIAL_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 30000;
const RETRY_BACKOFF_MULTIPLIER = 2;

const SSE_EVENT_TYPES = {
  memoCreated: "memo.created",
  memoUpdated: "memo.updated",
  memoDeleted: "memo.deleted",
  memoCommentCreated: "memo.comment.created",
  reactionUpserted: "reaction.upserted",
  reactionDeleted: "reaction.deleted",
} as const;

// ---------------------------------------------------------------------------
// Shared connection status store (singleton)
// ---------------------------------------------------------------------------

export type SSEConnectionStatus = "connected" | "disconnected" | "connecting";

type Listener = () => void;

let _status: SSEConnectionStatus = "disconnected";
const _listeners = new Set<Listener>();

function getSSEStatus(): SSEConnectionStatus {
  return _status;
}

function setSSEStatus(s: SSEConnectionStatus) {
  if (_status !== s) {
    _status = s;
    _listeners.forEach((l) => l());
  }
}

function subscribeSSEStatus(listener: Listener): () => void {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

/**
 * React hook that returns the current SSE connection status.
 * Re-renders the component whenever the status changes.
 */
export function useSSEConnectionStatus(): SSEConnectionStatus {
  return useSyncExternalStore(subscribeSSEStatus, getSSEStatus, getSSEStatus);
}

// ---------------------------------------------------------------------------
// Main hook
// ---------------------------------------------------------------------------

/**
 * The whole browser gets one SSE stream, not one per tab.
 *
 * The stream is a request that never ends, so in a browser it permanently
 * occupies one of the six HTTP/1.1 connections allowed per origin. Six open tabs
 * of the app used to hold six such streams — every ordinary request after that
 * queued behind them and never went out, which shows up as spinners that never
 * stop and a UI that looks frozen while the server sits idle.
 *
 * So one tab wins a Web Lock and holds the only stream; the others listen on a
 * BroadcastChannel and invalidate their own caches from what it relays. The lock
 * releases by itself when the holding tab is closed or crashes, and whichever
 * tab is waiting takes over — no heartbeat, no timeout, no stale leader.
 */
const LOCK_NAME_PREFIX = "toucanshelf-sse-leader:";
const CHANNEL_NAME_PREFIX = "toucanshelf-sse:";

/** What the tab holding the stream relays to the others. */
type ChannelMessage =
  | { kind: "event"; event: SSEChangeEvent }
  | { kind: "status"; status: SSEConnectionStatus }
  | { kind: "resync" }
  /** A tab that just mounted asking the holder for the current status. */
  | { kind: "hello" };

/**
 * useLiveMemoRefresh connects to the server's SSE endpoint and
 * invalidates relevant React Query caches when change events
 * (memos, reactions) are received.
 *
 * This enables real-time updates across all open instances of the app.
 */
export function useLiveMemoRefresh() {
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();
  const retryDelayRef = useRef(INITIAL_RETRY_DELAY_MS);
  const abortControllerRef = useRef<AbortController | null>(null);
  const hasConnectedOnceRef = useRef(false);

  const currentUserName = currentUser?.name;
  const handleEvent = useCallback((event: SSEChangeEvent) => handleSSEEvent(event, queryClient), [queryClient]);

  useEffect(() => {
    if (!currentUserName) {
      setSSEStatus("disconnected");
      return;
    }

    let mounted = true;
    // Whether this tab holds the stream. Only the holder connects, and only the
    // holder answers other tabs.
    let holdsStream = false;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let releaseLock: (() => void) | null = null;
    const electionAbort = new AbortController();

    // Keyed by user so switching accounts elects a fresh holder rather than
    // relaying one account's events into another's caches.
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL_NAME_PREFIX + currentUserName);
    const post = (message: ChannelMessage) => channel?.postMessage(message);

    // A BroadcastChannel never delivers to the tab that posted, so relaying is
    // free of any echo back into the holder.
    const publishStatus = (status: SSEConnectionStatus) => {
      setSSEStatus(status);
      if (holdsStream) post({ kind: "status", status });
    };

    const resync = () => {
      // Resync active collaborative views after reconnect because the server may have
      // dropped events while the client was disconnected or backpressured.
      queryClient.invalidateQueries({ queryKey: memoKeys.all, refetchType: "active" });
      queryClient.invalidateQueries({ queryKey: userKeys.stats(), refetchType: "active" });
    };

    if (channel) {
      channel.onmessage = (message: MessageEvent<ChannelMessage>) => {
        const payload = message.data;
        if (holdsStream) {
          // A tab mounted while this one already holds the stream: tell it where
          // the connection stands, or its indicator would sit on "connecting".
          if (payload.kind === "hello") post({ kind: "status", status: getSSEStatus() });
          return;
        }
        switch (payload.kind) {
          case "event":
            handleEvent(payload.event);
            break;
          case "status":
            setSSEStatus(payload.status);
            break;
          case "resync":
            resync();
            break;
          case "hello":
            break;
        }
      };
      post({ kind: "hello" });
    }

    const connect = async () => {
      if (!mounted) return;

      let token = await getRequestToken();
      if (!token) {
        publishStatus("disconnected");
        // Not logged in; do not retry. Effect will re-run when currentUser is set.
        return;
      }

      publishStatus("connecting");
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      try {
        let response = await fetchSSEStream(token, abortController.signal);

        if (response.status === 401) {
          await refreshAccessToken();
          token = await getRequestToken();
          if (!token) {
            throw new Error("SSE connection failed: missing token after refresh");
          }
          response = await fetchSSEStream(token, abortController.signal);
        }

        if (!response.ok || !response.body) {
          throw new Error(`SSE connection failed: ${response.status}`);
        }

        // Successfully connected - reset retry delay.
        retryDelayRef.current = INITIAL_RETRY_DELAY_MS;
        publishStatus("connected");
        if (hasConnectedOnceRef.current) {
          resync();
          post({ kind: "resync" });
        }
        hasConnectedOnceRef.current = true;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (mounted) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Process complete SSE messages (separated by double newlines).
          const messages = buffer.split("\n\n");
          // Keep the last incomplete chunk in the buffer.
          buffer = messages.pop() || "";

          for (const message of messages) {
            if (!message.trim()) continue;

            // Parse SSE format: lines starting with "data: " contain JSON payload.
            // Lines starting with ":" are comments (heartbeats).
            for (const line of message.split("\n")) {
              if (line.startsWith("data: ")) {
                const jsonStr = line.slice(6);
                try {
                  const event = JSON.parse(jsonStr) as SSEChangeEvent;
                  handleEvent(event);
                  post({ kind: "event", event });
                } catch {
                  // Ignore malformed JSON.
                }
              }
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") {
          // Intentional abort, don't reconnect.
          publishStatus("disconnected");
          return;
        }
        // Connection lost or failed - reconnect with backoff.
      }

      publishStatus("disconnected");

      // Reconnect with exponential backoff.
      if (mounted) {
        const delay = retryDelayRef.current;
        retryDelayRef.current = Math.min(delay * RETRY_BACKOFF_MULTIPLIER, MAX_RETRY_DELAY_MS);
        retryTimeout = setTimeout(connect, delay);
      }
    };

    // The lock is held for as long as this promise is pending — that is how a
    // Web Lock expresses "until this tab goes away".
    const holdStream = () =>
      new Promise<void>((resolve) => {
        releaseLock = resolve;
        if (!mounted) {
          resolve();
          return;
        }
        holdsStream = true;
        void connect();
      });

    if (navigator.locks) {
      navigator.locks.request(LOCK_NAME_PREFIX + currentUserName, { signal: electionAbort.signal }, holdStream).catch(() => {
        // Aborted because the tab unmounted while still waiting its turn. A tab
        // that never held the stream has nothing to clean up.
      });
    } else {
      // No Web Locks — an old browser, or the app reached over plain http on a
      // LAN address, since the API needs a secure context (localhost counts).
      // Fall back to the previous behaviour of one stream per tab rather than
      // leaving this tab with no live updates at all.
      void holdStream();
    }

    return () => {
      mounted = false;
      electionAbort.abort();
      setSSEStatus("disconnected");
      retryDelayRef.current = INITIAL_RETRY_DELAY_MS;
      if (retryTimeout) {
        clearTimeout(retryTimeout);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      // Releasing hands the stream to whichever tab is waiting for it.
      releaseLock?.();
      channel?.close();
    };
  }, [handleEvent, currentUserName, queryClient]);
}

// ---------------------------------------------------------------------------
// Event handling
// ---------------------------------------------------------------------------

function fetchSSEStream(token: string, signal: AbortSignal): Promise<Response> {
  return fetch("/api/v1/sse", {
    headers: {
      Accept: "text/event-stream",
      Authorization: `Bearer ${token}`,
    },
    signal,
    credentials: "include",
  });
}

/** One cross-reference the server rewrote automatically; mirrors SSELinkRepair in sse_hub.go. */
interface SSELinkRepair {
  oldHref: string;
  newHref: string;
  oldText: string;
  newText: string;
}

interface SSEChangeEvent {
  type: (typeof SSE_EVENT_TYPES)[keyof typeof SSE_EVENT_TYPES];
  name: string;
  parent?: string;
  /** Present only when this update was an automatic link repair, not a user edit. */
  linkRepairs?: SSELinkRepair[];
}

/**
 * Logs cross-reference repairs the server made to a document nobody edited: renaming or moving
 * document B silently rewrites the links in every document that points at B. That is invisible by
 * design in the UI, which makes "the repair didn't run" indistinguishable from "the repair ran and
 * this page is stale" — so the before/after of each rewritten link goes to the console.
 */
function logLinkRepairs(event: SSEChangeEvent) {
  if (!event.linkRepairs?.length) return;
  console.groupCollapsed(`[link-repair] ${event.name}: ${event.linkRepairs.length} 处引用已自动更新`);
  console.table(
    event.linkRepairs.map((r) => ({
      旧链接: r.oldHref,
      新链接: r.newHref,
      旧锚文本: r.oldText,
      新锚文本: r.newText,
      锚文本已改: r.oldText !== r.newText,
    })),
  );
  console.groupEnd();
}

function handleSSEEvent(event: SSEChangeEvent, queryClient: ReturnType<typeof useQueryClient>) {
  switch (event.type) {
    case SSE_EVENT_TYPES.memoCreated:
      queryClient.invalidateQueries({ queryKey: memoKeys.lists() });
      queryClient.invalidateQueries({ queryKey: userKeys.stats() });
      break;

    case SSE_EVENT_TYPES.memoUpdated:
      logLinkRepairs(event);
      queryClient.invalidateQueries({ queryKey: memoKeys.detail(event.name) });
      queryClient.invalidateQueries({ queryKey: memoKeys.lists() });
      if (event.parent) {
        queryClient.invalidateQueries({ queryKey: memoKeys.comments(event.parent) });
      }
      break;

    case SSE_EVENT_TYPES.memoDeleted:
      queryClient.removeQueries({ queryKey: memoKeys.detail(event.name) });
      queryClient.invalidateQueries({ queryKey: memoKeys.lists() });
      queryClient.invalidateQueries({ queryKey: userKeys.stats() });
      break;

    case SSE_EVENT_TYPES.memoCommentCreated:
      queryClient.invalidateQueries({ queryKey: memoKeys.comments(event.name) });
      queryClient.invalidateQueries({ queryKey: memoKeys.detail(event.name) });
      break;

    case SSE_EVENT_TYPES.reactionUpserted:
    case SSE_EVENT_TYPES.reactionDeleted:
      queryClient.invalidateQueries({ queryKey: memoKeys.detail(event.name) });
      queryClient.invalidateQueries({ queryKey: memoKeys.lists() });
      if (event.parent) {
        queryClient.invalidateQueries({ queryKey: memoKeys.comments(event.parent) });
      }
      break;
  }
}
