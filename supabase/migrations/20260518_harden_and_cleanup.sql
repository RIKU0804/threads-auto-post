-- セキュリティ強化 + 残骸掃除
-- ・TikTok 残骸の孤児カラム (heygen_*) を削除
-- ・rate_limits / increment_rate_limit を service_role 限定に（最小権限）
-- ・increment_rate_limit に確率的 cleanup を内蔵（テーブル肥大防止）
--
-- 注: user_api_keys / account_prompt_settings は API ルートが authenticated
--     ロールでアクセスし RLS で行制限しているため、テーブル権限は維持する。

-- ----- 孤児カラム削除 -----
ALTER TABLE accounts DROP COLUMN IF EXISTS heygen_avatar_id;
ALTER TABLE accounts DROP COLUMN IF EXISTS heygen_voice_id;

-- ----- rate_limits を service_role 限定 -----
REVOKE ALL ON public.rate_limits FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION increment_rate_limit(uuid, text, integer) FROM anon, authenticated;

-- ----- RPC を再定義（確率的 cleanup を内蔵） -----
CREATE OR REPLACE FUNCTION increment_rate_limit(
  p_user_id UUID,
  p_bucket TEXT,
  p_window_seconds INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_count INTEGER;
BEGIN
  v_window_start := to_timestamp(
    floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds
  );

  -- 約1%の確率で2日より古いウィンドウ行を掃除（cron 不要のセルフメンテナンス）
  IF random() < 0.01 THEN
    DELETE FROM rate_limits WHERE window_start < now() - interval '2 days';
  END IF;

  INSERT INTO rate_limits (user_id, bucket, window_start, count)
  VALUES (p_user_id, p_bucket, v_window_start, 1)
  ON CONFLICT (user_id, bucket, window_start)
  DO UPDATE SET count = rate_limits.count + 1
  RETURNING count INTO v_count;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION increment_rate_limit(uuid, text, integer) FROM anon, authenticated;
