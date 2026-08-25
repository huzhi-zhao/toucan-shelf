package frontend

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v5"
	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/internal/profile"
	"github.com/usememos/memos/store"
	teststore "github.com/usememos/memos/store/test"
)

// seedSite creates one ONLINE site with a published page and a taken-down one.
func seedSite(ctx context.Context, t *testing.T, ts *store.Store, domain string) *store.Site {
	t.Helper()
	site, err := ts.CreateSite(ctx, &store.Site{
		UID:            "sitea",
		Name:           "Docs",
		Domain:         domain,
		DomainVerified: domain != "",
		Canonical:      store.SiteCanonicalPlatform,
		Status:         store.SiteStatusOnline,
		Theme:          "{}",
		Menu:           "[]",
		Nav:            "[]",
		SearchMode:     "HYBRID",
	})
	require.NoError(t, err)

	// One publication per source document: the table holds at most one record per
	// (site, document), whatever state it is in.
	for memoID, page := range map[int32]struct {
		slug  string
		state string
	}{
		1: {"getting-started", store.SitePublicationStatePublished},
		2: {"old-post", store.SitePublicationStateUnpublished},
	} {
		slug, state := page.slug, page.state
		_, err := ts.CreateSitePublication(ctx, &store.SitePublication{
			UID:    "pub-" + slug,
			SiteID: site.ID,
			MemoID: memoID,
			Slug:   slug,
			Title:  slug,
			State:  state,
		})
		require.NoError(t, err)
	}
	return site
}

func newSiteTestServer(ctx context.Context, t *testing.T, instanceURL string) (*echo.Echo, *store.Store) {
	t.Helper()
	testStore := teststore.NewTestingStore(ctx, t)
	e := echo.New()
	NewFrontendService(&profile.Profile{InstanceURL: instanceURL}, testStore).Serve(ctx, e)
	return e, testStore
}

// TestSitePageStatusReflectsPublication is the whole point of resolving sites in
// the frontend layer: the SPA answers every URL with the same shell, so without
// this a removed article keeps returning 200 OK and keeps its place in the index.
func TestSitePageStatusReflectsPublication(t *testing.T) {
	ctx := context.Background()
	e, testStore := newSiteTestServer(ctx, t, "https://memos.example.com")
	seedSite(ctx, t, testStore, "")

	tests := []struct {
		name   string
		path   string
		status int
		robots string
	}{
		{name: "published page is indexable", path: "/s/sitea/getting-started", status: http.StatusOK},
		{name: "taken-down page is gone", path: "/s/sitea/old-post", status: http.StatusGone, robots: "noindex"},
		{name: "slug that never existed is not found", path: "/s/sitea/never-was", status: http.StatusNotFound, robots: "noindex"},
		{name: "the site's own pages stay indexable", path: "/s/sitea/contents", status: http.StatusOK},
		{name: "site root stays indexable", path: "/s/sitea", status: http.StatusOK},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			e.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, tt.path, nil))
			require.Equal(t, tt.status, rec.Code)
			require.Equal(t, tt.robots, rec.Header().Get("X-Robots-Tag"))
		})
	}
}

// TestOfflineSiteIsInvisibleToCrawlers: an offline site must be indistinguishable
// from one that does not exist, for a crawler as much as for a reader.
func TestOfflineSiteIsInvisibleToCrawlers(t *testing.T) {
	ctx := context.Background()
	e, testStore := newSiteTestServer(ctx, t, "https://memos.example.com")
	site := seedSite(ctx, t, testStore, "docs.example.com")
	offline := store.SiteStatusOffline
	_, err := testStore.UpdateSite(ctx, &store.UpdateSite{ID: site.ID, Status: &offline})
	require.NoError(t, err)

	// The sitemap on the site's own domain falls back to the instance's, which
	// says nothing about this site.
	req := httptest.NewRequest(http.MethodGet, "/sitemap.xml", nil)
	req.Host = "docs.example.com"
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	require.NotContains(t, rec.Body.String(), "getting-started")

	rec = httptest.NewRecorder()
	e.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/s/sitea/getting-started", nil))
	require.Equal(t, http.StatusOK, rec.Code, "no site resolves, so this is an ordinary application route")
	require.Empty(t, rec.Header().Get("Link"))
}

