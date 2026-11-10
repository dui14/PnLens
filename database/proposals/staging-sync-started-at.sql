-- STAGING ONLY. Do not apply this file to production.
-- Proposal: record when a scan claim started so a stale syncing row can be reclaimed.

ALTER TABLE public.exchange_accounts
  ADD COLUMN IF NOT EXISTS sync_started_at TIMESTAMPTZ;
