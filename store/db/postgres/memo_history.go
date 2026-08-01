package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"google.golang.org/protobuf/encoding/protojson"

	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

func (d *DB) CreateMemoHistory(ctx context.Context, create *store.MemoHistory) (*store.MemoHistory, error) {
	payload := "{}"
	if create.Payload != nil {
		payloadBytes, err := protojson.Marshal(create.Payload)
		if err != nil {
			return nil, err
		}
		payload = string(payloadBytes)
	}
	attachments := "[]"
	if len(create.Attachments) > 0 {
		attachmentBytes, err := json.Marshal(create.Attachments)
		if err != nil {
			return nil, err
		}
		attachments = string(attachmentBytes)
	}
	fields := []string{"uid", "memo_id", "name", "title", "content", "payload", "content_hash", "attachments", "creator_id"}
	args := []any{create.UID, create.MemoID, create.Name, create.Title, create.Content, payload, create.ContentHash, attachments, create.CreatorID}
	if create.CreatedTs != 0 {
		fields = append(fields, "created_ts")
		args = append(args, create.CreatedTs)
	}

	stmt := "INSERT INTO memo_history (" + strings.Join(fields, ", ") + ") VALUES (" + placeholders(len(args)) + ") RETURNING id, created_ts"
	if err := d.db.QueryRowContext(ctx, stmt, args...).Scan(
		&create.ID,
		&create.CreatedTs,
	); err != nil {
		return nil, err
	}
	return create, nil
}

func (d *DB) ListMemoHistories(ctx context.Context, find *store.FindMemoHistory) ([]*store.MemoHistory, error) {
	where, args := []string{"1 = 1"}, []any{}
	if find.ID != nil {
		where, args = append(where, "id = "+placeholder(len(args)+1)), append(args, *find.ID)
	}
	if find.UID != nil {
		where, args = append(where, "uid = "+placeholder(len(args)+1)), append(args, *find.UID)
	}
	if find.MemoID != nil {
		where, args = append(where, "memo_id = "+placeholder(len(args)+1)), append(args, *find.MemoID)
	}
	if find.ContentHash != nil {
		where, args = append(where, "content_hash = "+placeholder(len(args)+1)), append(args, *find.ContentHash)
	}

	query := `
		SELECT
			id, uid, memo_id, name, title, content, payload, content_hash, attachments, creator_id, created_ts
		FROM memo_history
		WHERE ` + strings.Join(where, " AND ") + `
		ORDER BY created_ts DESC, id DESC`
	if find.Limit != nil {
		query = fmt.Sprintf("%s LIMIT %d", query, *find.Limit)
		if find.Offset != nil {
			query = fmt.Sprintf("%s OFFSET %d", query, *find.Offset)
		}
	}

	rows, err := d.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := []*store.MemoHistory{}
	for rows.Next() {
		memoHistory := &store.MemoHistory{}
		var payloadBytes []byte
		var attachmentBytes []byte
		if err := rows.Scan(
			&memoHistory.ID,
			&memoHistory.UID,
			&memoHistory.MemoID,
			&memoHistory.Name,
			&memoHistory.Title,
			&memoHistory.Content,
			&payloadBytes,
			&memoHistory.ContentHash,
			&attachmentBytes,
			&memoHistory.CreatorID,
			&memoHistory.CreatedTs,
		); err != nil {
			return nil, err
		}
		payload := &storepb.MemoPayload{}
		if err := protojsonUnmarshaler.Unmarshal(payloadBytes, payload); err != nil {
			return nil, err
		}
		memoHistory.Payload = payload
		if len(attachmentBytes) > 0 {
			if err := json.Unmarshal(attachmentBytes, &memoHistory.Attachments); err != nil {
				return nil, err
			}
		}
		list = append(list, memoHistory)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return list, nil
}
