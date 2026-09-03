package v1

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/xml"
	"fmt"
	"image"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/disintegration/imaging"
	"github.com/pkg/errors"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/usememos/memos/internal/filter"
	"github.com/usememos/memos/internal/motionphoto"
	"github.com/usememos/memos/internal/profile"
	"github.com/usememos/memos/internal/storage/attachmentpath"
	"github.com/usememos/memos/internal/storage/s3"
	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/server/attachmentacl"
	"github.com/usememos/memos/server/auth"
	"github.com/usememos/memos/store"
)

const (
	// The upload memory buffer is 100 MiB.
	// It should be kept low, so RAM usage doesn't get out of control.
	// This is unrelated to maximum upload size limit, which is now set through system setting.
	MaxUploadBufferSizeBytes = 100 << 20
	MebiByte                 = 1024 * 1024
	// ThumbnailCacheFolder is the folder name where the thumbnail images are stored.
	ThumbnailCacheFolder = ".thumbnail_cache"

	// defaultJPEGQuality is the JPEG quality used when re-encoding images for EXIF stripping.
	// Quality 95 maintains visual quality while ensuring metadata is removed.
	defaultJPEGQuality        = 95
	maxBatchDeleteAttachments = 100
	maxImagePixels            = 50_000_000

	// maxMediaAttachmentSizeBytes caps image/video/audio uploads at 100 MiB,
	// independent of (and tighter than) the instance-wide UploadSizeLimitMb.
	maxMediaAttachmentSizeBytes = 100 * MebiByte
)

// isMediaMimeType reports whether t is an image/video/audio MIME type.
func isMediaMimeType(t string) bool {
	return strings.HasPrefix(t, "image/") || strings.HasPrefix(t, "video/") || strings.HasPrefix(t, "audio/")
}

var SupportedThumbnailMimeTypes = []string{
	"image/png",
	"image/jpeg",
}

// exifCapableImageTypes defines image formats that may contain EXIF metadata.
// These formats will have their EXIF metadata stripped on upload for privacy.
var exifCapableImageTypes = map[string]bool{
	"image/jpeg": true,
	"image/jpg":  true,
	"image/tiff": true,
	"image/webp": true,
	"image/heic": true,
	"image/heif": true,
}

// validateAttachmentContentSize applies the instance upload limit and the tighter media cap to
// a blob, returning its size. Shared by the upload path and the in-place overwrite path so an
// overwrite can never smuggle in bytes an upload of the same file would have rejected.
func (s *APIV1Service) validateAttachmentContentSize(ctx context.Context, mimeType string, content []byte) (int64, error) {
	instanceStorageSetting, err := s.Store.GetInstanceStorageSetting(ctx)
	if err != nil {
		return 0, status.Errorf(codes.Internal, "failed to get instance storage setting: %v", err)
	}
	size := binary.Size(content)
	uploadSizeLimit := int(instanceStorageSetting.UploadSizeLimitMb) * MebiByte
	if uploadSizeLimit == 0 {
		uploadSizeLimit = MaxUploadBufferSizeBytes
	}
	if size > uploadSizeLimit {
		return 0, status.Errorf(codes.InvalidArgument, "file size exceeds the limit")
	}
	if isMediaMimeType(mimeType) && size > maxMediaAttachmentSizeBytes {
		return 0, status.Errorf(codes.InvalidArgument, "media file size exceeds the 100MB limit")
	}
	return int64(size), nil
}

// stripExifIfNeeded removes EXIF metadata (GPS, device details) from image blobs for privacy.
// Returns the blob unchanged when the format can't carry EXIF, when the file is an Android
// motion container (re-encoding would drop the embedded video), or when stripping fails —
// a metadata-stripping failure must not fail the write.
func (s *APIV1Service) stripExifIfNeeded(ctx context.Context, blob []byte, mimeType, filename string, motionMedia *storepb.MotionMedia) ([]byte, error) {
	if !shouldStripExif(mimeType) || isAndroidMotionContainer(motionMedia) {
		return blob, nil
	}
	release, err := s.acquireImageProcessingSlot(ctx)
	if err != nil {
		return nil, status.Errorf(codes.ResourceExhausted, "too many image processing requests")
	}
	stripped, stripErr := stripImageExif(blob, mimeType)
	release()
	if stripErr != nil {
		slog.Warn("failed to strip EXIF metadata from image",
			slog.String("type", mimeType),
			slog.String("filename", filename),
			slog.String("error", stripErr.Error()))
		return blob, nil
	}
	return stripped, nil
}

