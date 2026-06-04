-- 動画生成開始時刻を保存。リロード後も進捗バーの経過時間が継続するように使う。
-- 初回生成および restart 時に書き込まれる (pipeline.ts / restart route)。

ALTER TABLE videos
  ADD COLUMN IF NOT EXISTS generation_started_at TIMESTAMPTZ;

COMMENT ON COLUMN videos.generation_started_at IS
  'Timestamp when the generation pipeline started. NULL until first kick. Used by the UI to compute elapsed time so progress survives page reloads.';
