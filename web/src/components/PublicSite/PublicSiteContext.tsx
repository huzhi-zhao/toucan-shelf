import { createContext, type ReactNode, useContext, useMemo } from "react";
import type { PublicSiteProfile } from "@/types/proto/api/v1/public_site_service_pb";

export interface PublicSiteContextValue {
  /** Resource name of the site being read, "" when it was resolved from the Host. */
  siteName: string;
  /** Prefix every in-site path is built on. "" when the site owns the URL root. */
  basePath: string;
  profile: PublicSiteProfile;
}

const PublicSiteContext = createContext<PublicSiteContextValue | null>(null);

export const PublicSiteProvider = ({ siteName, basePath, profile, children }: PublicSiteContextValue & { children: ReactNode }) => {
  const value = useMemo(() => ({ siteName, basePath, profile }), [siteName, basePath, profile]);
  return <PublicSiteContext.Provider value={value}>{children}</PublicSiteContext.Provider>;
};

export const usePublicSite = (): PublicSiteContextValue => {
  const context = useContext(PublicSiteContext);
  if (!context) {
    throw new Error("usePublicSite must be used within PublicSiteProvider");
  }
  return context;
};