func (s *APIV1Service) CreateAttachment(ctx context.Context, request *v1pb.CreateAttachmentRequest) (*v1pb.Attachment, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}

	// Validate required fields
	if request.Attachment == nil {
		return nil, status.Errorf(codes.InvalidArgument, "attachment is required")
	}
	if request.Attachment.Filename == "" {
		return nil, status.Errorf(codes.InvalidArgument, "filename is required")
	}
	if !validateFilename(request.Attachment.Filename) {
		return nil, status.Errorf(codes.InvalidArgument, "filename contains invalid characters or format")
	}
	normalizedMimeType := request.Attachment.Type
	if normalizedMimeType == "" {
		ext := filepath.Ext(request.Attachment.Filename)
		mimeType := mime.TypeByExtension(ext)
		if mimeType == "" {
			mimeType = http.DetectContentType(request.Attachment.Content)
		}
		if normalizedType, ok := normalizeMimeType(mimeType); ok {
			normalizedMimeType = normalizedType
		}
	}
	if normalizedMimeType == "" {
		normalizedMimeType = "application/octet-stream"
	}
	normalizedType, ok := normalizeMimeType(normalizedMimeType)
	if !ok {
		return nil, status.Errorf(codes.InvalidArgument, "invalid MIME type format")
	}
	request.Attachment.Type = normalizedType

	attachmentUID, err := ValidateAndGenerateUID(request.AttachmentId)
	if err != nil {
		return nil, err
	}

	create := &store.Attachment{
		UID:       attachmentUID,
		CreatorID: user.ID,
		Filename:  request.Attachment.Filename,
		Type:      request.Attachment.Type,
	}

	inputMotionMedia, err := validateClientMotionMedia(request.Attachment.MotionMedia, attachmentUID)
	if err != nil {
		return nil, err
	}
	if inputMotionMedia != nil {
		create.Payload = ensureAttachmentPayload(create.Payload)
		create.Payload.MotionMedia = inputMotionMedia
	}

	if origin := convertAttachmentOriginToStore(request.Attachment.Origin); origin != storepb.AttachmentOrigin_ATTACHMENT_ORIGIN_UNSPECIFIED {
		create.Payload = ensureAttachmentPayload(create.Payload)
		create.Payload.Origin = origin
	}

	size, err := s.validateAttachmentContentSize(ctx, request.Attachment.Type, request.Attachment.Content)
	if err != nil {
		return nil, err
	}
	create.Size = size
	create.Blob = request.Attachment.Content

	// Set when the upload names a memo, so the blob can inherit that memo's workspace
	// directory even if the caller didn't pass `workspace` explicitly.
	var memoWorkspaceID *int32
	if request.Attachment.Memo != nil {
		memoUID, err := ExtractMemoUIDFromName(*request.Attachment.Memo)
		if err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "invalid memo name: %v", err)
		}
		memo, err := s.Store.GetMemo(ctx, &store.FindMemo{UID: &memoUID})
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to find memo: %v", err)
		}
		if memo == nil {
			return nil, status.Errorf(codes.NotFound, "memo not found: %s", *request.Attachment.Memo)
		}
		if err := s.checkMemoWriteAccess(ctx, user, memo); err != nil {
			return nil, err
		}
		create.MemoID = &memo.ID
		memoWorkspaceID = &memo.WorkspaceID
	}

	workspaceSlug, err := s.resolveAttachmentWorkspaceSlug(ctx, user.ID, request.Workspace, memoWorkspaceID)
	if err != nil {
		return nil, err
	}

	if create.Payload == nil || create.Payload.MotionMedia == nil {
		if detectedMotion := detectAndroidMotionMedia(create.Blob, create.Type, attachmentUID); detectedMotion != nil {
			create.Payload = ensureAttachmentPayload(create.Payload)
			create.Payload.MotionMedia = detectedMotion
		}
	}

	strippedBlob, err := s.stripExifIfNeeded(ctx, create.Blob, create.Type, create.Filename, create.Payload.GetMotionMedia())
	if err != nil {
		return nil, err
	}
	create.Blob = strippedBlob
	create.Size = int64(len(strippedBlob))

	if err := SaveAttachmentBlob(ctx, s.Profile, s.Store, create, workspaceSlug); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to save attachment blob: %v", err)
	}

	attachment, err := s.Store.CreateAttachment(ctx, create)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to create attachment: %v", err)
	}

	return convertAttachmentFromStore(attachment), nil
}

// resolveAttachmentWorkspaceSlug decides which workspace directory an upload is stored under.
//
// An explicitly named workspace wins and is validated: a name that doesn't resolve, or that
// belongs to someone else, is an error rather than a silent fallback — writing a blob into the
// wrong knowledge base's directory would quietly defeat the isolation the directory is for.
// Failing that, the memo the upload is attached to supplies the workspace. With neither, the
// caller genuinely has no workspace and the blob goes to the shared fallback prefix.
func (s *APIV1Service) resolveAttachmentWorkspaceSlug(ctx context.Context, userID int32, workspaceName string, memoWorkspaceID *int32) (string, error) {
	find := &store.FindWorkspace{}
	switch {
	case strings.TrimSpace(workspaceName) != "":
		uid, err := ExtractWorkspaceUIDFromName(workspaceName)
		if err != nil {
			return "", status.Errorf(codes.InvalidArgument, "invalid workspace name: %v", err)
		}
		find.UID = &uid
	case memoWorkspaceID != nil:
		find.ID = memoWorkspaceID
	default:
		return "", nil
	}

	workspace, err := s.Store.GetWorkspace(ctx, find)
	if err != nil {
		return "", status.Errorf(codes.Internal, "failed to get workspace: %v", err)
	}
	if workspace == nil {
		// A memo whose workspace vanished shouldn't fail the upload; only an explicitly
		// named workspace is held to existing.
		if find.UID == nil {
			return "", nil
		}
		return "", status.Errorf(codes.NotFound, "workspace not found: %s", workspaceName)
	}
	if find.UID != nil {
		user, err := s.Store.GetUser(ctx, &store.FindUser{ID: &userID})
		if err != nil {
			return "", status.Errorf(codes.Internal, "failed to get user: %v", err)
		}
		access, err := s.resolveWorkspaceAccess(ctx, user, workspace.ID)
		if err != nil {
			return "", status.Errorf(codes.Internal, "failed to resolve workspace access: %v", err)
		}
		if !access.CanWrite() {
			return "", status.Errorf(codes.PermissionDenied, "permission denied")
		}
	}

	slug, err := s.Store.EnsureWorkspaceStorageSlug(ctx, workspace)
	if err != nil {
		return "", status.Errorf(codes.Internal, "failed to resolve workspace storage slug: %v", err)
	}
	return slug, nil
}

