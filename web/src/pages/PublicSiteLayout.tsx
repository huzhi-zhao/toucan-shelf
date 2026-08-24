// The outward-facing site shell.
//
// Everything under here is anonymous: the only API it may touch is
// PublicSiteService, which reads the publication tables and nothing else. No app
// chrome, no sidebar, no memo query — a published page must not be able to reach
// the knowledge base even by accident.

import { Loader2Icon } from "lucide-react";
import { Link, Outlet, useParams } from "react-router-dom";
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

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2Icon className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // A site that is not online is indistinguishable from one that does not exist,
  // and that is on purpose — the reader is told nothing either way.
  if (isError || !profile) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 text-muted-foreground">
        <p className="text-lg font-medium">404</p>
        <p className="text-sm">Not found</p>
      </div>
    );
  }

  return (
    <PublicSiteProvider siteName={siteName} basePath={basePath} profile={profile}>
      <div className="flex min-h-screen flex-col bg-background text-foreground">
        <header className="border-b border-border">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-1 px-5 py-6">
            <Link to={basePath || "/"} className="text-xl font-semibold tracking-tight hover:opacity-80">
              {profile.displayName}
            </Link>
            {profile.description && <p className="text-sm leading-6 text-muted-foreground">{profile.description}</p>}
          </div>
        </header>
        <main className="mx-auto w-full max-w-3xl grow px-5 py-8">
          <Outlet />
        </main>
        <footer className="border-t border-border">
          <div className="mx-auto w-full max-w-3xl px-5 py-5 text-xs text-muted-foreground">{profile.displayName}</div>
        </footer>
      </div>
    </PublicSiteProvider>
  );
};

export default PublicSiteLayout;
