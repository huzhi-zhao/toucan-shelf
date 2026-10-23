-- A plan holds up to ten habits; at most three are pinned to the planner page. Existing plans pin their first
-- three, which is what the page and the calendar showed before.
UPDATE planner_habit_version SET entries = (
  SELECT COALESCE(json_group_array(CASE WHEN CAST(key AS INTEGER) < 3 THEN json_set(value, '$.pinned', json('true')) ELSE json(value) END), '[]')
  FROM (SELECT key, value FROM json_each(planner_habit_version.entries) ORDER BY CAST(key AS INTEGER))
);
UPDATE planner_habit_draft SET entries = (
  SELECT COALESCE(json_group_array(CASE WHEN CAST(key AS INTEGER) < 3 THEN json_set(value, '$.pinned', json('true')) ELSE json(value) END), '[]')
  FROM (SELECT key, value FROM json_each(planner_habit_draft.entries) ORDER BY CAST(key AS INTEGER))
);