func (s *APIV1Service) ListAttachments(ctx context.Context, request *v1pb.ListAttachmentsRequest) (*v1pb.ListAttachmentsResponse, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}

	pageSize := normalizePageSize(request.PageSize)

	// Parse page token for offset
	offset := 0
	if request.PageToken != "" {
		// Simple implementation: page token is the offset as string
		// In production, you might want to use encrypted tokens
		if parsed, err := fmt.Sscanf(request.PageToken, "%d", &offset); err != nil || parsed != 1 {
			return nil, status.Errorf(codes.InvalidArgument, "invalid page token")
		}
	}

	findAttachment := &store.FindAttachment{
		CreatorID: &user.ID,
		Limit:     &pageSize,
		Offset:    &offset,
	}

	// Parse filter if provided
	if request.Filter != "" {
		if err := s.validateAttachmentFilter(ctx, request.Filter); err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "invalid filter: %v", err)
		}
		findAttachment.Filters = append(findAttachment.Filters, request.Filter)
	}

	attachments, err := s.Store.ListAttachments(ctx, findAttachment)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list attachments: %v", err)
	}

	response := &v1pb.ListAttachmentsResponse{}

	for _, attachment := range attachments {
		response.Attachments = append(response.Attachments, convertAttachmentFromStore(attachment))
	}

	// Set next page token if we got the full page size (indicating there might be more)
	if len(attachments) == pageSize {
		response.NextPageToken = fmt.Sprintf("%d", offset+pageSize)
	}

	return response, nil
}

func (s *APIV1Service) GetAttachment(ctx context.Context, request *v1pb.GetAttachmentRequest) (*v1pb.Attachment, error) {
	attachmentUID, err := ExtractAttachmentUIDFromName(request.Name)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid attachment id: %v", err)
	}
	attachment, err := s.Store.GetAttachment(ctx, &store.FindAttachment{UID: &attachmentUID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get attachment: %v", err)
	}
	if attachment == nil {
		return nil, status.Errorf(codes.NotFound, "attachment not found")
	}

	// Check access permission based on linked memo visibility.
	if err := s.checkAttachmentAccess(ctx, attachment); err != nil {
		return nil, err
	}

	return convertAttachmentFromStore(attachment), nil
}

func (s *APIV1Service) UpdateAttachment(ctx context.Context, request *v1pb.UpdateAttachmentRequest) (*v1pb.Attachment, error) {
	attachmentUID, err := ExtractAttachmentUIDFromName(request.Attachment.Name)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid attachment id: %v", err)
	}
	if request.UpdateMask == nil || len(request.UpdateMask.Paths) == 0 {
		return nil, status.Errorf(codes.InvalidArgument, "update mask is required")
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
	// Only the creator or admin can update the attachment.
	if attachment.CreatorID != user.ID && !isSuperUser(user) {
		return nil, status.Errorf(codes.PermissionDenied, "permission denied")
	}

	currentTs := time.Now().Unix()
	update := &store.UpdateAttachment{
		ID:        attachment.ID,
		UpdatedTs: &currentTs,
	}
	// ensurePayload returns the payload this update is accumulating, cloning it
	// from the stored one on first use. Every field-mask branch that touches the
	// payload must go through this rather than cloning attachment.Payload itself,
	// or a request naming two payload fields in the same call would have the
	// second overwrite the first.
	ensurePayload := func() *storepb.AttachmentPayload {
		if update.Payload != nil {
			return update.Payload
		}
		payload := proto.Clone(attachment.Payload).(*storepb.AttachmentPayload)
		if payload == nil {
			payload = &storepb.AttachmentPayload{}
		}
		update.Payload = payload
		return payload
	}
	for _, field := range request.UpdateMask.Paths {
		switch field {
		case "filename":
			if !validateFilename(request.Attachment.Filename) {
				return nil, status.Errorf(codes.InvalidArgument, "filename contains invalid characters or format")
			}
			update.Filename = &request.Attachment.Filename
		case "reader_settings":
			ensurePayload().ReaderSettings = request.Attachment.ReaderSettings
		case "access", "locked":
			// "locked" is the pre-三态 spelling of the same field and still arrives from
			// clients built against it; it can only ever ask for LOCKED or INHERIT.
			access := request.Attachment.Access
			if field == "locked" {
				access = v1pb.AttachmentAccess_ACCESS_INHERIT
				if request.Attachment.Locked {
					access = v1pb.AttachmentAccess_ACCESS_LOCKED
				}
			}
			if err := s.authorizeAttachmentAccessUpdate(ctx, attachment, user, access); err != nil {
				return nil, err
			}
			storeAccess := convertAttachmentAccessToStore(access)
			payload := ensurePayload()
			payload.Access = storeAccess
			// LEGACY-COMPAT: keep the retired bool in step with the enum so rolling back
			// to a binary that predates `access` still finds locked attachments locked.
			payload.Locked = storeAccess == storepb.AttachmentAccess_ACCESS_LOCKED
		case "content":
			if err := s.applyAttachmentContentUpdate(ctx, attachment, request.Attachment.Content, update); err != nil {
				return nil, err
			}
		}
	}

	if err := s.Store.UpdateAttachment(ctx, update); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to update attachment: %v", err)
	}
	// Read back through the store rather than GetAttachment: the write above is
	// allowed for an admin acting on someone else's attachment, while the read side
	// deliberately grants admins nothing, and echoing the result of a write the caller
	// just made is not the read that check is there to guard.
	updated, err := s.Store.GetAttachment(ctx, &store.FindAttachment{UID: &attachmentUID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get attachment: %v", err)
	}
	if updated == nil {
		return nil, status.Errorf(codes.NotFound, "attachment not found")
	}
	return convertAttachmentFromStore(updated), nil
}

