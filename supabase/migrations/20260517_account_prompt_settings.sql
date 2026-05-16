-- アカウントごとのカスタムプロンプト設定
-- 既存のシステムプロンプトに「追加指示」として混ぜる
-- 旧 user_prompt_settings は廃止して account_prompt_settings に置き換え

DROP TABLE IF EXISTS user_prompt_settings;

CREATE TABLE IF NOT EXISTS account_prompt_settings (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  text_extra TEXT,
  image_extra TEXT,
  themes_extra TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE account_prompt_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "account_prompt_settings: own accounts only" ON account_prompt_settings;
CREATE POLICY "account_prompt_settings: own accounts only"
  ON account_prompt_settings FOR ALL
  USING (
    account_id IN (SELECT id FROM accounts WHERE user_id = auth.uid())
  )
  WITH CHECK (
    account_id IN (SELECT id FROM accounts WHERE user_id = auth.uid())
  );
