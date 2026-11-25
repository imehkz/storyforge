-- Scene Tracker extends project-scoped Story Notes without replacing existing records.
ALTER TABLE story_notes ADD COLUMN chapter_ids_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(chapter_ids_json) AND json_type(chapter_ids_json) = 'array');
ALTER TABLE story_notes ADD COLUMN scene_type TEXT NOT NULL DEFAULT 'other';
ALTER TABLE story_notes ADD COLUMN scene_status TEXT NOT NULL DEFAULT 'planned';
