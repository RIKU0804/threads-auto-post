-- 動画パイプライン用 Supabase Storage バケット
--
-- ・bucket: 'videos' (非公開)
-- ・パス規約: <auth.uid()>/<video_id>/{scenes/<order>.mp3, final.mp4, ...}
-- ・閲覧は本人のみ、書き込みは service_role のみ
--   (ワーカー / API ルートが service-role キーで Upload する想定)

-- ============================================
-- bucket 作成 (idempotent)
-- ============================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('videos', 'videos', false)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public;

-- ============================================
-- RLS ポリシー
-- ============================================
-- 本人 (auth.uid()) のディレクトリ配下だけ SELECT 可能。
-- storage.objects の `name` は "uid/video-id/..." を想定。
DROP POLICY IF EXISTS "videos bucket: owner can read" ON storage.objects;
CREATE POLICY "videos bucket: owner can read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'videos'
    AND split_part(name, '/', 1) = auth.uid()::text
  );

-- INSERT / UPDATE / DELETE は service_role のみ。
-- 認証ユーザーには明示的に拒否し、ワーカー側で service-role キーを使う。
DROP POLICY IF EXISTS "videos bucket: deny client writes" ON storage.objects;
CREATE POLICY "videos bucket: deny client writes"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS "videos bucket: deny client updates" ON storage.objects;
CREATE POLICY "videos bucket: deny client updates"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (false);

DROP POLICY IF EXISTS "videos bucket: deny client deletes" ON storage.objects;
CREATE POLICY "videos bucket: deny client deletes"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (false);
