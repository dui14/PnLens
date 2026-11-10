-- STAGING ONLY. Do not apply this file to production.
-- Proposal: insert exchange_accounts and api_keys in one transaction so a failed
-- key insert cannot leave an account row with no key. proxy_* stay null.

CREATE OR REPLACE FUNCTION public.connect_exchange_account(
  p_user_id uuid,
  p_exchange text,
  p_label text,
  p_key_encrypted text,
  p_secret_encrypted text,
  p_key_iv text,
  p_secret_iv text,
  p_passphrase_encrypted text,
  p_passphrase_iv text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
BEGIN
  INSERT INTO exchange_accounts (user_id, exchange, label, sync_status)
  VALUES (p_user_id, p_exchange, p_label, 'pending')
  RETURNING id INTO v_account_id;

  INSERT INTO api_keys (
    exchange_account_id,
    key_encrypted,
    secret_encrypted,
    key_iv,
    secret_iv,
    passphrase_encrypted,
    passphrase_iv,
    proxy_encrypted,
    proxy_iv
  ) VALUES (
    v_account_id,
    p_key_encrypted,
    p_secret_encrypted,
    p_key_iv,
    p_secret_iv,
    p_passphrase_encrypted,
    p_passphrase_iv,
    NULL,
    NULL
  );

  RETURN v_account_id;
END;
$$;
