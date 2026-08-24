// `/d/{doc-id}` — the permanent short link. It resolves to the page's current
// slug within *this* site only: a document published to another site, or not
// published at all, is not found here rather than redirected somewhere else.

import { Loader2Icon } from "lucide-react";
import { Navigate, useParams } from "react-router-dom";
import { usePublicSite } from "@/components/PublicSite/PublicSiteContext";
import { usePublicDocSlug } from "@/hooks/usePublicSiteQueries";

const PublicSiteDoc = () => {
  const { docId = "" } = useParams();
  const { siteName, basePath } = usePublicSite();
  const { data: slug, isLoading, isError } = usePublicDocSlug(siteName, docId);

  if (isLoading) {
    return <Loader2Icon className="h-5 w-5 animate-spin text-muted-foreground" />;
  }
  if (isError || !slug) {
    return (
      <div className="flex flex-col items-center gap-2 py-20 text-muted-foreground">
        <p className="text-lg font-medium">404</p>
        <p className="text-sm">Not found</p>
      </div>
    );
  }
  return <Navigate to={`${basePath}/${slug}`} replace />;
};

export default PublicSiteDoc;