// overwritableAttachmentTypes lists the MIME types whose bytes may be replaced in place.
//
// Attachment content used to be immutable; making it mutable re-opens the upload path's
// validation surface, so the allowance is deliberately narrow. SVG is here for draw.io
// diagrams, which carry their own editable source and are saved back over the original
// (ADR-0017). Restricting by stored type is also what makes "the MIME type can't change"
// true by construction: the type column is never part of a content update, and a type we
// can verify structurally can't be turned into something else by the new bytes.
var overwritableAttachmentTypes = map[string]bool{
	"image/svg+xml": true,
}

// applyAttachmentContentUpdate validates replacement bytes and writes them over the
// attachment's existing storage, recording the new size on `update`. The blob is rewritten in
// place (same local path / same S3 key) so no orphan object is left behind.
func (s *APIV1Service) applyAttachmentContentUpdate(ctx context.Context, attachment *store.Attachment, content []byte, update *store.UpdateAttachment) error {
	if len(content) == 0 {
		return status.Errorf(codes.InvalidArgument, "content is required")
	}
	// Locked attachments are decrypted client-side; the server holds no key and can't tell a
	// legitimate re-encryption from a destructive overwrite. The frontend hides the edit entry
	// for these, but the frontend is not the security boundary.
	if attachmentacl.EffectiveAccess(attachment) == storepb.AttachmentAccess_ACCESS_LOCKED {
		return status.Errorf(codes.FailedPrecondition, "locked attachments cannot be overwritten")
	}
	if attachment.StorageType == storepb.AttachmentStorageType_EXTERNAL {
		return status.Errorf(codes.FailedPrecondition, "externally linked attachments cannot be overwritten")
	}
	if !overwritableAttachmentTypes[attachment.Type] {
		return status.Errorf(codes.FailedPrecondition, "content of a %s attachment cannot be replaced", attachment.Type)
	}
	if attachment.Type == "image/svg+xml" && !looksLikeSVG(content) {
		return status.Errorf(codes.InvalidArgument, "replacement content is not an SVG document")
	}

	if _, err := s.validateAttachmentContentSize(ctx, attachment.Type, content); err != nil {
		return err
	}
	blob, err := s.stripExifIfNeeded(ctx, content, attachment.Type, attachment.Filename, attachment.Payload.GetMotionMedia())
	if err != nil {
		return err
	}
	size := int64(len(blob))

	switch attachment.StorageType {
	case storepb.AttachmentStorageType_LOCAL:
		attachmentPath := filepath.FromSlash(attachment.Reference)
		if !filepath.IsAbs(attachmentPath) {
			attachmentPath = filepath.Join(s.Profile.Data, attachmentPath)
		}
		if err := os.WriteFile(attachmentPath, blob, 0644); err != nil {
			return status.Errorf(codes.Internal, "failed to write attachment file: %v", err)
		}
	case storepb.AttachmentStorageType_S3:
		s3Object := attachment.Payload.GetS3Object()
		if s3Object == nil || s3Object.Key == "" {
			return status.Errorf(codes.Internal, "S3 object key is missing")
		}
		s3Config, err := s.Store.ResolveAttachmentS3Config(ctx, s3Object.S3Config)
		if err != nil {
			return status.Errorf(codes.Internal, "failed to resolve S3 config: %v", err)
		}
		s3Client, err := s3.NewClient(ctx, s3Config)
		if err != nil {
			return status.Errorf(codes.Internal, "failed to create S3 client: %v", err)
		}
		// Same key as before — uploading under a new one would leave the old object orphaned.
		if _, err := s3Client.UploadObject(ctx, s3Object.Key, attachment.Type, bytes.NewReader(blob)); err != nil {
			return status.Errorf(codes.Internal, "failed to upload to S3: %v", err)
		}
	default:
		// Database-backed storage: the bytes live in the row itself.
		update.Blob = blob
	}
	update.Size = &size
	return nil
}

// looksLikeSVG reports whether blob is an SVG document, by parsing far enough to see that the
// root element is <svg>. Cheap structural check, not a full validation — its job is to stop a
// non-image from being written under an image/svg+xml content type.
func looksLikeSVG(blob []byte) bool {
	decoder := xml.NewDecoder(bytes.NewReader(blob))
	decoder.Strict = false
	for {
		token, err := decoder.Token()
		if err != nil {
			return false
		}
		if start, ok := token.(xml.StartElement); ok {
			return strings.EqualFold(start.Name.Local, "svg")
		}
	}
}

func (s *APIV1Service) DeleteAttachment(ctx context.Context, request *v1pb.DeleteAttachmentRequest) (*emptypb.Empty, error) {
	attachmentUID, err := ExtractAttachmentUIDFromName(request.Name)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid attachment id: %v", err)
	}
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}
	attachment, err := s.Store.GetAttachment(ctx, &store.FindAttachment{
		UID:       &attachmentUID,
		CreatorID: &user.ID,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to find attachment: %v", err)
	}
	if attachment == nil {
		return nil, status.Errorf(codes.NotFound, "attachment not found")
	}
	// Delete the attachment from the database.
	if err := s.Store.DeleteAttachment(ctx, &store.DeleteAttachment{
		ID: attachment.ID,
	}); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to delete attachment: %v", err)
	}
	return &emptypb.Empty{}, nil
}

