-- Persist word counts so the dashboard can show a novel-wide progress total
-- without downloading every chapter body.
ALTER TABLE chapters
ADD COLUMN word_count INTEGER NOT NULL DEFAULT 0;
