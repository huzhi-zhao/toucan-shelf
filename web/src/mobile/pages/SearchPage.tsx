import { useQuery } from "@tanstack/react-query";
import { List, ListItem, Navbar, Page, Preloader, Searchbar } from "konsta/react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ragServiceClient } from "@/connect";
import { useWorkspaces } from "@/hooks/useWorkspaceQueries";
import { SearchMode } from "@/types/proto/api/v1/rag_service_pb";
import DocGlyph from "../components/DocGlyph";
import SectionTitle from "../components/SectionTitle";
import { COPY } from "../copy";
import { splitHighlights } from "../lib/highlight";
import { useGo, usePageScroll } from "../lib/nav";
import { usePref } from "../lib/storage";
import { docRoute } from "../routes";

const HISTORY_KEY = "search-history";

const HISTORY_LIMIT = 8;

function Highlighted({ text, terms }: { text: string; terms: readonly string[] }) {
  return (
    <>
      {splitHighlights(text, terms).map((part, i) =>
        part.hit ? (
          <mark key={i} className="bg-[#ffd60a]/45 text-inherit rounded-sm px-0.5">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

/**
 * Global search (requirement §6). A request goes out only when the reader submits:
 * search may call the embedding model, so searching on every keystroke would be
 * slow and costly. The submitted query lives in the URL, so coming back from a
 * result shows the same list.
 */
export default function SearchPage() {
  const go = useGo(COPY.search.title);
  const scrollRef = usePageScroll<HTMLDivElement>();
  const [params, setParams] = useSearchParams();
  const submitted = params.get("q") ?? "";
  const [draft, setDraft] = useState(submitted);
  const [history, setHistory] = usePref<string[]>(HISTORY_KEY, []);
  const formRef = useRef<HTMLFormElement>(null);
  const { data: workspaces = [] } = useWorkspaces(false);
  // Recent searches show while typing.
  const [focused, setFocused] = useState(false);

  // Konsta's input is a plain text field; ask iOS for a "Search" key on the keyboard.
  useEffect(() => {
    const input = formRef.current?.querySelector("input");
    if (input) input.enterKeyHint = "search";
  }, []);

  const { data, isFetching, isError } = useQuery({
    queryKey: ["mobile-search", submitted],
    queryFn: () =>
      ragServiceClient.search({ query: submitted, scope: { case: "global", value: true }, mode: SearchMode.UNSPECIFIED, limit: 0 }),
    enabled: submitted !== "",
    staleTime: 60_000,
  });

  const submit = (query: string) => {
    const q = query.trim();
    setDraft(q);
    if (!q) return;
    setParams({ q }, { replace: true });
    setHistory([q, ...history.filter((h) => h !== q)].slice(0, HISTORY_LIMIT));
    (document.activeElement as HTMLElement | null)?.blur();
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit(draft);
  };

  const clear = () => {
    setDraft("");
    setParams({}, { replace: true });
  };

  const workspaceTitle = (name: string) => workspaces.find((w) => w.name === name)?.title ?? "";
  const hits = data?.hits ?? [];

  return (
    <Page ref={scrollRef} className="pb-tabbar">
      <Navbar
        title={COPY.search.title}
        large
        transparent
        centerTitle
        subnavbar={
          <form
            ref={formRef}
            onSubmit={onSubmit}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            className="w-full"
            action=""
          >
            <Searchbar
              placeholder={COPY.search.placeholder}
              value={draft}
              clearButton
              disableButton
              onInput={(e: FormEvent<HTMLInputElement>) => setDraft(e.currentTarget.value)}
              onClear={clear}
              onDisable={clear}
            />
          </form>
        }
      />

      {!submitted && focused && history.length > 0 && (
        // Tapping a recent search must not blur the box first: the list would vanish before the tap lands.
        <div onPointerDown={(event) => event.preventDefault()}>
          <SectionTitle
            action={
              <button type="button" className="text-[15px] text-primary active:opacity-50" onClick={() => setHistory([])}>
                {COPY.search.clearHistory}
              </button>
            }
          >
            {COPY.search.history}
          </SectionTitle>
          <List strongIos insetIos className="!my-0">
            {history.map((h) => (
              <ListItem key={h} link title={h} onClick={() => submit(h)} />
            ))}
          </List>
        </div>
      )}

      {submitted && isFetching && !data && (
        <div className="flex justify-center py-16">
          <Preloader />
        </div>
      )}
      {submitted && isError && <div className="text-center text-black/40 dark:text-white/40 py-16">{COPY.search.failed}</div>}
      {submitted && data && hits.length === 0 && (
        <div className="text-center text-black/40 dark:text-white/40 py-16 px-8">{COPY.search.empty(submitted)}</div>
      )}
      {submitted && hits.length > 0 && (
        <>
          <SectionTitle>{COPY.search.results(hits.length)}</SectionTitle>
          <List strongIos insetIos dividersIos className="!my-0">
            {hits.map((hit) => (
              <ListItem
                key={hit.memo}
                link
                media={<DocGlyph icon={hit.icon} />}
                header={[workspaceTitle(hit.workspace), hit.folderPath].filter(Boolean).join(" / ")}
                title={<Highlighted text={hit.title} terms={hit.highlights} />}
                text={
                  <span className="line-clamp-2 whitespace-normal">
                    <Highlighted text={hit.snippet} terms={hit.highlights} />
                  </span>
                }
                onClick={() => go(docRoute(hit.memo))}
              />
            ))}
          </List>
        </>
      )}
    </Page>
  );
}