// UnlinkAttachment detaches an attachment from its memo (clears memo_id) without
// deleting the file. Use this instead of DeleteAttachment when the attachment
// might still be referenced by a saved memo version, so that restoring that
// version can relink the file later.
func (s *APIV1Service) UnlinkAttachment(ctx context.Context, request *v1pb.UnlinkAttachmentRequest) (*v1pb.Attachment, error) {
	attachmentUID, err := ExtractAttachmentUIDFromName(request.Name)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid attachment id: %v", err)
	}
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}
	attachment, err := s.Store.GetAttachment(ctx, &store.FindAttachment{
		UID:       &attachmentUID,
		CreatorID: &user.ID,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to find attachment: %v", err)
	}
	if attachment == nil {
		return nil, status.Errorf(codes.NotFound, "attachment not found")
	}
	if err := s.Store.UpdateAttachment(ctx, &store.UpdateAttachment{
		ID:          attachment.ID,
		UnsetMemoID: true,
	}); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to unlink attachment: %v", err)
	}
	updated, err := s.Store.GetAttachment(ctx, &store.FindAttachment{UID: &attachmentUID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get attachment: %v", err)
	}
	return convertAttachmentFromStore(updated), nil
}

func (s *APIV1Service) BatchDeleteAttachments(ctx context.Context, request *v1pb.BatchDeleteAttachmentsRequest) (*emptypb.Empty, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}
	if len(request.Names) == 0 {
		return nil, status.Errorf(codes.InvalidArgument, "attachment names are required")
	}
	if len(request.Names) > maxBatchDeleteAttachments {
		return nil, status.Errorf(codes.InvalidArgument, "too many attachment names; max %d", maxBatchDeleteAttachments)
	}

	attachments := make([]*store.Attachment, 0, len(request.Names))
	seen := make(map[string]bool, len(request.Names))
	for _, name := range request.Names {
		if name == "" {
			return nil, status.Errorf(codes.InvalidArgument, "attachment name is required")
		}
		if seen[name] {
			continue
		}
		seen[name] = true

		attachmentUID, err := ExtractAttachmentUIDFromName(name)
		if err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "invalid attachment id: %v", err)
		}
		attachment, err := s.Store.GetAttachment(ctx, &store.FindAttachment{UID: &attachmentUID})
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to get attachment: %v", err)
		}
		if attachment == nil {
			return nil, status.Errorf(codes.NotFound, "attachment not found")
		}
		if attachment.CreatorID != user.ID && !isSuperUser(user) {
			return nil, status.Errorf(codes.PermissionDenied, "permission denied")
		}
		attachments = append(attachments, attachment)
	}

	if err := s.Store.DeleteAttachments(ctx, attachments); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to delete attachments: %v", err)
	}

	return &emptypb.Empty{}, nil
}

func convertAttachmentFromStore(attachment *store.Attachment) *v1pb.Attachment {
	attachmentMessage := &v1pb.Attachment{
		Name:           fmt.Sprintf("%s%s", AttachmentNamePrefix, attachment.UID),
		CreateTime:     timestamppb.New(time.Unix(attachment.CreatedTs, 0)),
		Filename:       attachment.Filename,
		Type:           attachment.Type,
		Size:           attachment.Size,
		MotionMedia:    convertMotionMediaFromStore(getAttachmentMotionMedia(attachment)),
		Origin:         convertAttachmentOriginFromStore(attachment.Payload.GetOrigin()),
		ReaderSettings: attachment.Payload.GetReaderSettings(),
		Access:         convertAttachmentAccessFromStore(attachmentacl.EffectiveAccess(attachment)),
	}
	attachmentMessage.Locked = attachmentMessage.Access == v1pb.AttachmentAccess_ACCESS_LOCKED
	if attachment.MemoUID != nil && *attachment.MemoUID != "" {
		memoName := fmt.Sprintf("%s%s", MemoNamePrefix, *attachment.MemoUID)
		attachmentMessage.Memo = &memoName
	}
	// S3-backed attachments are intentionally NOT exposed as an external link: they are always
	// served through the memos-domain proxy (`/file/...`, see GetAttachmentBlob) so that MinIO/S3
	// endpoints that are only reachable from the server (not the browser) still work, and so
	// access stays governed by memos' own auth instead of a long-lived presigned URL.
	if attachment.StorageType == storepb.AttachmentStorageType_EXTERNAL {
		attachmentMessage.ExternalLink = attachment.Reference
	}

	return attachmentMessage
}

