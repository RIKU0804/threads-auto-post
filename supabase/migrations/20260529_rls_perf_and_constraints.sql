-- =====================================================================
-- RLS 性能改善 + 制約の整合（2026-05-29 全体レビュー対応）
-- =====================================================================
-- 1. 全 RLS ポリシーの auth.uid() を (SELECT auth.uid()) でラップ。
--    PostgreSQL は auth.uid() を「行ごと」に再評価するため、大きなテーブルで
--    フルスキャン的なオーバーヘッドになる。(SELECT ...) でラップすると
--    initplan として 1 回だけ評価される（Supabase 公式推奨）。
-- 2. scenes に (video_id, order_index) の UNIQUE 制約（重複 order_index による
--    非決定的ソートを防ぐ）。
-- 3. reference_accounts / post_themes の platform CHECK を tiktok / youtube まで拡張
--    （accounts は既に拡張済みで TS の Platform 型とも一致させる）。
--
-- 冪等性: DROP POLICY IF EXISTS → CREATE POLICY の順で再適用可能。
-- =====================================================================

-- ---- accounts ----
DROP POLICY IF EXISTS "accounts: own data only" ON accounts;
CREATE POLICY "accounts: own data only"
  ON accounts FOR ALL
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ---- user_api_keys ----
DROP POLICY IF EXISTS "user_api_keys: own data only" ON user_api_keys;
CREATE POLICY "user_api_keys: own data only"
  ON user_api_keys FOR ALL
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ---- reference_accounts ----
DROP POLICY IF EXISTS "reference_accounts: own data only" ON reference_accounts;
CREATE POLICY "reference_accounts: own data only"
  ON reference_accounts FOR ALL
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ---- account_prompt_settings ----
DROP POLICY IF EXISTS "account_prompt_settings: own accounts only" ON account_prompt_settings;
CREATE POLICY "account_prompt_settings: own accounts only"
  ON account_prompt_settings FOR ALL
  USING (account_id IN (SELECT id FROM accounts WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (account_id IN (SELECT id FROM accounts WHERE user_id = (SELECT auth.uid())));

-- ---- posts ----
DROP POLICY IF EXISTS "posts: own data only" ON posts;
CREATE POLICY "posts: own data only"
  ON posts FOR ALL
  USING (
    user_id = (SELECT auth.uid())
    OR account_id IN (SELECT id FROM accounts WHERE user_id = (SELECT auth.uid()))
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
    OR account_id IN (SELECT id FROM accounts WHERE user_id = (SELECT auth.uid()))
  );

-- ---- post_themes ----
DROP POLICY IF EXISTS "post_themes: own accounts only" ON post_themes;
CREATE POLICY "post_themes: own accounts only"
  ON post_themes FOR ALL
  USING (account_id IN (SELECT id FROM accounts WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (account_id IN (SELECT id FROM accounts WHERE user_id = (SELECT auth.uid())));

-- ---- post_logs ----
DROP POLICY IF EXISTS "post_logs: own posts only" ON post_logs;
CREATE POLICY "post_logs: own posts only"
  ON post_logs FOR ALL
  USING (
    post_id IN (
      SELECT id FROM posts
      WHERE user_id = (SELECT auth.uid())
         OR account_id IN (SELECT id FROM accounts WHERE user_id = (SELECT auth.uid()))
    )
  )
  WITH CHECK (
    post_id IN (
      SELECT id FROM posts
      WHERE user_id = (SELECT auth.uid())
         OR account_id IN (SELECT id FROM accounts WHERE user_id = (SELECT auth.uid()))
    )
  );

-- ---- videos ----
DROP POLICY IF EXISTS "videos: own data only" ON videos;
CREATE POLICY "videos: own data only"
  ON videos FOR ALL
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ---- scenes ----
DROP POLICY IF EXISTS "scenes: own videos only" ON scenes;
CREATE POLICY "scenes: own videos only"
  ON scenes FOR ALL
  USING (video_id IN (SELECT id FROM videos WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (video_id IN (SELECT id FROM videos WHERE user_id = (SELECT auth.uid())));

-- =====================================================================
-- 2. scenes の (video_id, order_index) UNIQUE
-- =====================================================================
-- 既に重複がある場合に備え、重複を解消してから制約を張る。
WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY video_id ORDER BY order_index, id) - 1 AS new_idx
  FROM scenes
)
UPDATE scenes s
SET order_index = ranked.new_idx
FROM ranked
WHERE s.id = ranked.id AND s.order_index <> ranked.new_idx;

ALTER TABLE scenes DROP CONSTRAINT IF EXISTS scenes_video_order_unique;
ALTER TABLE scenes ADD CONSTRAINT scenes_video_order_unique UNIQUE (video_id, order_index);

-- =====================================================================
-- 3. platform CHECK の拡張（reference_accounts のみ。post_themes は platform 列なし）
-- =====================================================================
ALTER TABLE reference_accounts DROP CONSTRAINT IF EXISTS reference_accounts_platform_check;
ALTER TABLE reference_accounts ADD CONSTRAINT reference_accounts_platform_check
  CHECK (platform IN ('threads', 'instagram', 'x', 'tiktok', 'youtube'));
