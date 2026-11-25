-- Per-chapter workflow tracking and planning metadata.
ALTER TABLE chapters ADD COLUMN workflow_status TEXT NOT NULL DEFAULT 'not_started'
  CHECK (workflow_status IN ('not_started', 'outlining', 'writing', 'first_draft', 'editing', 'pending_approval', 'approved'));
ALTER TABLE chapters ADD COLUMN target_word_count INTEGER NOT NULL DEFAULT 0
  CHECK (target_word_count >= 0 AND target_word_count <= 100000);
ALTER TABLE chapters ADD COLUMN author_notes TEXT NOT NULL DEFAULT '';