// SaveAttachmentBlob saves the blob of attachment based on the storage config.
//
// workspaceSlug is the storage slug of the workspace the attachment belongs to; it fills the
// `{workspace}` placeholder of the S3 filepath template. It has to be passed in rather than
// derived from create.MemoID, because web uploads happen before the memo exists.
func SaveAttachmentBlob(ctx context.Context, profile *profile.Profile, stores *store.Store, create *store.Attachment, workspaceSlug string) error {
	instanceStorageSetting, err := stores.GetInstanceStorageSetting(ctx)
	if err != nil {
		return errors.Wrap(err, "Failed to find instance storage setting")
	}

	if instanceStorageSetting.StorageType == storepb.InstanceStorageSetting_LOCAL {
		filepathTemplate := "assets/{timestamp}_{uuid}_{filename}"
		if instanceStorageSetting.FilepathTemplate != "" {
			filepathTemplate = instanceStorageSetting.FilepathTemplate
		}

		internalPath := attachmentpath.Normalize(filepathTemplate)
		internalPath = attachmentpath.Expand(internalPath, attachmentpath.Context{Filename: create.Filename, DropWorkspace: true})
		internalPath = filepath.ToSlash(internalPath)

		// Ensure the directory exists.
		osPath := filepath.FromSlash(internalPath)
		if !filepath.IsAbs(osPath) {
			osPath = filepath.Join(profile.Data, osPath)
		}
		osPath = ensureUniqueLocalAttachmentPath(osPath, create.UID)
		internalPath = filepath.ToSlash(osPath)
		if !filepath.IsAbs(filepath.FromSlash(internalPath)) {
			internalPath, err = filepath.Rel(profile.Data, osPath)
			if err != nil {
				return errors.Wrap(err, "Failed to get relative path")
			}
			internalPath = filepath.ToSlash(internalPath)
		}
		dir := filepath.Dir(osPath)
		if err = os.MkdirAll(dir, os.ModePerm); err != nil {
			return errors.Wrap(err, "Failed to create directory")
		}

		// Write the blob to the file.
		if err := os.WriteFile(osPath, create.Blob, 0644); err != nil {
			return errors.Wrap(err, "Failed to write file")
		}
		create.Reference = internalPath
		create.Blob = nil
		create.StorageType = storepb.AttachmentStorageType_LOCAL
	} else if instanceStorageSetting.StorageType == storepb.InstanceStorageSetting_S3 {
		s3Config := instanceStorageSetting.S3Config
		if s3Config == nil {
			return errors.Errorf("No activated external storage found")
		}
		s3Client, err := s3.NewClient(ctx, s3Config)
		if err != nil {
			return errors.Wrap(err, "Failed to create s3 client")
		}

		filepathTemplate := attachmentpath.Normalize(instanceStorageSetting.FilepathTemplate)
		filepathTemplate = attachmentpath.Expand(filepathTemplate, attachmentpath.Context{Filename: create.Filename, WorkspaceSlug: workspaceSlug})
		key, err := s3Client.UploadObject(ctx, filepathTemplate, create.Type, bytes.NewReader(create.Blob))
		if err != nil {
			return errors.Wrap(err, "Failed to upload via s3 client")
		}

		// Reference stores the S3 object key, not a presigned URL: attachments are always served
		// through the server-side proxy (GetAttachmentBlob), which reads the key from the payload
		// below and signs/fetches the object itself. This keeps S3/MinIO endpoints (which may only
		// be reachable from the server, not the browser) out of any URL handed to the client.
		create.Reference = key
		create.Blob = nil
		create.StorageType = storepb.AttachmentStorageType_S3
		payload := ensureAttachmentPayload(create.Payload)
		payload.Payload = &storepb.AttachmentPayload_S3Object_{
			S3Object: &storepb.AttachmentPayload_S3Object{
				// The object belongs to this instance's active S3 backend. Keep the
				// connection details in the instance STORAGE setting only; copying them
				// into every attachment makes an endpoint rename a row-by-row data
				// migration and duplicates credentials throughout the database.
				Key: key,
			},
		}
		create.Payload = payload
	}

	return nil
}

func (s *APIV1Service) GetAttachmentBlob(attachment *store.Attachment) ([]byte, error) {
	// For local storage, read the file from the local disk.
	if attachment.StorageType == storepb.AttachmentStorageType_LOCAL {
		attachmentPath := filepath.FromSlash(attachment.Reference)
		if !filepath.IsAbs(attachmentPath) {
			attachmentPath = filepath.Join(s.Profile.Data, attachmentPath)
		}

		file, err := os.Open(attachmentPath)
		if err != nil {
			if os.IsNotExist(err) {
				return nil, errors.Wrap(err, "file not found")
			}
			return nil, errors.Wrap(err, "failed to open the file")
		}
		defer file.Close()
		blob, err := io.ReadAll(file)
		if err != nil {
			return nil, errors.Wrap(err, "failed to read the file")
		}
		return blob, nil
	}
	// For S3 storage, download the file from S3.
	if attachment.StorageType == storepb.AttachmentStorageType_S3 {
		if attachment.Payload == nil {
			return nil, errors.New("attachment payload is missing")
		}
		s3Object := attachment.Payload.GetS3Object()
		if s3Object == nil {
			return nil, errors.New("S3 object payload is missing")
		}
		if s3Object.Key == "" {
			return nil, errors.New("S3 object key is missing")
		}

		// S3 connection details are instance-level; legacy payload snapshots are fallback-only.
		s3Config, err := s.Store.ResolveAttachmentS3Config(context.Background(), s3Object.S3Config)
		if err != nil {
			return nil, err
		}

		s3Client, err := s3.NewClient(context.Background(), s3Config)
		if err != nil {
			return nil, errors.Wrap(err, "failed to create S3 client")
		}

		blob, err := s3Client.GetObject(context.Background(), s3Object.Key)
		if err != nil {
			return nil, errors.Wrap(err, "failed to get object from S3")
		}
		return blob, nil
	}
	// For database storage, return the blob from the database.
	return attachment.Blob, nil
}

func ensureUniqueLocalAttachmentPath(path, uid string) string {
	if _, err := os.Stat(path); err != nil {
		return path
	}

	ext := filepath.Ext(path)
	base := strings.TrimSuffix(path, ext)
	return base + "_" + uid + ext
}

func validateFilename(filename string) bool {
	// Reject path traversal attempts and make sure no additional directories are created
	if !filepath.IsLocal(filename) || strings.ContainsAny(filename, "/\\") {
		return false
	}

	// Reject filenames starting or ending with spaces or periods
	if strings.HasPrefix(filename, " ") || strings.HasSuffix(filename, " ") ||
		strings.HasPrefix(filename, ".") || strings.HasSuffix(filename, ".") {
		return false
	}

	return true
}

func normalizeMimeType(mimeType string) (string, bool) {
	mimeType = strings.TrimSpace(mimeType)
	if mimeType == "" || len(mimeType) > 255 {
		return "", false
	}

	mediaType, _, err := mime.ParseMediaType(mimeType)
	if err != nil || mediaType == "" || len(mediaType) > 255 {
		return "", false
	}

	return mediaType, true
}

