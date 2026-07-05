-- Catcher.AI — Supabase Migration: Initial Schema
-- Creates all tables with RLS policies so users can only access their own data.

-- =============================================================================
-- 1. PROFILES (from localStorage cai_prof)
-- =============================================================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  ssn4 TEXT,
  phone TEXT,
  email TEXT,
  subscription_status TEXT DEFAULT 'inactive' CHECK (subscription_status IN ('inactive', 'trialing', 'active', 'past_due', 'canceled')),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = user_id);

-- =============================================================================
-- 2. CREDIT REPORTS (from localStorage cai_report)
-- =============================================================================
CREATE TABLE IF NOT EXISTS credit_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  filename TEXT,
  extracted_text TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE credit_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own credit reports"
  ON credit_reports FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own credit reports"
  ON credit_reports FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own credit reports"
  ON credit_reports FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own credit reports"
  ON credit_reports FOR DELETE
  USING (auth.uid() = user_id);

-- =============================================================================
-- 3. ANALYSES (from localStorage cai_analysis)
-- =============================================================================
CREATE TABLE IF NOT EXISTS analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credit_report_id UUID REFERENCES credit_reports(id) ON DELETE SET NULL,
  summary TEXT,
  items JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own analyses"
  ON analyses FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own analyses"
  ON analyses FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own analyses"
  ON analyses FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own analyses"
  ON analyses FOR DELETE
  USING (auth.uid() = user_id);

-- =============================================================================
-- 4. DISPUTES (from localStorage cai_disputes)
-- =============================================================================
CREATE TABLE IF NOT EXISTS disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  analysis_id UUID REFERENCES analyses(id) ON DELETE SET NULL,
  creditor TEXT NOT NULL,
  bureau TEXT NOT NULL CHECK (bureau IN ('Equifax', 'Experian', 'TransUnion', 'All')),
  account TEXT,
  amount TEXT,
  issue TEXT,
  law TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'escalated', 'resolved', 'deleted')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own disputes"
  ON disputes FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own disputes"
  ON disputes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own disputes"
  ON disputes FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own disputes"
  ON disputes FOR DELETE
  USING (auth.uid() = user_id);

-- =============================================================================
-- 5. LETTERS (from localStorage cai_letters)
-- =============================================================================
CREATE TABLE IF NOT EXISTS letters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dispute_id UUID REFERENCES disputes(id) ON DELETE SET NULL,
  dispute_ids UUID[] DEFAULT '{}',
  creditor TEXT NOT NULL,
  bureau TEXT NOT NULL,
  round INTEGER NOT NULL CHECK (round IN (1, 2, 3)),
  text TEXT,
  mailed BOOLEAN DEFAULT false,
  tracking_id TEXT,
  mailed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE letters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own letters"
  ON letters FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own letters"
  ON letters FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own letters"
  ON letters FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own letters"
  ON letters FOR DELETE
  USING (auth.uid() = user_id);

-- =============================================================================
-- 6. SCORE HISTORY (from localStorage cai_scores)
-- =============================================================================
CREATE TABLE IF NOT EXISTS score_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  score INTEGER NOT NULL CHECK (score >= 300 AND score <= 850),
  recorded_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE score_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own scores"
  ON score_history FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own scores"
  ON score_history FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own scores"
  ON score_history FOR DELETE
  USING (auth.uid() = user_id);

-- =============================================================================
-- 7. MAILING ADDRESSES (from localStorage cai_caddr)
-- =============================================================================
CREATE TABLE IF NOT EXISTS mailing_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  street TEXT NOT NULL,
  city TEXT,
  state TEXT,
  zip TEXT,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE mailing_addresses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own mailing addresses"
  ON mailing_addresses FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own mailing addresses"
  ON mailing_addresses FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own mailing addresses"
  ON mailing_addresses FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own mailing addresses"
  ON mailing_addresses FOR DELETE
  USING (auth.uid() = user_id);

-- =============================================================================
-- 8. INDEXES for performance
-- =============================================================================
CREATE INDEX idx_profiles_user_id ON profiles(user_id);
CREATE INDEX idx_credit_reports_user_id ON credit_reports(user_id);
CREATE INDEX idx_analyses_user_id ON analyses(user_id);
CREATE INDEX idx_disputes_user_id ON disputes(user_id);
CREATE INDEX idx_disputes_status ON disputes(user_id, status);
CREATE INDEX idx_letters_user_id ON letters(user_id);
CREATE INDEX idx_letters_dispute_id ON letters(dispute_id);
CREATE INDEX idx_score_history_user_id ON score_history(user_id);
CREATE INDEX idx_mailing_addresses_user_id ON mailing_addresses(user_id);

-- =============================================================================
-- 9. TRIGGER: Auto-create profile on user signup
-- =============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =============================================================================
-- 10. TRIGGER: Auto-update updated_at timestamps
-- =============================================================================
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER disputes_updated_at
  BEFORE UPDATE ON disputes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
