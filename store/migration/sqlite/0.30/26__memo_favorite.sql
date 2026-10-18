-- memo_favorite is a user's reading list: documents they marked to read later.
-- Personal: each user sees only their own. Unlike memo.pinned, which every reader
-- of a document shares, this is per user. See docs/dev/requirements/mobile-phase3.md §2.
-- pinned  1 keeps the favorite at the top of the list however old it is.
-- A favorite whose document was deleted or became unreadable is hidden when listed.
CREATE TABLE memo_favorite (
  user_id    INTEGER NOT NULL,
  memo_id    INTEGER NOT NULL,
  pinned     INTEGER NOT NULL DEFAULT 0,
  created_ts BIGINT  NOT NULL DEFAULT (strftime('%s', 'now')),
  PRIMARY KEY (user_id, memo_id)
);
