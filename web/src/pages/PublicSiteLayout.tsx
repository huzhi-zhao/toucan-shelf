// The outward-facing site shell.
//
// Everything under here is anonymous: the only API it may touch is
// PublicSiteService, which reads the publication tables and nothing else. No app
// chrome, no sidebar, no memo query — a published page must not be able to reach
// the knowledge base even by accident.
//
// The chrome itself is BlogShell, the site's own skin. It is drawn from the site
// profile rather than from the home `.view` document because it has to render on
// the article and search pages too, and those never load that document.

import { useMemo } from "react";
import { Outlet, useParams } from "react-router-dom";
import { toBlogChrome, toBlogThemeStyle } from "@/components/BlogSite/adapt";
import BlogShell from "@/components/BlogSite/BlogShell";
import { COPY } from "@/components/BlogSite/copy";
import { PublicSiteProvider } from "@/components/PublicSite/PublicSiteContext";
import usePageTitle from "@/hooks/usePageTitle";
import { usePublicSiteProfile } from "@/hooks/usePublicSiteQueries";
import { publicSitePath } from "@/router/routes";

const PublicSiteLayout = () => {
  const { siteUid } = useParams();
  // On a custom domain the site is resolved from the Host and the path carries no
  // site at all; on the platform path it is named explicitly. The server resolves
  // the Host first either way, so a query parameter can never steer a reader on a
  // custom domain to another site's content.
  const siteName = siteUid ? `sites/${siteUid}` : "";
  const basePath = siteUid ? publicSitePath(siteName) : "";
  const { data: profile, isLoading, isError } = usePublicSiteProfile(siteName);

  usePageTitle(profile?.displayName ?? "");

  const chrome = useMemo(() => (profile ? toBlogChrome(profile) : null), [profile]);
  const theme = useMemo(() => (profile ? toBlogThemeStyle(profile.theme) : {}), [profile]);

  if (isLoading) {
    return (
      <div className="blog-skin flex min-h-screen items-center justify-center">
        <p className="blog-muted text-sm">{COPY.loading}</p>
      </div>
    );
  }

  // A site that is not online is indistinguishable from one that does not exist,
  // and that is on purpose — the reader is told nothing either way.
  if (isError || !profile || !chrome) {
    return (
      <div className="blog-skin flex min-h-screen flex-col items-center justify-center gap-2">
        <p className="blog-display text-2xl">404</p>
        <p className="blog-muted text-sm">{COPY.notFoundTitle}</p>
      </div>
    );
  }

  return (
    <PublicSiteProvider siteName={siteName} basePath={basePath} profile={profile}>
      <BlogShell chrome={chrome} basePath={basePath} theme={theme}>
        <Outlet />
      </BlogShell>
    </PublicSiteProvider>
  );
};

export default PublicSiteLayout;
