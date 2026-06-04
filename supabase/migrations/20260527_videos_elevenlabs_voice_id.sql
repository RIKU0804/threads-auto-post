-- videos に ElevenLabs voice ID カラムを追加。
-- Remotion 経路の各シーン音声に使う voice を動画単位で保持する。
-- NULL のとき src/lib/video/voice-presets.ts の DEFAULT_VOICE_ID にフォールバック。

ALTER TABLE videos
  ADD COLUMN IF NOT EXISTS elevenlabs_voice_id TEXT;

COMMENT ON COLUMN videos.elevenlabs_voice_id IS
  'ElevenLabs voice ID for narration. NULL = default voice from voice-presets.ts';
