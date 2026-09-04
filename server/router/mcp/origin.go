package mcp

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/usememos/memos/internal/profile"
)

// requestOrigin reconstructs the scheme+host this request reached the instance
// on, so a tool handler can build an absolute URL back to it.
//
// X-Forwarded-Proto wins because memos is typically served behind a reverse
// proxy terminating TLS, which leaves r.TLS nil on an https request; without it
// every generated URL on such an instance would come out http:// and either
// break or downgrade. The header is only as trustworthy as the proxy in front,
// which is the same assumption the rest of the stack already makes about it.
func requestOrigin(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	if forwarded := r.Header.Get("X-Forwarded-Proto"); forwarded != "" {
		if first, _, _ := strings.Cut(forwarded, ","); strings.TrimSpace(first) != "" {
			scheme = strings.ToLower(strings.TrimSpace(first))
		}
	}
	if r.Host == "" {
		return ""
	}
	return scheme + "://" + r.Host
}

func isAllowedMCPOrigin(host string, origin string, profile *profile.Profile) bool {
	if origin == "" {
		return true
	}

	originURL, err := url.Parse(origin)
	if err != nil || originURL.Scheme == "" || originURL.Host == "" {
		return false
	}
	if strings.EqualFold(originURL.Host, host) {
		return true
	}

	if profile == nil || profile.InstanceURL == "" {
		return false
	}
	instanceURL, err := url.Parse(profile.InstanceURL)
	if err != nil || instanceURL.Scheme == "" || instanceURL.Host == "" {
		return false
	}
	return strings.EqualFold(originURL.Scheme, instanceURL.Scheme) && strings.EqualFold(originURL.Host, instanceURL.Host)
}
