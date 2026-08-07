package oauth

import (
	"html/template"
	"net/http"
	"strings"

	"github.com/labstack/echo/v5"

	"github.com/usememos/memos/server/auth"
)

// The consent screen is server-rendered rather than a route in the React app.
// The OAuth redirect lands on the server, and an SPA route would mean shipping
// the whole bundle just to draw one dialog — and would make the "authorize"
// button depend on client-side routing at the exact moment correctness matters.
type consentPageData struct {
	ClientName string
	Username   string
	Scope      string
	// Params carries the authorization request back to the POST handler as
	// hidden form fields. They must not be smuggled through the form action's
	// query string: html/template escapes a value interpolated into a URL
	// attribute, turning "&"/"=" into %26/%3d, and the POST handler reads the
	// parameters from the form body anyway.
	Params []formField
}

type formField struct {
	Name  string
	Value string
}

var consentTemplate = template.Must(template.New("consent").Parse(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Authorize access</title>
<style>
:root { color-scheme: light dark; }
body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f6f6f7; color: #18181b; }
.card { width: min(420px, calc(100vw - 32px)); background: #fff; border: 1px solid #e4e4e7; border-radius: 12px; padding: 28px; }
h1 { font-size: 18px; margin: 0 0 6px; }
p { font-size: 14px; line-height: 1.6; color: #52525b; margin: 0 0 16px; }
strong { color: #18181b; }
ul { margin: 0 0 20px; padding-left: 18px; font-size: 14px; color: #52525b; }
li { margin-bottom: 4px; }
.actions { display: flex; gap: 10px; }
button { flex: 1; padding: 9px 14px; border-radius: 8px; font-size: 14px; cursor: pointer; border: 1px solid #d4d4d8; background: #fff; color: #18181b; }
button.primary { background: #18181b; border-color: #18181b; color: #fff; }
@media (prefers-color-scheme: dark) {
  body { background: #09090b; color: #fafafa; }
  .card { background: #18181b; border-color: #27272a; }
  strong { color: #fafafa; }
  p, ul { color: #a1a1aa; }
  button { background: #18181b; border-color: #3f3f46; color: #fafafa; }
  button.primary { background: #fafafa; border-color: #fafafa; color: #18181b; }
}
</style>
</head>
<body>
<div class="card">
  <h1>Authorize {{.ClientName}}</h1>
  <p><strong>{{.ClientName}}</strong> wants to access your knowledge base as <strong>{{.Username}}</strong>.</p>
  <ul>{{range .Permissions}}<li>{{.}}</li>{{end}}</ul>
  <form method="post" action="/oauth/authorize">
    {{range .Params}}<input type="hidden" name="{{.Name}}" value="{{.Value}}">
    {{end}}<div class="actions">
      <button type="submit" name="decision" value="deny">Deny</button>
      <button type="submit" name="decision" value="allow" class="primary">Authorize</button>
    </div>
  </form>
</div>
</body>
</html>`))

var errorTemplate = template.Must(template.New("error").Parse(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Authorization failed</title>
<style>
:root { color-scheme: light dark; }
body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f6f6f7; color: #18181b; }
.card { width: min(420px, calc(100vw - 32px)); background: #fff; border: 1px solid #e4e4e7; border-radius: 12px; padding: 28px; }
h1 { font-size: 18px; margin: 0 0 6px; }
p { font-size: 14px; line-height: 1.6; color: #52525b; margin: 0; }
@media (prefers-color-scheme: dark) {
  body { background: #09090b; color: #fafafa; }
  .card { background: #18181b; border-color: #27272a; }
  p { color: #a1a1aa; }
}
</style>
</head>
<body>
<div class="card">
  <h1>Authorization failed</h1>
  <p>{{.Message}}</p>
</div>
</body>
</html>`))

func renderConsentPage(c *echo.Context, data consentPageData) error {
	if data.ClientName == "" {
		data.ClientName = "An MCP client"
	}
	view := struct {
		consentPageData
		Permissions []string
	}{consentPageData: data, Permissions: describeScopes(data.Scope)}

	c.Response().Header().Set("Cache-Control", "no-store")
	c.Response().Header().Set("Content-Type", echo.MIMETextHTMLCharsetUTF8)
	c.Response().WriteHeader(http.StatusOK)
	return consentTemplate.Execute(c.Response(), view)
}

func renderErrorPage(c *echo.Context, statusCode int, message string) error {
	c.Response().Header().Set("Cache-Control", "no-store")
	c.Response().Header().Set("Content-Type", echo.MIMETextHTMLCharsetUTF8)
	c.Response().WriteHeader(statusCode)
	return errorTemplate.Execute(c.Response(), struct{ Message string }{Message: message})
}

func describeScopes(scope string) []string {
	permissions := []string{}
	for _, granted := range strings.Fields(scope) {
		switch granted {
		case auth.MCPScopeRead:
			permissions = append(permissions, "Read your workspaces, folders and documents")
		case auth.MCPScopeWrite:
			permissions = append(permissions, "Create and update documents")
		}
	}
	return permissions
}
