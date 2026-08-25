package sqlite

import (
	"context"
	"strings"

	"github.com/usememos/memos/store"
)

func (d *DB) CreateSite(ctx context.Context, create *store.Site) (*store.Site, error) {
	stmt := "INSERT INTO `site` (`uid`, `team_id`, `creator_id`, `name`, `description`, `domain`, `domain_verified`, `canonical`, `status`, `dashboard_memo_id`, `dashboard_snapshot`, `theme`, `author_name`, `menu`, `nav`, `search_mode`) " +
		"VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING `id`, `created_ts`, `updated_ts`"
	if err := d.db.QueryRowContext(ctx, stmt,
		create.UID,
		create.TeamID,
		create.CreatorID,
		create.Name,
		create.Description,
		create.Domain,
		create.DomainVerified,
		create.Canonical,
		create.Status,
		create.DashboardMemoID,
		create.DashboardSnapshot,
		create.Theme,
		create.AuthorName,
		create.Menu,
		create.Nav,
		create.SearchMode,
	).Scan(&create.ID, &create.CreatedTs, &create.UpdatedTs); err != nil {
		return nil, err
	}
	return create, nil
}

func (d *DB) ListSites(ctx context.Context, find *store.FindSite) ([]*store.Site, error) {
	where, args := []string{"1 = 1"}, []any{}

	if find.ID != nil {
		where, args = append(where, "`id` = ?"), append(args, *find.ID)
	}
	if find.UID != nil {
		where, args = append(where, "`uid` = ?"), append(args, *find.UID)
	}
	if find.TeamID != nil {
		where, args = append(where, "`team_id` = ?"), append(args, *find.TeamID)
	}
	if find.Domain != nil {
		where, args = append(where, "`domain` = ?"), append(args, *find.Domain)
	}
	if find.Status != nil {
		where, args = append(where, "`status` = ?"), append(args, *find.Status)
	}
	if find.DashboardMemoID != nil {
		where, args = append(where, "`dashboard_memo_id` = ?"), append(args, *find.DashboardMemoID)
	}

	rows, err := d.db.QueryContext(ctx, `
		SELECT
			id,
			uid,
			team_id,
			creator_id,
			name,
			description,
			domain,
			domain_verified,
			canonical,
			status,
			dashboard_memo_id,
			dashboard_snapshot,
			theme,
			author_name,
			menu,
			nav,
			search_mode,
			created_ts,
			updated_ts
		FROM site
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY id ASC`,
		args...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := []*store.Site{}
	for rows.Next() {
		site := &store.Site{}
		if err := rows.Scan(
			&site.ID,
			&site.UID,
			&site.TeamID,
			&site.CreatorID,
			&site.Name,
			&site.Description,
			&site.Domain,
			&site.DomainVerified,
			&site.Canonical,
			&site.Status,
			&site.DashboardMemoID,
			&site.DashboardSnapshot,
			&site.Theme,
			&site.AuthorName,
			&site.Menu,
			&site.Nav,
			&site.SearchMode,
			&site.CreatedTs,
			&site.UpdatedTs,
		); err != nil {
			return nil, err
		}
		list = append(list, site)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return list, nil
}

func (d *DB) UpdateSite(ctx context.Context, update *store.UpdateSite) (*store.Site, error) {
	set, args := []string{"`updated_ts` = (strftime('%s', 'now'))"}, []any{}

	if update.Name != nil {
		set, args = append(set, "`name` = ?"), append(args, *update.Name)
	}
	if update.Description != nil {
		set, args = append(set, "`description` = ?"), append(args, *update.Description)
	}
	if update.Domain != nil {
		set, args = append(set, "`domain` = ?"), append(args, *update.Domain)
	}
	if update.DomainVerified != nil {
		set, args = append(set, "`domain_verified` = ?"), append(args, *update.DomainVerified)
	}
	if update.Canonical != nil {
		set, args = append(set, "`canonical` = ?"), append(args, *update.Canonical)
	}
	if update.Status != nil {
		set, args = append(set, "`status` = ?"), append(args, *update.Status)
	}
	if update.DashboardSnapshot != nil {
		set, args = append(set, "`dashboard_snapshot` = ?"), append(args, *update.DashboardSnapshot)
	}
	if update.DashboardMemoID != nil {
		set, args = append(set, "`dashboard_memo_id` = ?"), append(args, *update.DashboardMemoID)
	}
	if update.Theme != nil {
		set, args = append(set, "`theme` = ?"), append(args, *update.Theme)
	}
	if update.AuthorName != nil {
		set, args = append(set, "`author_name` = ?"), append(args, *update.AuthorName)
	}
	if update.Nav != nil {
		set, args = append(set, "`nav` = ?"), append(args, *update.Nav)
	}
	if update.Menu != nil {
		set, args = append(set, "`menu` = ?"), append(args, *update.Menu)
	}
	if update.SearchMode != nil {
		set, args = append(set, "`search_mode` = ?"), append(args, *update.SearchMode)
	}
	args = append(args, update.ID)

	if _, err := d.db.ExecContext(ctx, "UPDATE `site` SET "+strings.Join(set, ", ")+" WHERE `id` = ?", args...); err != nil {
		return nil, err
	}

	list, err := d.ListSites(ctx, &store.FindSite{ID: &update.ID})
	if err != nil {
		return nil, err
	}
	if len(list) == 0 {
		return nil, nil
	}
	return list[0], nil
}

// DeleteSite removes a site and everything published to it. The connection runs
// with foreign_keys off, so the child rows are deleted explicitly rather than by
// ON DELETE CASCADE.
func (d *DB) DeleteSite(ctx context.Context, delete *store.DeleteSite) error {
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	for _, stmt := range []string{
		"DELETE FROM `site_publication_attachment` WHERE `publication_id` IN (SELECT `id` FROM `site_publication` WHERE `site_id` = ?)",
		"DELETE FROM `site_publication_link` WHERE `publication_id` IN (SELECT `id` FROM `site_publication` WHERE `site_id` = ?)",
		"DELETE FROM `site_publication` WHERE `site_id` = ?",
		"DELETE FROM `site` WHERE `id` = ?",
	} {
		if _, err := tx.ExecContext(ctx, stmt, delete.ID); err != nil {
			return err
		}
	}
	return tx.Commit()
}
