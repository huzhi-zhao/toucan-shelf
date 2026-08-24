package test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	apiv1 "github.com/usememos/memos/proto/gen/api/v1"
)

// TestSiteThemeIsWhitelisted is the stored-XSS boundary. The theme ends up as
// custom properties on a page served to anonymous readers, so the check that
// keeps it to named configuration has to be here and not in the browser — a
// request can skip the browser.
func TestSiteThemeIsWhitelisted(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	admin, err := ts.CreateHostUser(ctx, "admin")
	require.NoError(t, err)
	adminCtx := ts.CreateUserContext(ctx, admin.ID)
	site := newTestSite(ctx, t, ts, adminCtx, "Docs")

	setTheme := func(theme string) error {
		_, err := ts.Service.UpdateSite(adminCtx, &apiv1.UpdateSiteRequest{
			Site:       &apiv1.Site{Name: site.Name, Theme: theme},
			UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"theme"}},
		})
		return err
	}

	require.NoError(t, setTheme(`{"bg":"#0f1115","accent":"rgb(27, 79, 168)","prose-max":"42rem","font-body":"Inter, sans-serif"}`))

	for name, theme := range map[string]string{
		"unknown key":     `{"custom-css":"#fff"}`,
		"markup as value": `{"bg":"<script>alert(1)</script>"}`,
		"url in a font":   `{"font-body":"url(https://evil.example/x.css)"}`,
		"declaration":     `{"accent":"red; background: url(javascript:alert(1))"}`,
		"length with fn":  `{"gutter":"calc(100% - 2px)"}`,
		"not a string":    `{"bg":{"nested":true}}`,
		"not an object":   `["#fff"]`,
	} {
		t.Run(name, func(t *testing.T) {
			require.Error(t, setTheme(theme))
		})
	}

	// The rejected values must not have landed anywhere: an anonymous reader
	// still sees only the one theme that passed.
	profile, err := ts.Service.GetPublicSiteProfile(ctx, &apiv1.GetPublicSiteProfileRequest{Site: site.Name})
	require.NoError(t, err)
	require.NotContains(t, profile.Theme, "script")
	require.Contains(t, profile.Theme, "#0f1115")
}

// TestSiteMenuIsSiteConfiguration covers the split the front end depends on: the
// menu comes from the site profile, so it is available on pages that never load
// the home `.view` document.
func TestSiteMenuIsSiteConfiguration(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	admin, err := ts.CreateHostUser(ctx, "admin")
	require.NoError(t, err)
	adminCtx := ts.CreateUserContext(ctx, admin.ID)
	site := newTestSite(ctx, t, ts, adminCtx, "Docs")

	// A new site is usable before anyone configures it.
	require.NotEmpty(t, site.Menu)

	updated, err := ts.Service.UpdateSite(adminCtx, &apiv1.UpdateSiteRequest{
		Site: &apiv1.Site{Name: site.Name, Menu: []*apiv1.SiteMenuItem{
			{Label: "Home", Path: ""},
			{Label: "Handbook", Path: "handbook"},
		}},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"menu"}},
	})
	require.NoError(t, err)
	require.Len(t, updated.Menu, 2)
	require.Equal(t, "handbook", updated.Menu[1].Path)

	profile, err := ts.Service.GetPublicSiteProfile(ctx, &apiv1.GetPublicSiteProfileRequest{Site: site.Name})
	require.NoError(t, err)
	require.Len(t, profile.Menu, 2)
	require.Equal(t, "Handbook", profile.Menu[1].Label)

	// The menu navigates within the site. An absolute URL would make it a link
	// list, and a `javascript:` one would make it a script.
	for _, path := range []string{"https://evil.example", "javascript:alert(1)", "../admin", "/handbook"} {
		_, err := ts.Service.UpdateSite(adminCtx, &apiv1.UpdateSiteRequest{
			Site:       &apiv1.Site{Name: site.Name, Menu: []*apiv1.SiteMenuItem{{Label: "X", Path: path}}},
			UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"menu"}},
		})
		require.Error(t, err, path)
	}
}
