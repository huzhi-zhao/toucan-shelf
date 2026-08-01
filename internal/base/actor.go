package base

import "context"

// ActorKind describes who authored a write, in the sense that matters for
// version history: not which user account it was — an MCP call carries the
// user's own personal access token, so the creator ID is identical to their web
// session — but whether the content was produced by a human or by an agent.
//
// The discriminator is therefore the channel a request arrived on, not the
// identity it carries. See docs/plans/2026-07-31-mcp-agent-authoring/
// requirement.md ADR-4.
type ActorKind int

const (
	// ActorKindHuman is the default, and deliberately so: anything not
	// positively identified as an agent channel counts as human, including
	// scripts driving the REST API with a personal access token, and memogit
	// pushing locally edited files back. Misreading an agent as a human costs
	// one redundant snapshot; misreading a human as an agent loses the baseline
	// the snapshot exists to protect, so the default has to lean this way.
	ActorKindHuman ActorKind = iota
	// ActorKindAgent is a write that arrived over the MCP channel.
	ActorKindAgent
)

func (k ActorKind) IsAgent() bool {
	return k == ActorKindAgent
}

type actorKindContextKey struct{}

// WithActorKind marks a context as originating from the given channel.
//
// This is a context value rather than an HTTP header on purpose. The MCP
// adapter reaches the API by running an in-process request against the same
// Echo server that serves public traffic, so a header marker would be
// indistinguishable from one a remote client sent itself — and grpc-gateway's
// default header matcher would drop a custom header anyway, silently. A context
// value cannot cross the network, so only in-process callers can set it.
func WithActorKind(ctx context.Context, kind ActorKind) context.Context {
	return context.WithValue(ctx, actorKindContextKey{}, kind)
}

// ActorKindFromContext reports the channel a request arrived on, defaulting to
// ActorKindHuman when nothing marked it.
func ActorKindFromContext(ctx context.Context) ActorKind {
	kind, ok := ctx.Value(actorKindContextKey{}).(ActorKind)
	if !ok {
		return ActorKindHuman
	}
	return kind
}
