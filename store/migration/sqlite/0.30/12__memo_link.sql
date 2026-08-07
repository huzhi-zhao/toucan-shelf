-- memo_link records which target memos a memo's markdown content links to.
-- This is a best-effort, fully-derived reverse-link index: it is rebuilt from
-- scratch whenever a memo's content changes (see UpdateMemo), so rows here
-- carry no independent meaning outside of that reparse.
CREATE TABLE memo_link (
  memo_id INTEGER NOT NULL,
  target_memo_id INTEGER NOT NULL,
  UNIQUE(memo_id, target_memo_id)
);

CREATE INDEX idx_memo_link_target_memo_id ON memo_link(target_memo_id);
