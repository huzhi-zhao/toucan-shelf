-- Per-folder document-sort override. '' means "inherit": the nearest ancestor
-- folder that sets one wins, falling back to the workspace's own setting, which
-- is exactly the behaviour every folder had before this column existed.
ALTER TABLE workspace_folder ADD COLUMN sort_field TEXT NOT NULL DEFAULT '';
ALTER TABLE workspace_folder ADD COLUMN sort_order TEXT NOT NULL DEFAULT '';
