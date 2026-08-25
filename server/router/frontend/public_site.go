package frontend

import (
	"context"
	"net/http"
	"strings"

	"github.com/labstack/echo/v5"

	"github.com/usememos/memos/store"
)

// Crawler-facing behaviour for published sites.
//
// The pages themselves are rendered by the SPA, so the only things a crawler can
// be told from here are the HTTP status, the response headers and the two files
// it fetches by convention. That is enough for the three things that actually
// matter: not indexing what is not published, not indexing the same page under
// two hostnames, and not answering "gone" with "200 OK".
//
// Everything here resolves the site from the Host first and the /s/{uid} path
// second, exactly as PublicSiteService does — a reader on a custom domain can
// never be steered at another site.

// sitePathPrefix is the platform path a site is served under when it has no
// custom domain of its own.
const sitePathPrefix = "/s/"

// siteReservedPaths are the site's own pages: they are not article slugs, so
// they are never looked up in the publication table.
var siteReservedPaths = map[string]struct{}{
	"":            {},
	"contents":    {},
	"archive":     {},
	"search":      {},
	"sitemap.xml": {},
	"robots.txt":  {},
}

// resolvedSite is a site request that has been placed: which site, and which
// path within it.
type resolvedSite struct {
	site *store.Site
	// path is the request path relative to the site root, with no leading slash.
	// It is "" for the site's own home page.
	path string
	// onDomain records that the request arrived on the site's custom domain
	// rather than on the platform path.
	onDomain bool
}

// resolveSiteRequest places a request inside a published site, or reports that
// it is an ordinary application request.
//
// A site that is not ONLINE resolves to nothing at all: an offline site must be
// indistinguishable from one that does not exist, and that has to hold for a
// crawler as much as for a reader.
func (s *FrontendService) resolveSiteRequest(ctx context.Context, host, requestPath string) *resolvedSite {
	if domain := normalizeHost(host); domain != "" {
		site, err := s.Store.GetSite(ctx, &store.FindSite{Domain: &domain})
		if err == nil && site != nil {
			if site.Status != store.SiteStatusOnline {
				return nil
			}
			return &resolvedSite{site: site, path: strings.TrimPrefix(requestPath, "/"), onDomain: true}
		}
	}
	if !strings.HasPrefix(requestPath, sitePathPrefix) {
		return nil
	}
	rest := strings.TrimPrefix(requestPath, sitePathPrefix)
	uid, sitePath, _ := strings.Cut(rest, "/")
	if uid == "" {
		return nil
	}
	site, err := s.Store.GetSite(ctx, &store.FindSite{UID: &uid})
	if err != nil || site == nil || site.Status != store.SiteStatusOnline {
		return nil
	}
	return &resolvedSite{site: site, path: sitePath}
}

// canonicalBase is the origin+prefix the site's pages should be indexed under.
// A site reachable at two addresses has to name one of them, or the same article
// is indexed twice and neither copy ranks.
func (s *FrontendService) canonicalBase(site *store.Site) string {
	if site.Canonical == store.SiteCanonicalDomain && site.Domain != "" && site.DomainVerified {
		return "https://" + site.Domain
	}
	instanceURL := strings.TrimRight(s.Profile.InstanceURL, "/")
	if instanceURL == "" {
		return ""
	}
	return instanceURL + sitePathPrefix + site.UID
}