// TestSiteSitemapListsOnlyPublishedPages guards the query range: the sitemap is
// built from the publication table, so an unpublished document is not filtered
// out of it — it is not in range at all.
func TestSiteSitemapListsOnlyPublishedPages(t *testing.T) {
	ctx := context.Background()
	e, testStore := newSiteTestServer(ctx, t, "https://memos.example.com")
	seedSite(ctx, t, testStore, "")

	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/s/sitea/sitemap.xml", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	body := rec.Body.String()
	require.Contains(t, body, "https://memos.example.com/s/sitea/getting-started")
	require.NotContains(t, body, "old-post")
	require.NotContains(t, body, "/memos/", "a site sitemap never lists the application's own memos")
}

// TestSiteRobotsAndCanonicalFollowTheCanonicalSetting covers the duplicate-index
// case: a site reachable at two addresses has to name one of them, or the same
// article is indexed twice and neither copy ranks.
func TestSiteRobotsAndCanonicalFollowTheCanonicalSetting(t *testing.T) {
	ctx := context.Background()
	e, testStore := newSiteTestServer(ctx, t, "https://memos.example.com")
	site := seedSite(ctx, t, testStore, "docs.example.com")

	// Canonical is the platform path: the custom domain asks not to be crawled,
	// and its pages point back at the platform URL.
	req := httptest.NewRequest(http.MethodGet, "/robots.txt", nil)
	req.Host = "docs.example.com"
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	require.Contains(t, rec.Body.String(), "Disallow: /")
	require.Contains(t, rec.Body.String(), "Sitemap: https://memos.example.com/s/sitea/sitemap.xml")

	req = httptest.NewRequest(http.MethodGet, "/getting-started", nil)
	req.Host = "docs.example.com"
	rec = httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)
	require.Equal(t, `<https://memos.example.com/s/sitea/getting-started>; rel="canonical"`, rec.Header().Get("Link"))

	// Now the domain is the canonical entry point.
	canonical := store.SiteCanonicalDomain
	_, err := testStore.UpdateSite(ctx, &store.UpdateSite{ID: site.ID, Canonical: &canonical})
	require.NoError(t, err)

	req = httptest.NewRequest(http.MethodGet, "/robots.txt", nil)
	req.Host = "docs.example.com"
	rec = httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	require.Contains(t, rec.Body.String(), "Allow: /")
	require.Contains(t, rec.Body.String(), "Sitemap: https://docs.example.com/sitemap.xml")

	// The platform copy of the same page now points at the domain.
	rec = httptest.NewRecorder()
	e.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/s/sitea/getting-started", nil))
	require.Equal(t, `<https://docs.example.com/getting-started>; rel="canonical"`, rec.Header().Get("Link"))
}

// TestInstanceRobotsUnchangedOffSite: the application's own robots.txt is not
// affected by any of this.
func TestInstanceRobotsUnchangedOffSite(t *testing.T) {
	ctx := context.Background()
	e, testStore := newSiteTestServer(ctx, t, "https://memos.example.com")
	seedSite(ctx, t, testStore, "docs.example.com")

	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/robots.txt", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	require.True(t, strings.Contains(rec.Body.String(), "Host: https://memos.example.com"))
}

// TestSiteSitemapListsTheArchive keeps the archive in the sitemap. It is a page
// of the site, and it is the one page a reader can reach every article from —
// the home page shows whatever slice the author arranged.
func TestSiteSitemapListsTheArchive(t *testing.T) {
	ctx := context.Background()
	e, testStore := newSiteTestServer(ctx, t, "https://memos.example.com")
	seedSite(ctx, t, testStore, "")

	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/s/sitea/sitemap.xml", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	require.Contains(t, rec.Body.String(), "/s/sitea/archive")
}
