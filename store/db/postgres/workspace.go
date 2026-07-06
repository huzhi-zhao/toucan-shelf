package postgres

import (
	"context"
	"strings"

	"github.com/usememos/memos/store"
)

func (d *DB) CreateWorkspace(ctx context.Context, create *store.Workspace) (*store.Workspace, error) {
	fields := []string{"uid", "creator_id", "title"}
	args := []any{create.UID, create.CreatorID, create.Title}
	stmt := "INSERT INTO workspace (" + strings.Join(fields, ", ") + ") VALUES (" + placeholders(len(args)) + ") RETURNING id, created_ts, updated_ts, sort_field, sort_order, cover_color, cover_image"
	if err := d.db.QueryRowContext(ctx, stmt, args...).Scan(&create.ID, &create.CreatedTs, &create.UpdatedTs, &create.SortField, &create.SortOrder, &create.CoverColor, &create.CoverImage); err != nil {
		return nil, err
	}
	return create, nil
}

func (d *DB) ListWorkspaces(ctx context.Context, find *store.FindWorkspace) ([]*store.Workspace, error) {
	where, args := []string{"1 = 1"}, []any{}
	if v := find.ID; v != nil {
		where, args = append(where, "id = "+placeholder(len(args)+1)), append(args, *v)
	}
	if v := find.UID; v != nil {
		where, args = append(where, "uid = "+placeholder(len(args)+1)), append(args, *v)
	}
	if v := find.CreatorID; v != nil {
		where, args = append(where, "creator_id = "+placeholder(len(args)+1)), append(args, *v)
	}
	if v := find.Title; v != nil {
		where, args = append(where, "title = "+placeholder(len(args)+1)), append(args, *v)
	}

	rows, err := d.db.QueryContext(ctx, `
		SELECT id, uid, creator_id, title, created_ts, updated_ts, sort_field, sort_order, cover_color, cover_image
		FROM workspace
		WHERE `+strings.Join(where, " AND ")+` ORDER BY created_ts ASC`,
		args...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []*store.Workspace
	for rows.Next() {
		w := &store.Workspace{}
		if err := rows.Scan(&w.ID, &w.UID, &w.CreatorID, &w.Title, &w.CreatedTs, &w.UpdatedTs, &w.SortField, &w.SortOrder, &w.CoverColor, &w.CoverImage); err != nil {
			return nil, err
		}
		list = append(list, w)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return list, nil
}

func (d *DB) UpdateWorkspace(ctx context.Context, update *store.UpdateWorkspace) (*store.Workspace, error) {
	set, args := []string{}, []any{}
	if v := update.Title; v != nil {
		set, args = append(set, "title = "+placeholder(len(args)+1)), append(args, *v)
	}
	if v := update.SortField; v != nil {
		set, args = append(set, "sort_field = "+placeholder(len(args)+1)), append(args, *v)
	}
	if v := update.SortOrder; v != nil {
		set, args = append(set, "sort_order = "+placeholder(len(args)+1)), append(args, *v)
	}
	if v := update.CoverColor; v != nil {
		set, args = append(set, "cover_color = "+placeholder(len(args)+1)), append(args, *v)
	}
	if v := update.CoverImage; v != nil {
		set, args = append(set, "cover_image = "+placeholder(len(args)+1)), append(args, *v)
	}
	set = append(set, "updated_ts = EXTRACT(EPOCH FROM NOW())")

	stmt := `
		UPDATE workspace
		SET ` + strings.Join(set, ", ") + `
		WHERE id = ` + placeholder(len(args)+1) + `
		RETURNING id, uid, creator_id, title, created_ts, updated_ts, sort_field, sort_order, cover_color, cover_image
	`
	args = append(args, update.ID)

	w := &store.Workspace{}
	if err := d.db.QueryRowContext(ctx, stmt, args...).Scan(&w.ID, &w.UID, &w.CreatorID, &w.Title, &w.CreatedTs, &w.UpdatedTs, &w.SortField, &w.SortOrder, &w.CoverColor, &w.CoverImage); err != nil {
		return nil, err
	}
	return w, nil
}

func (d *DB) DeleteWorkspace(ctx context.Context, delete *store.DeleteWorkspace) error {
	_, err := d.db.ExecContext(ctx, "DELETE FROM workspace WHERE id = $1", delete.ID)
	return err
}

func (d *DB) CreateWorkspaceFolder(ctx context.Context, create *store.WorkspaceFolder) (*store.WorkspaceFolder, error) {
	stmt := "INSERT INTO workspace_folder (workspace_id, path) VALUES ($1, $2) RETURNING id, created_ts"
	if err := d.db.QueryRowContext(ctx, stmt, create.WorkspaceID, create.Path).Scan(&create.ID, &create.CreatedTs); err != nil {
		return nil, err
	}
	return create, nil
}

func (d *DB) ListWorkspaceFolders(ctx context.Context, find *store.FindWorkspaceFolder) ([]*store.WorkspaceFolder, error) {
	where, args := []string{"1 = 1"}, []any{}
	if v := find.WorkspaceID; v != nil {
		where, args = append(where, "workspace_id = "+placeholder(len(args)+1)), append(args, *v)
	}
	if v := find.Path; v != nil {
		where, args = append(where, "path = "+placeholder(len(args)+1)), append(args, *v)
	}

	rows, err := d.db.QueryContext(ctx, `
		SELECT id, workspace_id, path, created_ts
		FROM workspace_folder
		WHERE `+strings.Join(where, " AND ")+` ORDER BY path ASC`,
		args...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []*store.WorkspaceFolder
	for rows.Next() {
		f := &store.WorkspaceFolder{}
		if err := rows.Scan(&f.ID, &f.WorkspaceID, &f.Path, &f.CreatedTs); err != nil {
			return nil, err
		}
		list = append(list, f)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return list, nil
}

func (d *DB) DeleteWorkspaceFolder(ctx context.Context, delete *store.DeleteWorkspaceFolder) error {
	_, err := d.db.ExecContext(ctx, "DELETE FROM workspace_folder WHERE workspace_id = $1 AND path = $2", delete.WorkspaceID, delete.Path)
	return err
}

// RenameWorkspaceFolder moves oldPath (and anything nested under it) to newPath.
func (d *DB) RenameWorkspaceFolder(ctx context.Context, workspaceID int32, oldPath, newPath string) error {
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	prefix := oldPath + "/"
	replacement := newPath + "/"
	likePrefix := strings.NewReplacer("\\", "\\\\", "%", "\\%", "_", "\\_").Replace(prefix) + "%"

	if _, err := tx.ExecContext(ctx, "UPDATE memo SET folder_path = $1 WHERE workspace_id = $2 AND folder_path = $3", newPath, workspaceID, oldPath); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		"UPDATE memo SET folder_path = $1 || substring(folder_path FROM $2) WHERE workspace_id = $3 AND folder_path LIKE $4",
		replacement, len(prefix)+1, workspaceID, likePrefix,
	); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE workspace_folder SET path = $1 WHERE workspace_id = $2 AND path = $3", newPath, workspaceID, oldPath); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		"UPDATE workspace_folder SET path = $1 || substring(path FROM $2) WHERE workspace_id = $3 AND path LIKE $4",
		replacement, len(prefix)+1, workspaceID, likePrefix,
	); err != nil {
		return err
	}
	return tx.Commit()
}
