-- Canonical character references for plot, world, and timeline records.
-- Empty arrays preserve compatibility with records created before this migration.
ALTER TABLE plot_threads ADD COLUMN character_ids_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(character_ids_json) AND json_type(character_ids_json) = 'array');
ALTER TABLE world_lore ADD COLUMN character_ids_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(character_ids_json) AND json_type(character_ids_json) = 'array');
ALTER TABLE timeline_events ADD COLUMN character_ids_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(character_ids_json) AND json_type(character_ids_json) = 'array');
