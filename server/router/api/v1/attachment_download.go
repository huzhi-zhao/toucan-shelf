package v1

import (
	"context"
	"net/url"
	"regexp"
	"strings"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/usememos/memos/internal/base"
	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/server/attachmentacl"
	"github.com/usememos/memos/server/auth"
	"github.com/usememos/memos/store"
)

// downloadableTypes is the set of attachment MIME types a download URL may be
// issued for. It is not a security boundary — the caller's read access is what
// decides that — but a usability one: the channel this exists for hands the URL
// to an agent that will fetch the file and try to read it, and handing it bytes
// nothing on its side can open wastes a round trip and ends in a confused
// "I downloaded it but cannot read it".
//
// Refusing early, with an explanation, is more useful than a URL that leads
// nowhere. Anything not listed here is the user's own job in the app.
//
//   - text/*: read directly.
//   - PDF: the reason the feature exists.
//   - png/jpeg/gif/webp: what an agent can actually decode. HEIC is deliberately
//     absent — it downloads fine and then cannot be opened.
//   - svg: text under the skin, and draw.io diagrams are stored as SVG
//     attachments with their source embedded, which makes them worth reading.
//   - Office formats are deliberately absent: .docx and friends are binary zip
//     containers that arrive unreadable, and the scenario is rare enough that
//     doing it by hand in the app is faster than the round trip.
var downloadableTypes = map[string]bool{
	"application/pdf": true,
	"image/png":       true,
	"image/jpeg":      true,
	"image/jpg":       true,
	"image/gif":       true,
	"image/webp":      true,
	"image/svg+xml":   true,
}

// attachmentRefRe recovers an attachment uid from anything shaped like the file
// route, whether site-relative, fully qualified, or wrapped in a markdown image
// reference. See GetDownloadUrlRequest.attachment for why the input is
// treated so leniently.
var attachmentRefRe = regexp.MustCompile(`/file/attachments/([A-Za-z0-9_-]+)`)

// GetDownloadUrl issues a short-lived URL for one attachment's bytes.
func (s *APIV1Service) GetDownloadUrl(ctx context.Context, request *v1pb.GetDownloadUrlRequest) (*v1pb.GetDownloadUrlResponse, error) {
	attachmentUID, err := resolveAttachmentReference(request.GetAttachment())
	if err != nil {
		return nil, err
	}
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}

	attachment, err := s.Store.GetAttachment(ctx, &store.FindAttachment{UID: &attachmentUID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get attachment: %v", err)
	}
	if attachment == nil {
		return nil, status.Errorf(codes.NotFound, "attachment not found")
	}

	// A locked attachment answers only to a browser session that has unlocked
	// the vault, which no token-authenticated caller can be. The access check
	// below would refuse it anyway; saying so plainly here is the difference
	// between a caller that can explain the situation to its user and one that
	// reports an unexplained permission error.
	if attachmentacl.EffectiveAccess(attachment) == storepb.AttachmentAccess_ACCESS_LOCKED {
		return nil, status.Errorf(codes.FailedPrecondition,
			"this attachment is locked in the owner's vault and can only be opened in a browser session after unlocking it")
	}
	if err := s.checkAttachmentAccess(ctx, attachment); err != nil {
		return nil, err
	}
	if !downloadableTypes[strings.ToLower(attachment.Type)] && !strings.HasPrefix(strings.ToLower(attachment.Type), "text/") {
		return nil, status.Errorf(codes.InvalidArgument,
			"attachments of type %q cannot be read over this channel; download it in the app instead", attachment.Type)
	}

	origin, err := s.downloadURLOrigin(ctx)
	if err != nil {
		return nil, err
	}
	token, expiresAt, err := auth.GenerateDownloadToken(user.ID, attachmentUID, []byte(s.Secret))
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to generate download token: %v", err)
	}

	return &v1pb.GetDownloadUrlResponse{
		Url: origin + "/file/attachments/" + url.PathEscape(attachmentUID) + "/" +
			url.PathEscape(attachment.Filename) + "?" + auth.DownloadTokenQueryParam + "=" + url.QueryEscape(token),
		Name:       "attachments/" + attachmentUID,
		Filename:   attachment.Filename,
		Type:       attachment.Type,
		Size:       attachment.Size,
		ExpireTime: timestamppb.New(expiresAt),
	}, nil
}

// downloadURLOrigin decides what an absolute URL back to this instance starts
// with. InstanceURL is authoritative when set; otherwise the origin the request
// actually arrived on is used, which is what makes the feature work on an
// instance that leaves InstanceURL blank on purpose — setting it would also
// turn anonymous access on (profile.AllowAnonymous), so "just configure it" is
// not a free instruction.
func (s *APIV1Service) downloadURLOrigin(ctx context.Context) (string, error) {
	if instanceURL := strings.TrimRight(strings.TrimSpace(s.Profile.InstanceURL), "/"); instanceURL != "" {
		return instanceURL, nil
	}
	if origin := strings.TrimRight(base.RequestOrigin(ctx), "/"); origin != "" {
		return origin, nil
	}
	return "", status.Errorf(codes.FailedPrecondition,
		"this instance cannot build absolute download URLs; set the instance URL in settings")
}

// resolveAttachmentReference turns whatever the caller passed into an
// attachment uid.
func resolveAttachmentReference(reference string) (string, error) {
	reference = strings.TrimSpace(reference)
	if reference == "" {
		return "", status.Errorf(codes.InvalidArgument, "attachment is required")
	}
	// A file-route URL in any wrapping: markdown reference, bare path, or fully
	// qualified. Checked first because such a string also contains the literal
	// "attachments/", which the resource-name branch below would otherwise
	// happily mis-read together with the trailing filename.
	if m := attachmentRefRe.FindStringSubmatch(reference); m != nil {
		return m[1], nil
	}
	if uid, err := ExtractAttachmentUIDFromName(reference); err == nil && uid != "" {
		return uid, nil
	}
	// A bare uid, which is what a caller that stripped the prefix itself sends.
	if !strings.ContainsAny(reference, "/ ") {
		return reference, nil
	}
	return "", status.Errorf(codes.InvalidArgument,
		"could not tell which attachment %q refers to; pass its resource name (attachments/{uid}) or the link copied from the app", reference)
}
