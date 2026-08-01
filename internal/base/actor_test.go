package base

import (
	"context"
	"testing"
)

func TestActorKindFromContextDefaultsToHuman(t *testing.T) {
	// The zero value has to mean "human": an unmarked write is anything from a
	// web session to a memogit push, and treating those as agent writes would
	// skip the baseline snapshot that protects them.
	if got := ActorKindFromContext(context.Background()); got != ActorKindHuman {
		t.Fatalf("unmarked context: got %v, want ActorKindHuman", got)
	}
	if ActorKindFromContext(context.Background()).IsAgent() {
		t.Fatal("unmarked context must not report as agent")
	}
}

func TestWithActorKindRoundTrips(t *testing.T) {
	ctx := WithActorKind(context.Background(), ActorKindAgent)
	if got := ActorKindFromContext(ctx); got != ActorKindAgent {
		t.Fatalf("got %v, want ActorKindAgent", got)
	}
	if !ActorKindFromContext(ctx).IsAgent() {
		t.Fatal("agent context must report as agent")
	}

	// A human write nested inside an agent-marked context wins for its own scope.
	human := WithActorKind(ctx, ActorKindHuman)
	if got := ActorKindFromContext(human); got != ActorKindHuman {
		t.Fatalf("got %v, want ActorKindHuman", got)
	}
}

func TestActorKindIgnoresForeignContextValues(t *testing.T) {
	// A value stored under a different key type must not be readable as an actor
	// kind — this is what keeps the marker unforgeable from outside the package.
	type otherKey struct{}
	ctx := context.WithValue(context.Background(), otherKey{}, ActorKindAgent)
	if got := ActorKindFromContext(ctx); got != ActorKindHuman {
		t.Fatalf("got %v, want ActorKindHuman", got)
	}
}
