package mysql

import (
	"context"
	"strings"

	"github.com/pkg/errors"

	"github.com/usememos/memos/store"
)

func (d *DB) CreateWorkspace(ctx context.Context, create *store.Workspace) (*store.Workspace, error) {
	fields := []string{"`uid`", "`creator_id`", "`title`"}
	placeholders := []string{"?", "?", "?"}
	args := []any{create.UID, create.CreatorID, create.Title}

	stmt := "INSERT INTO `workspace` (" + strings.Join(fields, ", ") + ") VALUES (" + strings.Join(placeholders, ", ") + ")"
	result, err := d.db.ExecContext(ctx, stmt, args...)
	if err != nil {
		return nil, err
	}
	rawID, err := result.LastInsertId()
	if err != nil {
		return nil, err
	}
	id := int32(rawID)
	workspace, err := d.getWorkspace(ctx, &store.FindWorkspace{ID: &id})
	if err != nil {
		return nil, err
	}
	if workspace == nil {
		return nil, errors.Errorf("failed to create workspace")
	}
	return workspace, nil
}

func (d *DB) getWorkspace(ctx context.Context, find *store.FindWorkspace) (*store.Workspace, error) {
	list, err := d.ListWorkspaces(ctx, find)
	if err != nil {
		return nil, err
	}
	if len(list) == 0 {
		return nil, nil
	}
	return list[0], nil
}

func (d *DB) ListWorkspaces(ctx context.Context, find *store.FindWorkspace) ([]*store.Workspace, error) {
	where, args := []string{"1 = 1"}, []any{}
	if v := find.ID; v != nil {
		where, args = append(where, "`id` = ?"), append(args, *v)
	}
	if v := find.UID; v != nil {
		where, args = append(where, "`uid` = ?"), append(args, *v)
	}
	if v := find.CreatorID; v != nil {
		where, args = append(where, "`creator_id` = ?"), append(args, *v)
	}
	if v := find.Title; v != nil {
		where, args = append(where, "`title` = ?"), append(args, *v)
	}

	rows, err := d.db.QueryContext(ctx, `
		SELECT
			id, uid, creator_id, title,
			UNIX_TIMESTAMP(created_ts) AS created_ts,
			UNIX_TIMESTAMP(updated_ts) AS updated_ts,
			sort_field, sort_order, cover_color, cover_image
		FROM `+"`workspace`"+`
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
		set, args = append(set, "`title` = ?"), append(args, *v)
	}
	if v := update.SortField; v != nil {
		set, args = append(set, "`sort_field` = ?"), append(args, *v)
	}
	if v := update.SortOrder; v != nil {
		set, args = append(set, "`sort_order` = ?"), append(args, *v)
	}
	if v := update.CoverColor; v != nil {
		set, args = append(set, "`cover_color` = ?"), append(args, *v)
	}
	if v := update.CoverImage; v != nil {
		set, args = append(set, "`cover_image` = ?"), append(args, *v)
	}
	set = append(set, "`updated_ts` = NOW()")
	args = append(args, update.ID)

	stmt := "UPDATE `workspace` SET " + strings.Join(set, ", ") + " WHERE `id` = ?"
	if _, err := d.db.ExecContext(ctx, stmt, args...); err != nil {
		return nil, err
	}
	workspace, err := d.getWorkspace(ctx, &store.FindWorkspace{ID: &update.ID})
	if err != nil {
		return nil, err
	}
	if workspace == nil {
		return nil, errors.Errorf("workspace %d not found", update.ID)
	}
	return workspace, nil
}

func (d *DB) DeleteWorkspace(ctx context.Context, delete *store.DeleteWorkspace) error {
	_, err := d.db.ExecContext(ctx, "DELETE FROM `workspace` WHERE `id` = ?", delete.ID)
	return err
}

func (d *DB) CreateWorkspaceFolder(ctx context.Context, create *store.WorkspaceFolder) (*store.WorkspaceFolder, error) {
	stmt := "INSERT INTO `workspace_folder` (`workspace_id`, `path`) VALUES (?, ?)"
	result, err := d.db.ExecContext(ctx, stmt, create.WorkspaceID, create.Path)
	if err != nil {
		return nil, err
	}
	rawID, err := result.LastInsertId()
	if err != nil {
		return nil, err
	}
	create.ID = int32(rawID)

	if err := d.db.QueryRowContext(ctx, "SELECT UNIX_TIMESTAMP(`created_ts`) FROM `workspace_folder` WHERE `id` = ?", create.ID).Scan(&create.CreatedTs); err != nil {
		return nil, err
	}
	return create, nil
}

func (d *DB) ListWorkspaceFolders(ctx context.Context, find *store.FindWorkspaceFolder) ([]*store.WorkspaceFolder, error) {
	where, args := []string{"1 = 1"}, []any{}
	if v := find.WorkspaceID; v != nil {
		where, args = append(where, "`workspace_id` = ?"), append(args, *v)
	}
	if v := find.Path; v != nil {
		where, args = append(where, "`path` = ?"), append(args, *v)
	}

	rows, err := d.db.QueryContext(ctx, `
		SELECT id, workspace_id, path, UNIX_TIMESTAMP(created_ts) AS created_ts
		FROM `+"`workspace_folder`"+`
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
	_, err := d.db.ExecContext(ctx, "DELETE FROM `workspace_folder` WHERE `workspace_id` = ? AND `path` = ?", delete.WorkspaceID, delete.Path)
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

	if _, err := tx.ExecContext(ctx, "UPDATE `memo` SET `folder_path` = ? WHERE `workspace_id` = ? AND `folder_path` = ?", newPath, workspaceID, oldPath); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		"UPDATE `memo` SET `folder_path` = CONCAT(?, SUBSTRING(`folder_path`, ?)) WHERE `workspace_id` = ? AND `folder_path` LIKE ?",
		replacement, len(prefix)+1, workspaceID, likePrefix,
	); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE `workspace_folder` SET `path` = ? WHERE `workspace_id` = ? AND `path` = ?", newPath, workspaceID, oldPath); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		"UPDATE `workspace_folder` SET `path` = CONCAT(?, SUBSTRING(`path`, ?)) WHERE `workspace_id` = ? AND `path` LIKE ?",
		replacement, len(prefix)+1, workspaceID, likePrefix,
	); err != nil {
		return err
	}
	return tx.Commit()
}
