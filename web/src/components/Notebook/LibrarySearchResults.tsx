import { FileTextIcon, InfoIcon } from "lucide-react";
import DocIcon from "@/components/DocIcon";
import { cn } from "@/lib/utils";
import type { SearchHit } from "@/types/proto/api/v1/rag_service_pb";
import { useTranslate } from "@/utils/i18n";

interface Props {
  query: string;
  hits: SearchHit[];
  degradedToKeyword: boolean;
  loading: boolean;
  onSelect: (memoName: string) => void;
}

// LibrarySearchResults renders the in-library (F2) search hit list in the Notebook
// preview area, reusing the same document-card layout as the global search page.
const LibrarySearchResults = ({ query, hits, degradedToKeyword, loading, onSelect }: Props) => {
  const t = useTranslate();

  return (
    <section className="w-full h-full overflow-y-auto">
      <div className="w-full max-w-3xl mx-auto flex flex-col gap-4 px-4 sm:px-6 py-6">
        <h2 className="text-sm text-muted-foreground">
          {t("search.results-for")} <span className="font-medium text-foreground">{query}</span>
        </h2>

        {degradedToKeyword && (
          <div className="flex flex-row items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            <InfoIcon className="w-4 h-4 shrink-0" />
            <span>{t("search.keyword-only-hint")}</span>
          </div>
        )}

        {loading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}…</p>
        ) : hits.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("search.no-results")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {hits.map((hit) => (
              <li key={hit.memo}>
                <button
                  type="button"
                  onClick={() => onSelect(hit.memo)}
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
      </div>
    </section>
  );
};

export default LibrarySearchResults;
