-- HeyGen AI avatar video mode + BYOK key.
--
-- Why: ユーザーが動画生成方法を選べるようにする (Remotion vs HeyGen avatar).
-- HeyGen API キーも user ごとに BYOK で保存する。

alter table public.videos
  add column if not exists generation_mode text not null default 'remotion',
  add column if not exists heygen_avatar_id text,
  add column if not exists heygen_voice_id text,
  add column if not exists heygen_video_id text,
  add column if not exists voice_source text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'videos_generation_mode_chk'
  ) then
    alter table public.videos
      add constraint videos_generation_mode_chk
      check (generation_mode in ('remotion', 'heygen_avatar'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'videos_voice_source_chk'
  ) then
    alter table public.videos
      add constraint videos_voice_source_chk
      check (voice_source is null or voice_source in ('elevenlabs', 'heygen'));
  end if;
end $$;

comment on column public.videos.generation_mode is
  'Pipeline branch: remotion (scene composition) or heygen_avatar (talking avatar)';
comment on column public.videos.heygen_avatar_id is
  'HeyGen avatar_id selected by the user (heygen_avatar mode only)';
comment on column public.videos.heygen_voice_id is
  'HeyGen built-in voice_id (only when voice_source=heygen)';
comment on column public.videos.heygen_video_id is
  'HeyGen-side async job id returned from POST /v2/video/generate';
comment on column public.videos.voice_source is
  'Voice synthesis source: elevenlabs (BYOK TTS) or heygen (built-in)';

alter table public.user_api_keys
  add column if not exists heygen_key text;

comment on column public.user_api_keys.heygen_key is
  'Encrypted HeyGen API key (BYOK, AES-GCM v1 prefix scheme)';
