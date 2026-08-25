package sqlite

import (
	"context"
	"strings"

	"github.com/usememos/memos/store"
)

func (d *DB) CreateSitePublication(ctx context.Context, create *store.SitePublication) (*store.SitePublication, error) {
	stmt := "INSERT INTO `site_publication` (`uid`, `site_id`, `memo_id`, `slug`, `title`, `summary`, `content`, `meta`, `source_updated_ts`, `state`, `publisher_id`) " +
		"VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING `id`, `published_ts`, `updated_ts`"
	if err := d.db.QueryRowContext(ctx, stmt,
		create.UID,
		create.SiteID,
		create.MemoID,
		create.Slug,
		create.Title,
		create.Summary,
		create.Content,
		create.Meta,
		create.SourceUpdatedTs,
		create.State,
		create.PublisherID,
	).Scan(&create.ID, &create.PublishedTs, &create.UpdatedTs); err != nil {
		return nil, err
	}
	return create, nil
}

func (d *DB) ListSitePublications(ctx context.Context, find *store.FindSitePublication) ([]*store.SitePublication, error) {
	where, args := []string{"1 = 1"}, []any{}

	if find.ID != nil {
		where, args = append(where, "`id` = ?"), append(args, *find.ID)
	}
	if find.UID != nil {
		where, args = append(where, "`uid` = ?"), append(args, *find.UID)
	}
	if find.SiteID != nil {
		where, args = append(where, "`site_id` = ?"), append(args, *find.SiteID)
	}
	if find.MemoID != nil {
		where, args = append(where, "`memo_id` = ?"), append(args, *find.MemoID)
	}
	if find.Slug != nil {
		where, args = append(where, "`slug` = ?"), append(args, *find.Slug)
	}
	if find.State != nil {
		where, args = append(where, "`state` = ?"), append(args, *find.State)
	}
	if find.MemoIDList != nil {
		if len(find.MemoIDList) == 0 {
			where = append(where, "1 = 0")
		} else {
			placeholders := make([]string, 0, len(find.MemoIDList))
			for _, id := range find.MemoIDList {
				placeholders, args = append(placeholders, "?"), append(args, id)
			}
			where = append(where, "`memo_id` IN ("+strings.Join(placeholders, ", ")+")")
		}
	}

	for _, term := range find.ContentSearch {
		// The snapshot body is searched too, so ExcludeContent may not skip it at
		// the SQL level — it only controls what is returned.
		where = append(where, "(`title` LIKE ? ESCAPE '\\' OR `summary` LIKE ? ESCAPE '\\' OR `content` LIKE ? ESCAPE '\\')")
		pattern := "%" + escapeLike(term) + "%"
		args = append(args, pattern, pattern, pattern)
	}

	contentField := "content"
	if find.ExcludeContent {
		contentField = "''"
	}

	query := `
		SELECT
			id,
			uid,
			site_id,
			memo_id,
			slug,
			title,
			summary,
			` + contentField + `,
			meta,
			source_updated_ts,
			state,
			publisher_id,
			published_ts,
			updated_ts
		FROM site_publication
		WHERE ` + strings.Join(where, " AND ") + `
		ORDER BY id DESC`
	if find.Limit != nil {
		query += " LIMIT ?"
		args = append(args, *find.Limit)
		if find.Offset != nil {
			query += " OFFSET ?"
			args = append(args, *find.Offset)
		}
	}

	rows, err := d.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := []*store.SitePublication{}
	for rows.Next() {
		pub := &store.SitePublication{}
		if err := rows.Scan(
			&pub.ID,
			&pub.UID,
			&pub.SiteID,
			&pub.MemoID,
			&pub.Slug,
			&pub.Title,
			&pub.Summary,
			&pub.Content,
			&pub.Meta,
			&pub.SourceUpdatedTs,
			&pub.State,
			&pub.PublisherID,
			&pub.PublishedTs,
			&pub.UpdatedTs,
		); err != nil {
			return nil, err
		}
		list = append(list, pub)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return list, nil
}

func (d *DB) UpdateSitePublication(ctx context.Context, update *store.UpdateSitePublication) (*store.SitePublication, error) {
	set, args := []string{"`updated_ts` = (strftime('%s', 'now'))"}, []any{}

	if update.Slug != nil {
		set, args = append(set, "`slug` = ?"), append(args, *update.Slug)
	}
	if update.Title != nil {
		set, args = append(set, "`title` = ?"), append(args, *update.Title)
	}
	if update.Summary != nil {
		set, args = append(set, "`summary` = ?"), append(args, *update.Summary)
	}
	if update.Content != nil {
		set, args = append(set, "`content` = ?"), append(args, *update.Content)
	}
	if update.Meta != nil {
		set, args = append(set, "`meta` = ?"), append(args, *update.Meta)
	}
	if update.SourceUpdatedTs != nil {
		set, args = append(set, "`source_updated_ts` = ?"), append(args, *update.SourceUpdatedTs)
	}
	if update.State != nil {
		set, args = append(set, "`state` = ?"), append(args, *update.State)
	}
	if update.PublisherID != nil {
		set, args = append(set, "`publisher_id` = ?"), append(args, *update.PublisherID)
	}
	if update.PublishedTs != nil {
		set, args = append(set, "`published_ts` = ?"), append(args, *update.PublishedTs)
	}
	args = append(args, update.ID)

	if _, err := d.db.ExecContext(ctx, "UPDATE `site_publication` SET "+strings.Join(set, ", ")+" WHERE `id` = ?", args...); err != nil {
		return nil, err
	}

	list, err := d.ListSitePublications(ctx, &store.FindSitePublication{ID: &update.ID})
	if err != nil {
		return nil, err
	}
	if len(list) == 0 {
		return nil, nil
	}
	return list[0], nil
}

// DeleteSitePublication removes a snapshot and its side tables. The connection
// runs with foreign_keys off, so child rows go explicitly.
func (d *DB) DeleteSitePublication(ctx context.Context, delete *store.DeleteSitePublication) error {
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	for _, stmt := range []string{
		"DELETE FROM `site_publication_attachment` WHERE `publication_id` = ?",
		"DELETE FROM `site_publication_link` WHERE `publication_id` = ?",
		"DELETE FROM `site_publication` WHERE `id` = ?",
	} {
		if _, err := tx.ExecContext(ctx, stmt, delete.ID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (d *DB) ReplaceSitePublicationAttachments(ctx context.Context, publicationID int32, refs []*store.SitePublicationAttachment) error {
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, "DELETE FROM `site_publication_attachment` WHERE `publication_id` = ?", publicationID); err != nil {
		return err
	}
	for _, ref := range refs {
		if _, err := tx.ExecContext(ctx,
			"INSERT OR IGNORE INTO `site_publication_attachment` (`publication_id`, `attachment_id`) VALUES (?, ?)",
			publicationID, ref.AttachmentID,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (d *DB) ListSitePublicationAttachments(ctx context.Context, find *store.FindSitePublicationAttachment) ([]*store.SitePublicationAttachment, error) {
	where, args := []string{"1 = 1"}, []any{}

	if find.PublicationID != nil {
		where, args = append(where, "spa.`publication_id` = ?"), append(args, *find.PublicationID)
	}
	if find.AttachmentID != nil {
		where, args = append(where, "spa.`attachment_id` = ?"), append(args, *find.AttachmentID)
	}
	join := ""
	if find.PublishedOnly {
		join = " JOIN site_publication sp ON sp.id = spa.publication_id"
		where, args = append(where, "sp.`state` = ?"), append(args, store.SitePublicationStatePublished)
	}

	rows, err := d.db.QueryContext(ctx, `
		SELECT spa.publication_id, spa.attachment_id
		FROM site_publication_attachment spa`+join+`
		WHERE `+strings.Join(where, " AND "), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := []*store.SitePublicationAttachment{}
	for rows.Next() {
		ref := &store.SitePublicationAttachment{}
		if err := rows.Scan(&ref.PublicationID, &ref.AttachmentID); err != nil {
			return nil, err
		}
		list = append(list, ref)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return list, nil
}

func (d *DB) ReplaceSitePublicationLinks(ctx context.Context, publicationID int32, links []*store.SitePublicationLink) error {
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, "DELETE FROM `site_publication_link` WHERE `publication_id` = ?", publicationID); err != nil {
		return err
	}
	for _, link := range links {
		if _, err := tx.ExecContext(ctx,
			"INSERT OR IGNORE INTO `site_publication_link` (`publication_id`, `target_memo_id`, `raw_href`) VALUES (?, ?, ?)",
			publicationID, link.TargetMemoID, link.RawHref,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (d *DB) ListSitePublicationLinks(ctx context.Context, find *store.FindSitePublicationLink) ([]*store.SitePublicationLink, error) {
	where, args := []string{"1 = 1"}, []any{}

	if find.PublicationID != nil {
		where, args = append(where, "spl.`publication_id` = ?"), append(args, *find.PublicationID)
	}
	if find.TargetMemoID != nil {
		where, args = append(where, "spl.`target_memo_id` = ?"), append(args, *find.TargetMemoID)
	}
	join := ""
	if find.SiteID != nil || find.PublishedOnly {
		join = " JOIN site_publication sp ON sp.id = spl.publication_id"
		if find.SiteID != nil {
			where, args = append(where, "sp.`site_id` = ?"), append(args, *find.SiteID)
		}
		if find.PublishedOnly {
			where, args = append(where, "sp.`state` = ?"), append(args, store.SitePublicationStatePublished)
		}
	}

	rows, err := d.db.QueryContext(ctx, `
		SELECT spl.publication_id, spl.target_memo_id, spl.raw_href
		FROM site_publication_link spl`+join+`
		WHERE `+strings.Join(where, " AND "), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := []*store.SitePublicationLink{}
	for rows.Next() {
		link := &store.SitePublicationLink{}
		if err := rows.Scan(&link.PublicationID, &link.TargetMemoID, &link.RawHref); err != nil {
			return nil, err
		}
		list = append(list, link)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return list, nil
}
