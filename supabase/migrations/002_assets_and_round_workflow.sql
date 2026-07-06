-- Catcher.AI — Migration 002: Assets Table + Round-Based Dispute Workflow
-- Adds: assets table, round tracking fields on disputes, response storage

-- =============================================================================
-- 1. ADD ROUND TRACKING FIELDS TO DISPUTES
-- =============================================================================
ALTER TABLE disputes
  ADD COLUMN IF NOT EXISTS current_round INTEGER DEFAULT 1 CHECK (current_round IN (1, 2, 3)),
  ADD COLUMN IF NOT EXISTS round_status TEXT DEFAULT 'drafted' CHECK (round_status IN ('drafted', 'sent', 'awaiting_response', 'response_received', 'complete')),
  ADD COLUMN IF NOT EXISTS response_due_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS round1_response_text TEXT,
  ADD COLUMN IF NOT EXISTS round1_response_file_url TEXT,
  ADD COLUMN IF NOT EXISTS round1_response_confidence NUMERIC,
  ADD COLUMN IF NOT EXISTS round1_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS round2_response_text TEXT,
  ADD COLUMN IF NOT EXISTS round2_response_file_url TEXT,
  ADD COLUMN IF NOT EXISTS round2_response_confidence NUMERIC,
  ADD COLUMN IF NOT EXISTS round2_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS round3_response_text TEXT,
  ADD COLUMN IF NOT EXISTS round3_response_file_url TEXT,
  ADD COLUMN IF NOT EXISTS round3_response_confidence NUMERIC,
  ADD COLUMN IF NOT EXISTS round3_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;

-- =============================================================================
-- 2. ASSETS TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('identity_document', 'proof_of_address', 'round_bundle')),
  file_url TEXT,
  file_name TEXT,
  file_type TEXT,
  file_size INTEGER,
  related_dispute_id UUID REFERENCES disputes(id) ON DELETE SET NULL,
  related_round INTEGER CHECK (related_round IN (1, 2, 3)),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own assets"
  ON assets FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own assets"
  ON assets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own assets"
  ON assets FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own assets"
  ON assets FOR DELETE
  USING (auth.uid() = user_id);

-- =============================================================================
-- 3. STORAGE BUCKET FOR FILE UPLOADS (responses, identity docs)
-- =============================================================================
-- Note: This creates a storage bucket via SQL. If running in Supabase dashboard,
-- you may need to create the bucket manually in Storage settings instead.
INSERT INTO storage.buckets (id, name, public)
VALUES ('user-documents', 'user-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: Users can only access their own folder (user_id prefix)
CREATE POLICY "Users can upload own documents"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'user-documents' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can view own documents"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'user-documents' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can delete own documents"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'user-documents' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );

-- =============================================================================
-- 4. INDEXES
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_assets_user_id ON assets(user_id);
CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(user_id, type);
CREATE INDEX IF NOT EXISTS idx_assets_dispute ON assets(related_dispute_id);
CREATE INDEX IF NOT EXISTS idx_disputes_round_status ON disputes(user_id, round_status);
CREATE INDEX IF NOT EXISTS idx_disputes_response_due ON disputes(response_due_date) WHERE round_status = 'awaiting_response';