func (s *APIV1Service) validateAttachmentFilter(ctx context.Context, filterStr string) error {
	if filterStr == "" {
		return errors.New("filter cannot be empty")
	}

	engine, err := filter.DefaultAttachmentEngine()
	if err != nil {
		return err
	}

	if _, err := engine.CompileToStatement(ctx, filterStr, filter.RenderOptions{Dialect: filter.DialectSQLite}); err != nil {
		return errors.Wrap(err, "failed to compile filter")
	}
	return nil
}

// cookieHeaderFromContext reads the raw Cookie header off the incoming gRPC/Connect
// metadata, mirroring the pattern auth_service.go uses for the refresh-token cookie.
func cookieHeaderFromContext(ctx context.Context) string {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return ""
	}
	cookies := md.Get("cookie")
	if len(cookies) == 0 {
		return ""
	}
	return cookies[0]
}

// checkAttachmentAccess verifies the user has permission to access the attachment.
// The decision itself lives in attachmentacl, shared with the binary download path in
// the file server; this only supplies the Connect-side inputs and maps the answer onto
// gRPC codes.
func (s *APIV1Service) checkAttachmentAccess(ctx context.Context, attachment *store.Attachment) error {
	err := attachmentacl.CheckReadAccess(ctx, &attachmentacl.Request{
		Store:          s.Store,
		CurrentUser:    s.fetchCurrentUser,
		AllowAnonymous: s.Profile.AllowAnonymous(),
		// No share token here: the shared-document page gets its attachments inline
		// from GetMemoByShare and never calls GetAttachment.
		VaultUnlocked: func(userID int32) bool {
			return auth.VaultUnlocked(cookieHeaderFromContext(ctx), []byte(s.Secret), userID, auth.GetCredentialKind(ctx))
		},
	}, attachment)

	switch {
	case err == nil:
		return nil
	case errors.Is(err, attachmentacl.ErrNotFound):
		return status.Errorf(codes.NotFound, "attachment not found")
	case errors.Is(err, attachmentacl.ErrUnauthenticated):
		return status.Errorf(codes.Unauthenticated, "user not authenticated")
	case errors.Is(err, attachmentacl.ErrForbidden):
		return status.Errorf(codes.PermissionDenied, "permission denied")
	default:
		return status.Errorf(codes.Internal, "failed to check attachment access: %v", err)
	}
}

func validateClientMotionMedia(motion *v1pb.MotionMedia, attachmentUID string) (*storepb.MotionMedia, error) {
	if motion == nil {
		return nil, nil
	}

	if motion.Family != v1pb.MotionMediaFamily_APPLE_LIVE_PHOTO {
		return nil, status.Errorf(codes.InvalidArgument, "only Apple Live Photo motion metadata can be provided by clients")
	}
	if motion.Role != v1pb.MotionMediaRole_STILL && motion.Role != v1pb.MotionMediaRole_VIDEO {
		return nil, status.Errorf(codes.InvalidArgument, "invalid Apple Live Photo motion role")
	}

	storeMotion := convertMotionMediaToStore(motion)
	if storeMotion.GroupId == "" {
		return nil, status.Errorf(codes.InvalidArgument, "motion media group_id is required")
	}
	if storeMotion.Family == storepb.MotionMediaFamily_ANDROID_MOTION_PHOTO && storeMotion.GroupId == "" {
		storeMotion.GroupId = attachmentUID
	}

	return storeMotion, nil
}

func detectAndroidMotionMedia(blob []byte, mimeType, attachmentUID string) *storepb.MotionMedia {
	if mimeType != "image/jpeg" && mimeType != "image/jpg" {
		return nil
	}

	detection := motionphoto.DetectJPEG(blob)
	if detection == nil {
		return nil
	}

	return &storepb.MotionMedia{
		Family:                  storepb.MotionMediaFamily_ANDROID_MOTION_PHOTO,
		Role:                    storepb.MotionMediaRole_CONTAINER,
		GroupId:                 attachmentUID,
		PresentationTimestampUs: detection.PresentationTimestampUs,
		HasEmbeddedVideo:        true,
	}
}

// shouldStripExif checks if the MIME type is an image format that may contain EXIF metadata.
// Returns true for formats like JPEG, TIFF, WebP, HEIC, and HEIF which commonly contain
// privacy-sensitive metadata such as GPS coordinates, camera settings, and device information.
func shouldStripExif(mimeType string) bool {
	return exifCapableImageTypes[mimeType]
}

func (s *APIV1Service) acquireImageProcessingSlot(ctx context.Context) (func(), error) {
	if s.imageProcessingSemaphore == nil {
		return func() {}, nil
	}
	if err := s.imageProcessingSemaphore.Acquire(ctx, 1); err != nil {
		return nil, err
	}
	return func() {
		s.imageProcessingSemaphore.Release(1)
	}, nil
}

func validateImagePixelCount(imageData []byte) error {
	config, _, err := image.DecodeConfig(bytes.NewReader(imageData))
	if err != nil {
		// Some formats supported by imaging do not expose dimensions through
		// the standard image registry. Let the full decoder handle those.
		return nil //nolint:nilerr
	}
	if config.Width <= 0 || config.Height <= 0 {
		return errors.New("invalid image dimensions")
	}
	if config.Width > maxImagePixels/config.Height {
		return errors.Errorf("image dimensions exceed maximum of %d pixels", maxImagePixels)
	}
	return nil
}

