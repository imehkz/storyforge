-- Allow world and timeline canon entries to point to chapters in the same project.
ALTER TABLE world_lore ADD COLUMN chapter_ids_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(chapter_ids_json) AND json_type(chapter_ids_json) = 'array');
ALTER TABLE timeline_events ADD COLUMN chapter_ids_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(chapter_ids_json) AND json_type(chapter_ids_json) = 'array');
