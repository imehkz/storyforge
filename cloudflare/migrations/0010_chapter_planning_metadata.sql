-- Store planning metadata with each manuscript chapter and include it in snapshots.
ALTER TABLE chapters ADD COLUMN synopsis TEXT NOT NULL DEFAULT '';
ALTER TABLE chapters ADD COLUMN writing_status TEXT NOT NULL DEFAULT 'draft'
  CHECK (writing_status IN ('planned', 'draft', 'revised', 'final'));
