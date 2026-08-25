// `/d/{doc-id}` — the permanent short link. It resolves to the page's current
// slug within *this* site only: a document published to another site, or not
// published at all, is not found here rather than redirected somewhere else.

import { Navigate, useParams } from "react-router-dom";
import { COPY } from "@/components/BlogSite/copy";
import { usePublicSite } from "@/components/PublicSite/PublicSiteContext";
import { usePublicDocSlug } from "@/hooks/usePublicSiteQueries";

const PublicSiteDoc = () => {
  const { docId = "" } = useParams();
  const { siteName, basePath } = usePublicSite();
  const { data: slug, isLoading, isError } = usePublicDocSlug(siteName, docId);

  if (isLoading) {
    return <p className="blog-shell blog-muted py-16 text-sm">{COPY.loading}</p>;
  }
  if (isError || !slug) {
    return (
      <div className="blog-shell py-32 text-center">
        <p className="blog-display text-2xl">{COPY.notFoundTitle}</p>
      </div>
    );
  }
  return <Navigate to={`${basePath}/${slug}`} replace />;
};

export default PublicSiteDoc;
