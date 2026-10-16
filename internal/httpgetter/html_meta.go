package httpgetter

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/pkg/errors"
	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

var ErrInternalIP = errors.New("internal IP addresses are not allowed")

const maxHTMLMetaBytes = 512 * 1024

var (
	lookupIPAddr = net.DefaultResolver.LookupIPAddr
	dialContext  = (&net.Dialer{
		Timeout:   30 * time.Second,
		KeepAlive: 30 * time.Second,
	}).DialContext
	httpClient = newHTTPClient()
)

func newHTTPClient() *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.DialContext = secureDialContext

	return &http.Client{
		Transport: transport,
		Timeout:   5 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if err := validateURL(req.URL.String()); err != nil {
				return errors.Wrap(err, "redirect to internal IP")
			}
			if len(via) >= 10 {
				return errors.New("too many redirects")
			}
			return nil
		},
	}
}

func secureDialContext(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, errors.Wrap(err, "invalid address")
	}

	ips, err := resolveAllowedIPs(ctx, host)
	if err != nil {
		return nil, err
	}

	var dialErr error
	for _, ip := range ips {
		conn, err := dialContext(ctx, network, net.JoinHostPort(ip.String(), port))
		if err == nil {
			return conn, nil
		}
		dialErr = err
	}
	return nil, dialErr
}

func resolveAllowedIPs(ctx context.Context, host string) ([]net.IP, error) {
	if ip := net.ParseIP(host); ip != nil {
		if isInternalIP(ip) {
			return nil, errors.Wrap(ErrInternalIP, ip.String())
		}
		return []net.IP{ip}, nil
	}

	addrs, err := lookupIPAddr(ctx, host)
	if err != nil {
		return nil, errors.Errorf("failed to resolve hostname: %v", err)
	}

	ips := make([]net.IP, 0, len(addrs))
	for _, addr := range addrs {
		ip := addr.IP
		if ip == nil {
			continue
		}
		if isInternalIP(ip) {
			return nil, errors.Wrapf(ErrInternalIP, "host=%s, ip=%s", host, ip.String())
		}
		ips = append(ips, ip)
	}
	if len(ips) == 0 {
		return nil, errors.New("hostname resolved to no addresses")
	}

	return ips, nil
}

func isInternalIP(ip net.IP) bool {
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsUnspecified()
}

func validateURL(urlStr string) error {
	u, err := url.Parse(urlStr)
	if err != nil {
		return errors.New("invalid URL format")
	}

	if u.Scheme != "http" && u.Scheme != "https" {
		return errors.New("only http/https protocols are allowed")
	}

	host := u.Hostname()
	if host == "" {
		return errors.New("empty hostname")
	}

	if ip := net.ParseIP(host); ip != nil && isInternalIP(ip) {
		return errors.Wrap(ErrInternalIP, ip.String())
	}

	return nil
}

type HTMLMeta struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Image       string `json:"image"`
	// Favicon is the site icon URL. It is always set: the page's declared icon
	// when the page could be read, otherwise the site's /favicon.ico, which may
	// not exist — callers fall back on load error.
	Favicon string `json:"favicon"`
}

// GetHTMLMeta fetches a page and reads its preview metadata.
//
// A page that answers with an error status, or that redirected the request to
// a sign-in page, yields only a favicon: its title would be "Sign in" or
// "403 Forbidden", which describes the wall rather than the linked document.
// Links to private documents (a Google Doc the server is not signed in to) hit
// this on every fetch, so the result still has to look like the link — the
// favicon is then taken from the site the link points at, not the login host.
func GetHTMLMeta(urlStr string) (*HTMLMeta, error) {
	if err := validateURL(urlStr); err != nil {
		return nil, err
	}
	requested, err := url.Parse(urlStr)
	if err != nil {
		return nil, errors.New("invalid URL format")
	}

	response, err := httpClient.Get(urlStr)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()

	final := response.Request.URL
	if response.StatusCode < 200 || response.StatusCode > 299 || isSignInRedirect(requested, final) {
		return &HTMLMeta{Favicon: defaultFavicon(requested)}, nil
	}

	mediatype, err := getMediatype(response)
	if err != nil {
		return nil, err
	}
	if mediatype != "text/html" {
		return nil, errors.New("not a HTML page")
	}

	htmlMeta, iconHref := extractHTMLMetaAndIcon(io.LimitReader(response.Body, maxHTMLMetaBytes))
	htmlMeta.Favicon = resolveFavicon(final, iconHref)
	enrichSiteMeta(response.Request.URL, htmlMeta)
	return htmlMeta, nil
}

// signInHostPrefixes are the first host labels of dedicated login hosts
// (accounts.google.com, login.microsoftonline.com, sso.example.com).
var signInHostPrefixes = map[string]bool{
	"accounts": true,
	"login":    true,
	"signin":   true,
	"auth":     true,
	"sso":      true,
}

