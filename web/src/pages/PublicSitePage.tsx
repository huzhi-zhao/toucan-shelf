// One published page: `/<slug>` on the site's own domain, `/s/{site}/<slug>` on
// the platform path.
//
// The body is the frozen snapshot the publish pipeline produced — secret blocks
// already stripped, in-site links already rewritten — rendered through the same
// markdown renderer the app uses, in its public mode (PublicSiteRenderProvider):
// same typography, none of the behaviours that only make sense while signed in.

import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Loader2Icon } from "lucide-react";
import { useParams } from "react-router-dom";
import MemoContent from "@/components/MemoContent";
import { PublicSiteRenderProvider } from "@/components/MemoContent/PublicSiteRenderContext";
import { usePublicSite } from "@/components/PublicSite/PublicSiteContext";
import usePageTitle from "@/hooks/usePageTitle";
import { usePublicPage } from "@/hooks/usePublicSiteQueries";

const PublicSitePage = () => {
  const { slug = "" } = useParams();
  const { siteName, basePath, profile } = usePublicSite();
  const { data: page, isLoading, isError } = usePublicPage(siteName, slug);

  usePageTitle(page?.title ? `${page.title} - ${profile.displayName}` : profile.displayName);

  if (isLoading) {
    return <Loader2Icon className="h-5 w-5 animate-spin text-muted-foreground" />;
  }
  if (isError || !page) {
    return (
      <div className="flex flex-col items-center gap-2 py-20 text-muted-foreground">
        <p className="text-lg font-medium">404</p>
        <p className="text-sm">Not found</p>
      </div>
    );
  }

  return (
    <article className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{page.title || page.slug}</h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {page.updateTime && <span>{timestampDate(page.updateTime).toLocaleDateString()}</span>}
          {page.tags.map((tag) => (
            <span key={tag}>#{tag}</span>
          ))}
        </div>
      </header>
      <PublicSiteRenderProvider basePath={basePath}>
        <MemoContent content={page.content} density="reading" alwaysExpanded />
      </PublicSiteRenderProvider>
    </article>
  );
};

export default PublicSitePage;
