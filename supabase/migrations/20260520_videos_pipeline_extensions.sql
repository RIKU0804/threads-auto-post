-- AI 動画パイプラインのための追加カラム / 制約調整
--
-- 想定パイプライン:
--   videos (script→images→voice→render) → 完成 (ready)
--     → publish_status='unpublished'
--     → TikTok / YouTube に投稿 → publish_status='published', published_to=['tiktok',...]
--
-- このマイグレーションは追加専用 (idempotent)。
-- ・videos     : 公開先 / 公開状態を表すカラム
-- ・scenes     : シーン単位の音声 URL (Storage)
-- ・accounts   : TikTok / YouTube の OAuth ペイロード
-- ・user_api_keys: ElevenLabs キー (`src/lib/video/elevenlabs.ts` が前提とする)
-- ・accounts.platform CHECK 制約に 'tiktok' / 'youtube' を追加

-- ============================================
-- videos: 公開メタデータ
-- ============================================
ALTER TABLE videos
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL;
ALTER TABLE videos
  ADD COLUMN IF NOT EXISTS final_video_url TEXT;
ALTER TABLE videos
  ADD COLUMN IF NOT EXISTS publish_status TEXT NOT NULL DEFAULT 'unpublished';
ALTER TABLE videos
  ADD COLUMN IF NOT EXISTS published_to TEXT[];
ALTER TABLE videos
  ADD COLUMN IF NOT EXISTS tiktok_publish_id TEXT;
ALTER TABLE videos
  ADD COLUMN IF NOT EXISTS youtube_video_id TEXT;
ALTER TABLE videos
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

ALTER TABLE videos DROP CONSTRAINT IF EXISTS videos_publish_status_check;
ALTER TABLE videos
  ADD CONSTRAINT videos_publish_status_check
  CHECK (publish_status IN ('unpublished', 'publishing', 'published', 'publish_failed'));

CREATE INDEX IF NOT EXISTS idx_videos_account_id     ON videos (account_id);
CREATE INDEX IF NOT EXISTS idx_videos_publish_status ON videos (publish_status);

-- ============================================
-- scenes: シーン毎の音声 URL
-- ============================================
ALTER TABLE scenes
  ADD COLUMN IF NOT EXISTS audio_url TEXT;

-- ============================================
-- accounts: TikTok / YouTube OAuth カラム
-- ============================================
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS tiktok_open_id TEXT;
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS tiktok_refresh_token TEXT;
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS youtube_channel_id TEXT;
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS youtube_refresh_token TEXT;

-- 既存 CHECK は 'threads' | 'instagram' | 'x' のみ許可だったため
-- 'tiktok' / 'youtube' を許容するよう貼り直す。
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_platform_check;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_platform_check
  CHECK (platform IN ('threads', 'instagram', 'x', 'tiktok', 'youtube'));

-- ============================================
-- user_api_keys: ElevenLabs キー
-- ============================================
ALTER TABLE user_api_keys
  ADD COLUMN IF NOT EXISTS elevenlabs_key TEXT;
