-- Persist project-scoped links from plot threads to manuscript chapters.
ALTER TABLE plot_threads ADD COLUMN chapter_ids_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(chapter_ids_json) AND json_type(chapter_ids_json) = 'array');
