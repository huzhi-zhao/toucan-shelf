// The site's index. P0 has no dashboard `.view` yet, so this is a plain listing
// of the site's published pages — drawn from ListPublicPages, the only source an
// outward-facing listing may draw from.

import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Loader2Icon } from "lucide-react";
import { Link } from "react-router-dom";
import { usePublicSite } from "@/components/PublicSite/PublicSiteContext";
import { usePublicPages } from "@/hooks/usePublicSiteQueries";

const PublicSiteHome = () => {
  const { siteName, basePath } = usePublicSite();
  const { data: pages, isLoading, isError } = usePublicPages(siteName);

  if (isLoading) {
    return <Loader2Icon className="h-5 w-5 animate-spin text-muted-foreground" />;
  }
  if (isError || !pages || pages.length === 0) {
    return <p className="text-sm text-muted-foreground">还没有发布任何内容。</p>;
  }

  return (
    <ul className="flex flex-col divide-y divide-border">
      {pages.map((page) => (
        <li key={page.slug} className="py-4">
          <Link to={`${basePath}/${page.slug}`} className="text-lg font-medium hover:underline">
            {page.title || page.slug}
          </Link>
          {page.summary && <p className="mt-1 text-sm leading-6 text-muted-foreground">{page.summary}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {page.updateTime && <span>{timestampDate(page.updateTime).toLocaleDateString()}</span>}
            {page.tags.map((tag) => (
              <span key={tag}>#{tag}</span>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
};

export default PublicSiteHome;
