// Package attachmentacl holds the one decision that answers "may this request read
// this attachment?".
//
// There are two ways to reach an attachment — the binary download at
// /file/attachments/{uid}/{filename} and the AttachmentService/GetAttachment metadata
// call — and they used to carry two separate implementations of that decision. They
// drifted: only the file server honoured the anonymous-access gate and share tokens.
// Both now call CheckReadAccess, and the things that genuinely differ between them
// (where the user comes from, whether a share token can be present) arrive as fields
// rather than as a second copy of the logic.
//
// The rule is "an attachment is exactly as reachable as the document it hangs on",
// which means it mirrors the document side's checkMemoReadAccess: the recycle bin
// hides a document's files along with its body, a comment answers to its parent as
// well as to itself, and an admin gets no read privilege — the document side grants
// none, so granting it here would let an admin download a private document they
// cannot open — except for the team owner, whose access to every knowledge base
// (and to PRIVATE documents in them) the document side does grant.
package attachmentacl

import (
	"context"
	"time"

	"github.com/pkg/errors"

	"github.com/usememos/memos/store"
)

// The three ways a check can say no. Callers translate them into their own transport's
// error type; any other error returned by CheckReadAccess is an internal failure and
// should become a 500 / codes.Internal.
//
// The difference between ErrNotFound and ErrForbidden is deliberate: a document in the
// recycle bin reports as missing rather than as refused, matching how the document side
// and the share page talk about it.
var (
	ErrNotFound        = errors.New("attachment not found")
	ErrUnauthenticated = errors.New("user not authenticated")
	ErrForbidden       = errors.New("permission denied")
)

// Request carries everything the decision needs beyond the attachment itself.
type Request struct {
	Store *store.Store

	// CurrentUser resolves the request's authenticated user, returning (nil, nil) for
	// an anonymous request. It is called at most once per check, and not at all when a
	// public document on an open instance already settles the answer — so the common
	// case of an anonymous visitor loading images off a public page costs no user
	// lookup.
	CurrentUser func(ctx context.Context) (*store.User, error)

	// AllowAnonymous mirrors profile.Profile.AllowAnonymous(). On an instance with no
	// InstanceURL configured there are no anonymous visitors, so even a PUBLIC
	// document's files require a signed-in viewer.
	AllowAnonymous bool

	// ShareToken is the share_token the request carried, empty when it carried none.
	// Only the file server can have one: the shared-document page reads its
	// attachments off GetMemoByShare, never through GetAttachment.
	ShareToken string

	// VaultUnlocked reports whether the request may unlock a *locked* attachment
	// creator-owned by userID — i.e. whether it carries a valid vault cookie over
	// a browser session (see auth.VaultUnlocked). Called at most once, only after
	// the creator check has already passed, so it never runs for anonymous
	// visitors, for someone else's attachment, or for a non-locked one. A nil
	// func fails closed: every locked attachment becomes unreadable rather than
	// silently skipping the check.
	VaultUnlocked func(userID int32) bool
}

