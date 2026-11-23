-- Cover brief prompt and selected character references are project-scoped JSON.
ALTER TABLE projects ADD COLUMN cover_brief_json TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(cover_brief_json) AND json_type(cover_brief_json) = 'object');
