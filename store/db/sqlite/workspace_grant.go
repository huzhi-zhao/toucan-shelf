package sqlite

import (
	"context"
	"strings"

	"github.com/usememos/memos/store"
)

func (d *DB) CreateWorkspaceGrant(ctx context.Context, create *store.WorkspaceGrant) (*store.WorkspaceGrant, error) {
	if create.SubjectType == "" {
		create.SubjectType = store.WorkspaceGrantSubjectUser
	}
	stmt := "INSERT INTO `workspace_grant` (`workspace_id`, `subject_type`, `subject_id`, `role`, `granted_by`) VALUES (?, ?, ?, ?, ?) RETURNING `id`, `created_ts`"
	if err := d.db.QueryRowContext(ctx, stmt,
		create.WorkspaceID,
		string(create.SubjectType),
		create.SubjectID,
		string(create.Role),
		create.GrantedBy,
	).Scan(
		&create.ID,
		&create.CreatedTs,
	); err != nil {
		return nil, err
	}
	return create, nil
}

func (d *DB) ListWorkspaceGrants(ctx context.Context, find *store.FindWorkspaceGrant) ([]*store.WorkspaceGrant, error) {
	where, args := workspaceGrantFilter(find.ID, find.WorkspaceID, find.SubjectType, find.SubjectID)

	rows, err := d.db.QueryContext(ctx, `
		SELECT
			id,
			workspace_id,
			subject_type,
			subject_id,
			role,
			granted_by,
			created_ts
		FROM workspace_grant
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY id ASC`,
		args...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := []*store.WorkspaceGrant{}
	for rows.Next() {
		grant := &store.WorkspaceGrant{}
		var subjectType, role string
		if err := rows.Scan(
			&grant.ID,
			&grant.WorkspaceID,
			&subjectType,
			&grant.SubjectID,
			&role,
			&grant.GrantedBy,
			&grant.CreatedTs,
		); err != nil {
			return nil, err
		}
		grant.SubjectType = store.WorkspaceGrantSubjectType(subjectType)
		grant.Role = store.WorkspaceGrantRole(role)
		list = append(list, grant)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}
	return list, nil
}

func (d *DB) UpdateWorkspaceGrant(ctx context.Context, update *store.UpdateWorkspaceGrant) (*store.WorkspaceGrant, error) {
	grant := &store.WorkspaceGrant{}
	var subjectType, role string
	if err := d.db.QueryRowContext(ctx, `
		UPDATE workspace_grant
		SET role = ?
		WHERE id = ?
		RETURNING id, workspace_id, subject_type, subject_id, role, granted_by, created_ts`,
		string(update.Role), update.ID,
	).Scan(
		&grant.ID,
		&grant.WorkspaceID,
		&subjectType,
		&grant.SubjectID,
		&role,
		&grant.GrantedBy,
		&grant.CreatedTs,
	); err != nil {
		return nil, err
	}
	grant.SubjectType = store.WorkspaceGrantSubjectType(subjectType)
	grant.Role = store.WorkspaceGrantRole(role)
	return grant, nil
}

func (d *DB) DeleteWorkspaceGrant(ctx context.Context, delete *store.DeleteWorkspaceGrant) error {
	where, args := workspaceGrantFilter(delete.ID, delete.WorkspaceID, delete.SubjectType, delete.SubjectID)
	_, err := d.db.ExecContext(ctx, "DELETE FROM `workspace_grant` WHERE "+strings.Join(where, " AND "), args...)
	return err
}

func workspaceGrantFilter(id, workspaceID *int32, subjectType *store.WorkspaceGrantSubjectType, subjectID *int32) ([]string, []any) {
	where, args := []string{"1 = 1"}, []any{}
	if id != nil {
		where, args = append(where, "`id` = ?"), append(args, *id)
	}
	if workspaceID != nil {
		where, args = append(where, "`workspace_id` = ?"), append(args, *workspaceID)
	}
	if subjectType != nil {
		where, args = append(where, "`subject_type` = ?"), append(args, string(*subjectType))
	}
	if subjectID != nil {
		where, args = append(where, "`subject_id` = ?"), append(args, *subjectID)
	}
	return where, args
}
