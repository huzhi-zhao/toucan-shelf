-- memo_link records which target memos a memo's markdown content links to.
-- This is a best-effort, fully-derived reverse-link index: it is rebuilt from
-- scratch whenever a memo's content changes (see UpdateMemo), so rows here
-- carry no independent meaning outside of that reparse.
CREATE TABLE `memo_link` (
  `memo_id` INT NOT NULL,
  `target_memo_id` INT NOT NULL,
  UNIQUE(`memo_id`,`target_memo_id`),
  INDEX `idx_memo_link_target_memo_id` (`target_memo_id`)
);
