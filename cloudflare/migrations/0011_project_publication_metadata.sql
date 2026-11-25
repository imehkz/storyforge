-- Publishing metadata is scoped to each novel project.
ALTER TABLE projects ADD COLUMN pen_name TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN copyright_text TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN foreword TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN author_bio TEXT NOT NULL DEFAULT '';
