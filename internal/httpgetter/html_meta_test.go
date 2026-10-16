package httpgetter

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func TestGetHTMLMeta(t *testing.T) {
	originalHTTPClient := httpClient
	t.Cleanup(func() {
		httpClient = originalHTTPClient
	})

	httpClient = &http.Client{
		Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			require.Equal(t, "http://93.184.216.34/article", req.URL.String())
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"text/html; charset=utf-8"}},
				Body: io.NopCloser(strings.NewReader(`<!doctype html>
<html>
<head>
  <title>Fallback title</title>
  <meta name="description" content="Fallback description">
  <meta property="og:title" content="Open Graph title">
  <meta property="og:description" content="Open Graph description">
  <meta property="og:image" content="https://example.com/cover.png">
</head>
<body>ignored</body>
</html>`)),
				Request: req,
			}, nil
		}),
	}

	metadata, err := GetHTMLMeta("http://93.184.216.34/article")
	require.NoError(t, err)
	require.Equal(t, HTMLMeta{
		Title:       "Open Graph title",
		Description: "Open Graph description",
		Image:       "https://example.com/cover.png",
		Favicon:     "http://93.184.216.34/favicon.ico",
	}, *metadata)
}

func TestGetHTMLMetaWithNameOnly(t *testing.T) {
	originalHTTPClient := httpClient
	t.Cleanup(func() {
		httpClient = originalHTTPClient
	})

	httpClient = &http.Client{
		Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			require.Equal(t, "http://93.184.216.34/blog", req.URL.String())
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"text/html; charset=utf-8"}},
				Body: io.NopCloser(strings.NewReader(`<!doctype html>
<html>
<head>
  <title>Sample Page</title>
  <meta name="description" content="This description should appear in the link preview.">
</head>
<body>Hello</body>
</html>`)),
				Request: req,
			}, nil
		}),
	}

	metadata, err := GetHTMLMeta("http://93.184.216.34/blog")
	require.NoError(t, err)
	require.Equal(t, HTMLMeta{
		Title:       "Sample Page",
		Description: "This description should appear in the link preview.",
		Image:       "",
		Favicon:     "http://93.184.216.34/favicon.ico",
	}, *metadata)
}

func TestGetHTMLMetaWithNameCaseInsensitive(t *testing.T) {
	originalHTTPClient := httpClient
	t.Cleanup(func() {
		httpClient = originalHTTPClient
	})

	httpClient = &http.Client{
		Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			require.Equal(t, "http://93.184.216.34/blog", req.URL.String())
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"text/html; charset=utf-8"}},
				Body: io.NopCloser(strings.NewReader(`<!doctype html>
<html>
<head>
  <title>Sample Page</title>
  <meta name="Description" content="Case insensitive description match.">
</head>
<body>Hello</body>
</html>`)),
				Request: req,
			}, nil
		}),
	}

	metadata, err := GetHTMLMeta("http://93.184.216.34/blog")
	require.NoError(t, err)
	require.Equal(t, HTMLMeta{
		Title:       "Sample Page",
		Description: "Case insensitive description match.",
		Image:       "",
		Favicon:     "http://93.184.216.34/favicon.ico",
	}, *metadata)
}

// fakeSite serves the given pages by URL; a page with a location is a 302.
type fakePage struct {
	status   int
	location string
	body     string
}

func useFakeSite(t *testing.T, pages map[string]fakePage) {
	t.Helper()
	originalHTTPClient := httpClient
	t.Cleanup(func() {
		httpClient = originalHTTPClient
	})
	httpClient = &http.Client{
		Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			page, ok := pages[req.URL.String()]
			if !ok {
				t.Fatalf("unexpected request to %s", req.URL)
			}
			header := http.Header{"Content-Type": []string{"text/html; charset=utf-8"}}
			if page.location != "" {
				header.Set("Location", page.location)
			}
			return &http.Response{
				StatusCode: page.status,
				Header:     header,
				Body:       io.NopCloser(strings.NewReader(page.body)),
				Request:    req,
			}, nil
		}),
	}
}

func TestGetHTMLMetaResolvesDeclaredIcon(t *testing.T) {
	useFakeSite(t, map[string]fakePage{
		"https://93.184.216.34/docs/page": {status: http.StatusOK, body: `<html><head>
  <link rel="apple-touch-icon" href="/touch.png">
  <link rel="shortcut icon" href="../static/icon.svg">
  <title>Docs</title>
</head><body></body></html>`},
	})

	metadata, err := GetHTMLMeta("https://93.184.216.34/docs/page")
	require.NoError(t, err)
	require.Equal(t, "Docs", metadata.Title)
	require.Equal(t, "https://93.184.216.34/static/icon.svg", metadata.Favicon)
}

func TestGetHTMLMetaFallsBackToTouchIcon(t *testing.T) {
	useFakeSite(t, map[string]fakePage{
		"https://93.184.216.34/": {status: http.StatusOK, body: `<html><head><link rel="apple-touch-icon" href="https://cdn.example.com/t.png"></head></html>`},
	})

	metadata, err := GetHTMLMeta("https://93.184.216.34/")
	require.NoError(t, err)
	require.Equal(t, "https://cdn.example.com/t.png", metadata.Favicon)
}

