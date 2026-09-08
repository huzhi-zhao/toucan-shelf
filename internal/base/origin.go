package base

import "context"

type requestOriginContextKey struct{}

// WithRequestOrigin records the scheme+host a request actually arrived on
// ("https://kb.example.com"), for the rare case where a handler must build an
// absolute URL back to this instance.
//
// It exists for the MCP channel. An MCP tool call is replayed against the same
// Echo server through a synthetic in-process request, whose Host is a stand-in
// rather than the real one, so a handler serving that call cannot recover the
// instance's address from the request the way an ordinary HTTP handler can.
// InstanceURL is the first choice everywhere; this is the fallback for
// instances that deliberately leave it unset — configuring it is not free,
// since it also switches anonymous access on (see profile.AllowAnonymous).
//
// Carried on the context rather than a header for the same reason ActorKind is:
// the synthetic request is served by the Echo server that serves public
// traffic, so a header would be indistinguishable from one a remote client set
// on itself. A context value can only be set in-process.
func WithRequestOrigin(ctx context.Context, origin string) context.Context {
	if origin == "" {
		return ctx
	}
	return context.WithValue(ctx, requestOriginContextKey{}, origin)
}

// RequestOrigin returns the origin recorded by WithRequestOrigin, or "" when
// nothing recorded one.
func RequestOrigin(ctx context.Context) string {
	origin, _ := ctx.Value(requestOriginContextKey{}).(string)
	return origin
}