// applySiteSEOHeaders decides the status and crawler headers for one site page,
// and reports the status the HTML shell should be served with.
//
// Serving a removed article as "200 OK" with a client-rendered "not found" is
// the failure this exists to prevent: the crawler keeps the page indexed, and
// the article stays searchable on the open web after being taken down.
func (s *FrontendService) applySiteSEOHeaders(ctx context.Context, c *echo.Context, resolved *resolvedSite) int {
	header := c.Response().Header()
	if base := s.canonicalBase(resolved.site); base != "" {
		canonical := base
		if resolved.path != "" {
			canonical += "/" + resolved.path
		}
		header.Set("Link", `<`+canonical+`>; rel="canonical"`)
	}

	if _, reserved := siteReservedPaths[resolved.path]; reserved {
		return http.StatusOK
	}
	// Only a bare slug is an article. /d/{doc-id} is a redirector the client
	// resolves, and anything deeper is not a site URL at all — site URLs are flat.
	if strings.Contains(resolved.path, "/") {
		header.Set("X-Robots-Tag", "noindex")
		return http.StatusOK
	}

	published := store.SitePublicationStatePublished
	pub, err := s.Store.GetSitePublication(ctx, &store.FindSitePublication{
		SiteID:         &resolved.site.ID,
		Slug:           &resolved.path,
		State:          &published,
		ExcludeContent: true,
	})
	if err != nil {
		return http.StatusOK
	}
	if pub != nil {
		return http.StatusOK
	}

	header.Set("X-Robots-Tag", "noindex")
	// A slug with an unpublished record behind it was published once, so "gone"
	// is the truthful answer and the one that drops it from the index fastest.
	// A slug that never existed is a plain 404.
	unpublished := store.SitePublicationStateUnpublished
	tombstone, err := s.Store.GetSitePublication(ctx, &store.FindSitePublication{
		SiteID:         &resolved.site.ID,
		Slug:           &resolved.path,
		State:          &unpublished,
		ExcludeContent: true,
	})
	if err == nil && tombstone != nil {
		return http.StatusGone
	}
	return http.StatusNotFound
}

// siteRobotsTXT is the robots.txt a published site serves for itself. The
// instance's own robots.txt describes the application and its public memos,
// which is a different site with different content — serving it on a published
// site's domain would point crawlers at the wrong sitemap.
func (s *FrontendService) siteRobotsTXT(resolved *resolvedSite) string {
	lines := []string{"User-agent: *", "Allow: /"}
	base := s.canonicalBase(resolved.site)
	if base == "" {
		return strings.Join(lines, "\n")
	}
	if resolved.onDomain && !strings.HasPrefix(base, "https://"+resolved.site.Domain) {
		// This host is not the canonical one. Say so rather than inviting a crawl
		// that will only produce duplicates of the canonical copy.
		return strings.Join([]string{"User-agent: *", "Disallow: /", "Sitemap: " + base + "/sitemap.xml"}, "\n")
	}
	return strings.Join(append(lines, "Sitemap: "+base+"/sitemap.xml"), "\n")
}

// siteSitemap lists the site's published pages, and nothing else. It reads the
// publication table only: an unpublished document is not filtered out of the
// sitemap, it is not in the query range at all.
func (s *FrontendService) siteSitemap(ctx context.Context, resolved *resolvedSite) ([]sitemapURL, error) {
	base := s.canonicalBase(resolved.site)
	if base == "" {
		return nil, echo.NewHTTPError(http.StatusNotFound, "instance URL is not configured")
	}
	published := store.SitePublicationStatePublished
	publications, err := s.Store.ListSitePublications(ctx, &store.FindSitePublication{
		SiteID:         &resolved.site.ID,
		State:          &published,
		ExcludeContent: true,
	})
	if err != nil {
		return nil, err
	}
	urls := make([]sitemapURL, 0, len(publications)+2)
	urls = append(urls, sitemapURL{Loc: base + "/"})
	// The archive is a page of the site in its own right, so it belongs here.
	// It is not what makes the site crawlable, though — the sitemap already
	// names every article below, which is what covers the "load more" button
	// being invisible to a crawler.
	urls = append(urls, sitemapURL{Loc: base + "/archive"})
	for _, pub := range publications {
		if pub.Slug == "" {
			continue
		}
		urls = append(urls, sitemapURL{Loc: base + "/" + pub.Slug})
	}
	return urls, nil
}

// normalizeHost strips the port and lower-cases a Host value so it matches the
// stored domain.
func normalizeHost(host string) string {
	host = strings.ToLower(strings.TrimSpace(host))
	if idx := strings.LastIndex(host, ":"); idx > 0 && !strings.Contains(host[idx:], "]") {
		host = host[:idx]
	}
	return strings.TrimSuffix(host, ".")
}
