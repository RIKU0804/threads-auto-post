-- AI ショート動画生成サブシステム
-- ・videos: 動画 1 本のメタ + 全体ナレーション音声 + パイプライン状態
-- ・scenes: 動画を構成するシーン（テロップ / ナレーション / 画像 / 尺）
--
-- パイプライン想定:
--   1. draft でレコード作成
--   2. generating_script  (LLM で全体台本生成 → videos.script を埋める)
--   3. generating_images  (各 scene の image_prompt → gpt-image-1 で生成 → scenes.image_url)
--   4. generating_voice   (ElevenLabs で video 全体の音声合成 → videos.voice_url)
--   5. rendering          (Remotion でレンダリング)
--   6. ready              (完了) / failed (失敗)
--
-- RLS は既存 accounts / posts と同じ「本人のみ」パターン。
-- scenes は video 経由のサブクエリで間接所有を表現（post_logs と同じ流儀）。

-- ============================================
-- videos
-- ============================================
CREATE TABLE IF NOT EXISTS videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  script TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft',
      'generating_script',
      'generating_images',
      'generating_voice',
      'rendering',
      'ready',
      'failed'
    )),
  voice_url TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE videos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "videos: own data only" ON videos;
CREATE POLICY "videos: own data only"
  ON videos FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_videos_user_id ON videos (user_id);
CREATE INDEX IF NOT EXISTS idx_videos_status  ON videos (status);

-- ============================================
-- scenes
-- ============================================
-- order_index: 動画内のシーン順序。仕様には明記されていないが、
-- 並び順制御に必須のため追加した（フラグ: 不要なら相談）。
CREATE TABLE IF NOT EXISTS scenes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID REFERENCES videos(id) ON DELETE CASCADE NOT NULL,
  order_index INTEGER NOT NULL,
  caption_text TEXT,       -- テロップ（Remotion 側で表示するテキスト）
  narration_text TEXT,     -- ナレーション原稿（ElevenLabs で音声化）
  image_prompt TEXT,       -- 画像生成プロンプト
  image_url TEXT,          -- gpt-image-1 で生成された画像（Supabase Storage 想定）
  duration NUMERIC(5,2),   -- シーン尺（秒）
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE scenes ENABLE ROW LEVEL SECURITY;

-- video 経由で所有判定（accounts → posts → post_logs と同じ間接所有パターン）
DROP POLICY IF EXISTS "scenes: own videos only" ON scenes;
CREATE POLICY "scenes: own videos only"
  ON scenes FOR ALL
  USING (
    video_id IN (SELECT id FROM videos WHERE user_id = auth.uid())
  )
  WITH CHECK (
    video_id IN (SELECT id FROM videos WHERE user_id = auth.uid())
  );

CREATE INDEX IF NOT EXISTS idx_scenes_video_id            ON scenes (video_id);
CREATE INDEX IF NOT EXISTS idx_scenes_video_id_order_idx  ON scenes (video_id, order_index);

-- ============================================
-- updated_at 自動更新トリガー（共有関数 update_updated_at を再利用）
-- ============================================
DROP TRIGGER IF EXISTS videos_updated_at ON videos;
CREATE TRIGGER videos_updated_at
  BEFORE UPDATE ON videos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS scenes_updated_at ON scenes;
CREATE TRIGGER scenes_updated_at
  BEFORE UPDATE ON scenes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
