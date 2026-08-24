package server

import (
	"github.com/labstack/echo/v5"

	apiv1 "github.com/usememos/memos/server/router/api/v1"
)

// newOriginalHostMiddleware records the Host the request arrived on in a header,
// so the request's own hostname survives into the RPC layer.
//
// A published site is identified by the domain the reader typed. Go's HTTP server
// keeps Host on the request struct rather than in the header map, and neither
// Connect's header view nor the gRPC gateway's metadata carries it, so it has to
// be stamped in here — before anything else looks at the request. A client-sent
// value is overwritten rather than trusted: it decides which site's content is
// served.
func newOriginalHostMiddleware() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error {
			c.Request().Header.Set(apiv1.OriginalHostHeader, c.Request().Host)
			return next(c)
		}
	}
}
