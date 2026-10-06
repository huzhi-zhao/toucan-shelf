import { useQuery } from "@tanstack/react-query";
import { FileTextIcon, InfoIcon } from "lucide-react";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import DocIcon from "@/components/DocIcon";
import { ragServiceClient } from "@/connect";
import { useWorkspaces } from "@/hooks/useWorkspaceQueries";
import { cn } from "@/lib/utils";
import { type SearchHit, SearchMode } from "@/types/proto/api/v1/rag_service_pb";
import { useTranslate } from "@/utils/i18n";

interface Props {
  // The keyword(s) to rank by (handed to RAG as the query).
  query: string;
  // A CEL filter constraining the candidate corpus (Explore's structured filters,
  // minus the keyword itself). Undefined means no structured constraint.
  filter?: string;
}

// ExploreSearchResults renders the relevance-ranked hit list for the Explore page's
// keyword search. Structured filters define the corpus; the query ranks within it.
const ExploreSearchResults = ({ query, filter }: Props) => {
  const t = useTranslate();
  const navigate = useNavigate();
  const { data: workspaces = [] } = useWorkspaces();

  const workspaceTitleByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const workspace of workspaces) {
      map.set(workspace.name, workspace.title || workspace.name);
    }
    return map;
  }, [workspaces]);

  const { data, isPending, isError } = useQuery({
    queryKey: ["rag-search", "explore", query, filter ?? ""],
    queryFn: () =>
      ragServiceClient.search({
        query,
        scope: { case: "global", value: true },
        filter: filter ?? "",
        mode: SearchMode.UNSPECIFIED,
        limit: 0,
      }),
    enabled: query.trim() !== "",
  });

  const hits = data?.hits ?? [];
  const degradedToKeyword = data?.effectiveMode === SearchMode.KEYWORD;

  const openHit = (hit: SearchHit) => {
    const title = workspaceTitleByName.get(hit.workspace);
    if (title) {
      navigate(`/${encodeURIComponent(title)}/${encodeURIComponent(hit.memo)}`);
    } else {
      const uid = hit.memo.replace(/^memos\//, "");
      navigate(`/memos/${uid}`);
    }
  };

  return (
    <section className="w-full max-w-3xl mx-auto flex flex-col gap-4 px-2 sm:px-4 py-4">
      <h2 className="text-sm text-muted-foreground">
        {t("search.results-for")} <span className="font-medium text-foreground">{query}</span>
      </h2>

      {degradedToKeyword && (
        <div className="flex flex-row items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <InfoIcon className="w-4 h-4 shrink-0" />
          <span>{t("search.keyword-only-hint")}</span>
        </div>
      )}

      {isPending ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}…</p>
      ) : isError ? (
        <p className="text-sm text-muted-foreground">{t("search.no-results")}</p>
      ) : hits.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("search.no-results")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {hits.map((hit) => (
            <li key={hit.memo}>
              <button
                type="button"
                onClick={() => openHit(hit)}
                className={cn(
                  "w-full text-left rounded-lg border border-border p-3 transition-colors",
                  "hover:bg-accent hover:border-accent-foreground/20",
                )}
              >
                <div className="flex flex-row items-center gap-2">
                  <DocIcon icon={hit.icon}>
                    <FileTextIcon className="w-4 h-4 shrink-0 text-muted-foreground" />
                  </DocIcon>
                  <span className="font-medium truncate">{hit.title || t("common.untitled")}</span>
                </div>
                {hit.folderPath && <p className="mt-0.5 text-xs text-muted-foreground truncate">{hit.folderPath}</p>}
                {hit.snippet && <p className="mt-1 text-sm text-muted-foreground line-clamp-3">{hit.snippet}</p>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default ExploreSearchResults;
