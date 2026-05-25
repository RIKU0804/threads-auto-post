-- Add Instagram Reels support to the videos table.
--
-- Why: video publishing previously supported tiktok / youtube only. Adding
-- Instagram Reels as a third destination requires one new column to store the
-- platform-side reel ID (mirroring tiktok_publish_id / youtube_video_id).
--
-- published_to already stores a Platform[] enum so we don't need a separate
-- column for "was published to instagram"; the new column only holds the
-- returned Reels media ID for later reference.

alter table public.videos
  add column if not exists instagram_reel_id text;

comment on column public.videos.instagram_reel_id is
  'Instagram Graph API media ID returned from /media_publish for a Reels post';
