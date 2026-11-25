-- Persist per-chapter canonical character references.
ALTER TABLE chapters ADD COLUMN character_ids_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(character_ids_json) AND json_type(character_ids_json) = 'array');
