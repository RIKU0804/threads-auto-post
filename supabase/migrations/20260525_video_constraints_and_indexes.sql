-- Composite check: heygen_avatar mode requires voice_source + heygen_avatar_id;
-- if voice_source='heygen', also requires heygen_voice_id.
-- Remotion mode should have voice_source = null.

alter table public.videos
  drop constraint if exists videos_mode_consistency_chk;

alter table public.videos
  add constraint videos_mode_consistency_chk
  check (
    (generation_mode = 'remotion' and voice_source is null)
    or
    (generation_mode = 'heygen_avatar'
      and voice_source is not null
      and heygen_avatar_id is not null
      and (voice_source <> 'heygen' or heygen_voice_id is not null))
  );

-- Index on generation_mode for "show all heygen videos" / cost analytics queries.
create index if not exists idx_videos_generation_mode
  on public.videos (generation_mode);