// CheckReadAccess reports whether the request may read the attachment, returning nil
// when it may and one of the sentinels above when it may not.
func CheckReadAccess(ctx context.Context, req *Request, attachment *store.Attachment) error {
	user := lazyUser(ctx, req.CurrentUser)

	// A locked attachment answers to nothing else: not the document it hangs on,
	// not the recycle bin, not a share token, not anonymous/PUBLIC access, and not
	// admin privilege. This has to run before every other branch below, including
	// the unattached-attachment one, because "locked" overrides "unattached but
	// owned by me" too.
	if attachment.Payload.GetLocked() {
		return checkVaultAccess(req, attachment, user)
	}

	// An attachment not yet linked to a document has no visibility to inherit, so it
	// belongs to whoever uploaded it and to nobody else.
	if attachment.MemoID == nil {
		u, err := user()
		if err != nil {
			return err
		}
		if u == nil {
			return ErrUnauthenticated
		}
		if u.ID != attachment.CreatorID {
			return ErrForbidden
		}
		return nil
	}

	memo, err := req.Store.GetMemo(ctx, &store.FindMemo{ID: attachment.MemoID})
	if err != nil {
		return errors.Wrap(err, "failed to get memo")
	}
	if memo == nil {
		return ErrNotFound
	}

	// A comment answers to the document it comments on as well as to itself. Its own
	// visibility is a snapshot taken when it was created, so a parent tightened
	// afterwards leaves the comment holding a looser value than it should. The
	// relation is memo_relation type COMMENT and is exactly one level deep — there is
	// no chain to walk and no cycle to guard against.
	var parent *store.Memo
	if memo.ParentUID != nil {
		parent, err = req.Store.GetMemo(ctx, &store.FindMemo{UID: memo.ParentUID})
		if err != nil {
			return errors.Wrap(err, "failed to get parent memo")
		}
		if parent == nil {
			return ErrNotFound
		}
	}
	chain := []*store.Memo{memo, parent}

	// The recycle bin comes first, ahead of both visibility and the share token: a
	// document in it is gone as far as anyone but its creator is concerned, and its
	// files go with it. Without this a PUBLIC document deleted into the bin kept
	// serving every file it carried.
	for _, m := range chain {
		if m == nil || m.RowStatus != store.Archived {
			continue
		}
		u, err := user()
		if err != nil {
			return err
		}
		if u == nil || m.CreatorID != u.ID {
			return ErrNotFound
		}
	}

	// A share token stands in for the reader's identity, but only for the exact
	// document it was minted for.
	if req.ShareToken != "" && hasValidShare(ctx, req, memo.ID) {
		return nil
	}

	for _, m := range chain {
		if m == nil {
			continue
		}
		if err := checkVisibility(ctx, req, m, user); err != nil {
			return err
		}
	}
	return nil
}

// checkVaultAccess is the entire read decision for a locked attachment: creator
// only, and only with a valid vault unlock for that exact user.
func checkVaultAccess(req *Request, attachment *store.Attachment, user func() (*store.User, error)) error {
	u, err := user()
	if err != nil {
		return err
	}
	if u == nil {
		return ErrUnauthenticated
	}
	if u.ID != attachment.CreatorID {
		return ErrForbidden
	}
	if req.VaultUnlocked == nil || !req.VaultUnlocked(u.ID) {
		return ErrForbidden
	}
	return nil
}

// checkVisibility is the document side's visibility rule, minus the recycle-bin branch
// that CheckReadAccess already applied to the whole chain at once.
func checkVisibility(ctx context.Context, req *Request, memo *store.Memo, user func() (*store.User, error)) error {
	if memo.Visibility == store.Public && req.AllowAnonymous {
		return nil
	}
	u, err := user()
	if err != nil {
		return err
	}
	if u == nil {
		return ErrUnauthenticated
	}
	// The knowledge base gates the document, and therefore its files: otherwise
	// holding an attachment URL would be a way around never having been granted the
	// knowledge base it lives in.
	access, err := req.Store.ResolveWorkspaceAccess(ctx, u, memo.WorkspaceID)
	if err != nil {
		return errors.Wrap(err, "failed to resolve workspace access")
	}
	if !access.CanRead() {
		return ErrNotFound
	}
	// The team owner reads everything, matching checkMemoReadAccess's PRIVATE branch.
	if memo.Visibility == store.Private && memo.CreatorID != u.ID && !store.IsTeamOwner(u) {
		return ErrForbidden
	}
	return nil
}

// hasValidShare reports whether the request's share token is a live share of this
// exact document.
func hasValidShare(ctx context.Context, req *Request, memoID int32) bool {
	share, err := req.Store.GetMemoShare(ctx, &store.FindMemoShare{UID: &req.ShareToken})
	if err != nil || share == nil || share.MemoID != memoID {
		return false
	}
	return share.ExpiresTs == nil || time.Now().Unix() <= *share.ExpiresTs
}

// lazyUser wraps the user resolver so a check that consults the viewer several times
// (chain member, then share fallback) still authenticates once, and a check that never
// needs one never authenticates at all.
func lazyUser(ctx context.Context, resolve func(ctx context.Context) (*store.User, error)) func() (*store.User, error) {
	var (
		user   *store.User
		loaded bool
	)
	return func() (*store.User, error) {
		if loaded {
			return user, nil
		}
		u, err := resolve(ctx)
		if err != nil {
			return nil, errors.Wrap(err, "failed to get current user")
		}
		user, loaded = u, true
		return user, nil
	}
}