// signInPathSegments are path segments that mark a login page, compared
// lowercased with any extension stripped (/login, /ServiceLogin,
// /v3/signin/identifier, /login.action).
var signInPathSegments = map[string]bool{
	"login":        true,
	"log-in":       true,
	"signin":       true,
	"sign-in":      true,
	"sign_in":      true,
	"servicelogin": true,
	"sso":          true,
	"oauth":        true,
	"oauth2":       true,
	"authorize":    true,
}

// isSignInRedirect reports whether fetching requested ended on a login page.
// Only a redirect counts: a link that points straight at a login page is what
// its author chose to link to.
func isSignInRedirect(requested, final *url.URL) bool {
	if final == nil || final.String() == requested.String() {
		return false
	}
	host := strings.ToLower(final.Hostname())
	if first, _, ok := strings.Cut(host, "."); ok && signInHostPrefixes[first] {
		return true
	}
	for _, segment := range strings.Split(strings.ToLower(final.Path), "/") {
		if dot := strings.IndexByte(segment, '.'); dot > 0 {
			segment = segment[:dot]
		}
		if signInPathSegments[segment] {
			return true
		}
	}
	return false
}

// defaultFavicon is the conventional icon location of the site u is on.
func defaultFavicon(u *url.URL) string {
	return (&url.URL{Scheme: u.Scheme, Host: u.Host, Path: "/favicon.ico"}).String()
}

// resolveFavicon turns the page's declared icon href into an absolute http(s)
// URL against the page it came from, falling back to the site's /favicon.ico.
func resolveFavicon(page *url.URL, iconHref string) string {
	if iconHref != "" {
		if ref, err := url.Parse(strings.TrimSpace(iconHref)); err == nil {
			if resolved := page.ResolveReference(ref); resolved.Scheme == "http" || resolved.Scheme == "https" {
				return resolved.String()
			}
		}
	}
	return defaultFavicon(page)
}

// extractHTMLMetaAndIcon reads the head's preview metadata and the href of its
// declared icon: a rel="icon" link (including "shortcut icon") wins over an
// apple-touch-icon. The href is returned as written, unresolved.
func extractHTMLMetaAndIcon(resp io.Reader) (*HTMLMeta, string) {
	tokenizer := html.NewTokenizer(resp)
	htmlMeta := new(HTMLMeta)
	var icon, touchIcon string

	for {
		tokenType := tokenizer.Next()
		if tokenType == html.ErrorToken {
			break
		} else if tokenType == html.StartTagToken || tokenType == html.SelfClosingTagToken {
			token := tokenizer.Token()
			if token.DataAtom == atom.Body {
				break
			}

			if token.DataAtom == atom.Link {
				rel, href := linkRelAndHref(token)
				switch {
				case href == "":
				case icon == "" && hasRelToken(rel, "icon"):
					icon = href
				case touchIcon == "" && (hasRelToken(rel, "apple-touch-icon") || hasRelToken(rel, "apple-touch-icon-precomposed")):
					touchIcon = href
				default:
				}
			} else if token.DataAtom == atom.Title {
				tokenizer.Next()
				token := tokenizer.Token()
				htmlMeta.Title = token.Data
			} else if token.DataAtom == atom.Meta {
				ogTitle, ok := extractMetaProperty(token, "og:title")
				if ok {
					htmlMeta.Title = ogTitle
				}

				ogDescription, ok := extractMetaProperty(token, "og:description")
				if ok {
					htmlMeta.Description = ogDescription
				}

				ogImage, ok := extractMetaProperty(token, "og:image")
				if ok {
					htmlMeta.Image = ogImage
				}

				description, ok := extractMetaProperty(token, "description")
				if ok && htmlMeta.Description == "" {
					htmlMeta.Description = description
				}
			}
		}
	}

	if icon == "" {
		icon = touchIcon
	}
	return htmlMeta, icon
}

func linkRelAndHref(token html.Token) (rel, href string) {
	for _, attr := range token.Attr {
		switch attr.Key {
		case "rel":
			rel = attr.Val
		case "href":
			href = attr.Val
		default:
		}
	}
	return rel, href
}

// hasRelToken reports whether the space-separated rel value contains want.
func hasRelToken(rel, want string) bool {
	for _, token := range strings.Fields(rel) {
		if strings.EqualFold(token, want) {
			return true
		}
	}
	return false
}

func extractMetaProperty(token html.Token, prop string) (content string, ok bool) {
	content, ok = "", false
	for _, attr := range token.Attr {
		if (attr.Key == "property" || attr.Key == "name") && strings.EqualFold(attr.Val, prop) {
			ok = true
		}
		if attr.Key == "content" {
			content = attr.Val
		}
	}
	return content, ok
}

func enrichSiteMeta(url *url.URL, meta *HTMLMeta) {
	if url.Hostname() == "www.youtube.com" {
		if url.Path == "/watch" {
			vid := url.Query().Get("v")
			if vid != "" {
				meta.Image = fmt.Sprintf("https://img.youtube.com/vi/%s/mqdefault.jpg", vid)
			}
		}
	}
}