// stripImageExif removes EXIF metadata from image files by decoding and re-encoding them.
// This prevents exposure of sensitive metadata such as GPS location, camera details, and timestamps.
//
// The function preserves the correct image orientation by applying EXIF orientation tags
// during decoding before stripping all metadata. Images are re-encoded with high quality
// to minimize visual degradation.
//
// Supported formats:
//   - JPEG/JPG: Re-encoded as JPEG with quality 95
//   - PNG: Re-encoded as PNG (lossless)
//   - TIFF/WebP/HEIC/HEIF: Re-encoded as JPEG with quality 95
//
// Returns the cleaned image data without any EXIF metadata, or an error if processing fails.
func stripImageExif(imageData []byte, mimeType string) ([]byte, error) {
	if err := validateImagePixelCount(imageData); err != nil {
		return nil, err
	}

	// Decode image with automatic EXIF orientation correction.
	// This ensures the image displays correctly after metadata removal.
	img, err := imaging.Decode(bytes.NewReader(imageData), imaging.AutoOrientation(true))
	if err != nil {
		return nil, errors.Wrap(err, "failed to decode image")
	}

	// Re-encode the image without EXIF metadata.
	var buf bytes.Buffer
	var encodeErr error

	if mimeType == "image/png" {
		// Preserve PNG format for lossless encoding
		encodeErr = imaging.Encode(&buf, img, imaging.PNG)
	} else {
		// For JPEG, TIFF, WebP, HEIC, HEIF - re-encode as JPEG.
		// This ensures EXIF is stripped and provides good compression.
		encodeErr = imaging.Encode(&buf, img, imaging.JPEG, imaging.JPEGQuality(defaultJPEGQuality))
	}

	if encodeErr != nil {
		return nil, errors.Wrap(encodeErr, "failed to encode image")
	}

	return buf.Bytes(), nil
}

// authorizeAttachmentAccessUpdate guards the two access modes that are more than a
// display preference.
//
// ACCESS_PUBLIC puts the bytes on the open internet, so only the creator may set it:
// UpdateAttachment otherwise lets an admin act on someone else's attachment, and
// deciding to publish someone else's file is not an administrative act (决策 9). It
// also needs the instance to serve anonymous visitors at all, which is exactly what
// AllowAnonymous reports — without an instance URL there is no public link to hand
// out, and silently storing the flag would promise something the server won't do.
//
// ACCESS_LOCKED carries R8: never let an attachment lock behind a passphrase its
// owner can't yet prove they hold — that's "locks, doesn't unlock".
//
// Leaving ACCESS_LOCKED is guarded separately, and more tightly than arriving at any
// mode, because it is the one transition that *undoes* the passphrase gate.
func (s *APIV1Service) authorizeAttachmentAccessUpdate(ctx context.Context, attachment *store.Attachment, user *store.User, access v1pb.AttachmentAccess) error {
	// Unlocking is a read of the passphrase gate by another name: whoever can flip a
	// locked attachment to INHERIT can then simply download it. So it answers to the
	// same two things reading it would (attachmentacl.checkVaultAccess) — be the
	// creator, and hold an unlocked vault on a browser session — rather than to
	// UpdateAttachment's ordinary "creator or admin" writer check.
	//
	// Without this the lock is decorative twice over: an admin could unlock any user's
	// attachment and read it, which part B's threat model explicitly promises to stop,
	// and a stolen session with no vault cookie could unlock-then-read, skipping the
	// passphrase the whole feature is built on.
	if attachmentacl.EffectiveAccess(attachment) == storepb.AttachmentAccess_ACCESS_LOCKED && access != v1pb.AttachmentAccess_ACCESS_LOCKED {
		if attachment.CreatorID != user.ID {
			return status.Errorf(codes.PermissionDenied, "only the attachment's owner can unlock it")
		}
		if !auth.VaultUnlocked(cookieHeaderFromContext(ctx), []byte(s.Secret), user.ID, auth.GetCredentialKind(ctx)) {
			return status.Errorf(codes.FailedPrecondition, "unlock your master passphrase before changing a locked attachment's access")
		}
	}

	switch access {
	case v1pb.AttachmentAccess_ACCESS_PUBLIC:
		if attachment.CreatorID != user.ID {
			return status.Errorf(codes.PermissionDenied, "only the attachment's owner can make it public")
		}
		if !s.Profile.AllowAnonymous() {
			return status.Errorf(codes.FailedPrecondition, "this instance has no instance URL configured, so it serves no anonymous visitors and a public attachment link would not work")
		}
	case v1pb.AttachmentAccess_ACCESS_LOCKED:
		canLock, err := s.canLockAttachment(ctx, attachment.CreatorID)
		if err != nil {
			return status.Errorf(codes.Internal, "failed to check vault readiness: %v", err)
		}
		if !canLock {
			return status.Errorf(codes.FailedPrecondition, "the attachment owner must unlock their master passphrase once in Settings before attachments can be locked")
		}
	case v1pb.AttachmentAccess_ACCESS_INHERIT:
	}
	return nil
}

func convertAttachmentAccessFromStore(access storepb.AttachmentAccess) v1pb.AttachmentAccess {
	switch access {
	case storepb.AttachmentAccess_ACCESS_LOCKED:
		return v1pb.AttachmentAccess_ACCESS_LOCKED
	case storepb.AttachmentAccess_ACCESS_PUBLIC:
		return v1pb.AttachmentAccess_ACCESS_PUBLIC
	default:
		return v1pb.AttachmentAccess_ACCESS_INHERIT
	}
}

func convertAttachmentAccessToStore(access v1pb.AttachmentAccess) storepb.AttachmentAccess {
	switch access {
	case v1pb.AttachmentAccess_ACCESS_LOCKED:
		return storepb.AttachmentAccess_ACCESS_LOCKED
	case v1pb.AttachmentAccess_ACCESS_PUBLIC:
		return storepb.AttachmentAccess_ACCESS_PUBLIC
	default:
		return storepb.AttachmentAccess_ACCESS_INHERIT
	}
}
