package sqlite

import (
	"context"
	"fmt"
	"strings"

	"github.com/usememos/memos/store"
)

func (d *DB) CreateWorkspace(ctx context.Context, create *store.Workspace) (*store.Workspace, error) {
	fields := []string{"`uid`", "`creator_id`", "`title`"}
	placeholders := []string{"?", "?", "?"}
	args := []any{create.UID, create.CreatorID, create.Title}

	stmt := "INSERT INTO `workspace` (" + strings.Join(fields, ", ") + ") VALUES (" + strings.Join(placeholders, ", ") + ") RETURNING `id`, `created_ts`, `updated_ts`, `sort_field`, `sort_order`, `cover_color`, `cover_image`"
	if err := d.db.QueryRowContext(ctx, stmt, args...).Scan(&create.ID, &create.CreatedTs, &create.UpdatedTs, &create.SortField, &create.SortOrder, &create.CoverColor, &create.CoverImage); err != nil {
		return nil, err
	}
	return create, nil
}

func (d *DB) ListWorkspaces(ctx context.Context, find *store.FindWorkspace) ([]*store.Workspace, error) {
	where, args := []string{"1 = 1"}, []any{}
	if v := find.ID; v != nil {
		where, args = append(where, "id = ?"), append(args, *v)
	}
	if v := find.UID; v != nil {
		where, args = append(where, "uid = ?"), append(args, *v)
	}
	if v := find.CreatorID; v != nil {
		where, args = append(where, "creator_id = ?"), append(args, *v)
	}
	if v := find.Title; v != nil {
		where, args = append(where, "title = ?"), append(args, *v)
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
		set, args = append(set, "title = ?"), append(args, *v)
	}
	if v := update.SortField; v != nil {
		set, args = append(set, "sort_field = ?"), append(args, *v)
	}
	if v := update.SortOrder; v != nil {
		set, args = append(set, "sort_order = ?"), append(args, *v)
	}
	if v := update.CoverColor; v != nil {
		set, args = append(set, "cover_color = ?"), append(args, *v)
	}
	if v := update.CoverImage; v != nil {
		set, args = append(set, "cover_image = ?"), append(args, *v)
	}
	set = append(set, "updated_ts = (strftime('%s', 'now'))")
	args = append(args, update.ID)

	stmt := `
		UPDATE workspace
		SET ` + strings.Join(set, ", ") + `
		WHERE id = ?
		RETURNING id, uid, creator_id, title, created_ts, updated_ts, sort_field, sort_order, cover_color, cover_image
	`
	w := &store.Workspace{}
	if err := d.db.QueryRowContext(ctx, stmt, args...).Scan(&w.ID, &w.UID, &w.CreatorID, &w.Title, &w.CreatedTs, &w.UpdatedTs, &w.SortField, &w.SortOrder, &w.CoverColor, &w.CoverImage); err != nil {
		return nil, err
	}
	return w, nil
}

func (d *DB) DeleteWorkspace(ctx context.Context, delete *store.DeleteWorkspace) error {
	if _, err := d.db.ExecContext(ctx, "DELETE FROM workspace WHERE id = ?", delete.ID); err != nil {
		return err
	}
	return nil
}

func (d *DB) CreateWorkspaceFolder(ctx context.Context, create *store.WorkspaceFolder) (*store.WorkspaceFolder, error) {
	stmt := "INSERT INTO `workspace_folder` (`workspace_id`, `path`) VALUES (?, ?) RETURNING `id`, `created_ts`"
	if err := d.db.QueryRowContext(ctx, stmt, create.WorkspaceID, create.Path).Scan(&create.ID, &create.CreatedTs); err != nil {
		return nil, err
	}
	return create, nil
}

func (d *DB) ListWorkspaceFolders(ctx context.Context, find *store.FindWorkspaceFolder) ([]*store.WorkspaceFolder, error) {
	where, args := []string{"1 = 1"}, []any{}
	if v := find.WorkspaceID; v != nil {
		where, args = append(where, "workspace_id = ?"), append(args, *v)
	}
	if v := find.Path; v != nil {
		where, args = append(where, "path = ?"), append(args, *v)
	}

	rows, err := d.db.QueryContext(ctx, fmt.Sprintf(`
		SELECT id, workspace_id, path, created_ts
		FROM workspace_folder
		WHERE %s ORDER BY path ASC`, strings.Join(where, " AND ")),
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
	if _, err := d.db.ExecContext(ctx, "DELETE FROM workspace_folder WHERE workspace_id = ? AND path = ?", delete.WorkspaceID, delete.Path); err != nil {
		return err
	}
	return nil
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
	stmts := []string{
		"UPDATE memo SET folder_path = ? WHERE workspace_id = ? AND folder_path = ?",
		"UPDATE memo SET folder_path = ? || substr(folder_path, ?) WHERE workspace_id = ? AND folder_path LIKE ? ESCAPE '\\'",
		"UPDATE workspace_folder SET path = ? WHERE workspace_id = ? AND path = ?",
		"UPDATE workspace_folder SET path = ? || substr(path, ?) WHERE workspace_id = ? AND path LIKE ? ESCAPE '\\'",
	}
	if _, err := tx.ExecContext(ctx, stmts[0], newPath, workspaceID, oldPath); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, stmts[1], replacement, len(prefix)+1, workspaceID, escapeLike(prefix)+"%"); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, stmts[2], newPath, workspaceID, oldPath); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, stmts[3], replacement, len(prefix)+1, workspaceID, escapeLike(prefix)+"%"); err != nil {
		return err
	}
	return tx.Commit()
}

func escapeLike(s string) string {
	s = strings.ReplaceAll(s, "\\", "\\\\")
	s = strings.ReplaceAll(s, "%", "\\%")
	s = strings.ReplaceAll(s, "_", "\\_")
	return s
}