func TestGetHTMLMetaIgnoresSignInRedirect(t *testing.T) {
	useFakeSite(t, map[string]fakePage{
		"https://docs.google.com/document/d/abc/edit": {
			status:   http.StatusFound,
			location: "https://accounts.google.com/v3/signin/identifier?continue=x",
		},
		"https://accounts.google.com/v3/signin/identifier?continue=x": {
			status: http.StatusOK,
			body:   `<html><head><title>Sign in - Google Accounts</title><link rel="icon" href="/g.ico"></head></html>`,
		},
	})

	metadata, err := GetHTMLMeta("https://docs.google.com/document/d/abc/edit")
	require.NoError(t, err)
	require.Equal(t, HTMLMeta{Favicon: "https://docs.google.com/favicon.ico"}, *metadata)
}

func TestGetHTMLMetaIgnoresSameHostLoginRedirect(t *testing.T) {
	useFakeSite(t, map[string]fakePage{
		"https://wiki.example.com/pages/42": {status: http.StatusFound, location: "/login.action?dest=42"},
		"https://wiki.example.com/login.action?dest=42": {
			status: http.StatusOK,
			body:   `<html><head><title>Log in</title></head></html>`,
		},
	})

	metadata, err := GetHTMLMeta("https://wiki.example.com/pages/42")
	require.NoError(t, err)
	require.Equal(t, HTMLMeta{Favicon: "https://wiki.example.com/favicon.ico"}, *metadata)
}

func TestGetHTMLMetaKeepsOrdinaryRedirect(t *testing.T) {
	useFakeSite(t, map[string]fakePage{
		"https://example.com/a": {status: http.StatusMovedPermanently, location: "https://www.example.com/a"},
		"https://www.example.com/a": {
			status: http.StatusOK,
			body:   `<html><head><title>Article</title></head></html>`,
		},
	})

	metadata, err := GetHTMLMeta("https://example.com/a")
	require.NoError(t, err)
	require.Equal(t, "Article", metadata.Title)
	require.Equal(t, "https://www.example.com/favicon.ico", metadata.Favicon)
}

func TestGetHTMLMetaIgnoresErrorPages(t *testing.T) {
	useFakeSite(t, map[string]fakePage{
		"https://example.com/private": {status: http.StatusForbidden, body: `<html><head><title>403 Forbidden</title></head></html>`},
	})

	metadata, err := GetHTMLMeta("https://example.com/private")
	require.NoError(t, err)
	require.Equal(t, HTMLMeta{Favicon: "https://example.com/favicon.ico"}, *metadata)
}

func TestGetHTMLMetaForInternal(t *testing.T) {
	// test for internal IP
	if _, err := GetHTMLMeta("http://192.168.0.1"); !errors.Is(err, ErrInternalIP) {
		t.Errorf("Expected error for internal IP, got %v", err)
	}

	// test for resolved internal IP
	if _, err := GetHTMLMeta("http://localhost"); !errors.Is(err, ErrInternalIP) {
		t.Errorf("Expected error for resolved internal IP, got %v", err)
	}
}

func TestHTTPClientHasTimeout(t *testing.T) {
	require.NotZero(t, httpClient.Timeout)
}

func TestSecureDialContextRejectsResolvedInternalIP(t *testing.T) {
	originalLookupIPAddr := lookupIPAddr
	originalDialContext := dialContext
	t.Cleanup(func() {
		lookupIPAddr = originalLookupIPAddr
		dialContext = originalDialContext
	})

	lookupIPAddr = func(context.Context, string) ([]net.IPAddr, error) {
		return []net.IPAddr{{IP: net.ParseIP("127.0.0.1")}}, nil
	}
	dialContext = func(context.Context, string, string) (net.Conn, error) {
		t.Fatal("internal IP should be rejected before dialing")
		return nil, nil
	}

	_, err := secureDialContext(context.Background(), "tcp", "rebind.example:80")
	require.ErrorIs(t, err, ErrInternalIP)
}

func TestSecureDialContextDialsResolvedIP(t *testing.T) {
	originalLookupIPAddr := lookupIPAddr
	originalDialContext := dialContext
	t.Cleanup(func() {
		lookupIPAddr = originalLookupIPAddr
		dialContext = originalDialContext
	})

	lookupIPAddr = func(context.Context, string) ([]net.IPAddr, error) {
		return []net.IPAddr{{IP: net.ParseIP("93.184.216.34")}}, nil
	}

	var dialedAddress string
	dialContext = func(_ context.Context, _ string, address string) (net.Conn, error) {
		dialedAddress = address
		clientConn, serverConn := net.Pipe()
		t.Cleanup(func() {
			clientConn.Close()
			serverConn.Close()
		})
		return clientConn, nil
	}

	conn, err := secureDialContext(context.Background(), "tcp", "rebind.example:80")
	require.NoError(t, err)
	require.NotNil(t, conn)
	require.Equal(t, "93.184.216.34:80", dialedAddress)
}
