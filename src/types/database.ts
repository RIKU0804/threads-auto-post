export type Platform = 'threads' | 'instagram' | 'x' | 'tiktok' | 'youtube'
export type PostStatus = 'draft' | 'publishing' | 'posted' | 'failed'
export type LogAction = 'generated' | 'approved' | 'posted' | 'failed'

export type VideoStatus =
  | 'draft'
  | 'generating_script'
  | 'generating_images'
  | 'generating_voice'
  | 'rendering'
  | 'ready'
  | 'failed'

export type PublishStatus = 'unpublished' | 'publishing' | 'published' | 'publish_failed'

export interface Account {
  id: string
  user_id: string
  platform: Platform
  name: string
  persona: string | null
  tone: string
  target_audience: string | null
  post_topics: string[] | null
  access_token: string | null
  token_expires_at: string | null
  threads_user_id: string | null
  threads_client_id: string | null
  threads_client_secret: string | null
  instagram_user_id: string | null
  x_user_id: string | null
  // X OAuth 1.0a User Context（Developer Portal の4キー）
  x_api_key: string | null
  x_api_secret: string | null
  x_access_secret: string | null
  // TikTok / YouTube OAuth (refresh tokens are stored encrypted at the app layer)
  tiktok_open_id: string | null
  tiktok_refresh_token: string | null
  youtube_channel_id: string | null
  youtube_refresh_token: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Post {
  id: string
  user_id: string | null
  account_id: string | null
  text_content: string | null
  image_url: string | null
  image_prompt: string | null
  theme: string | null
  status: PostStatus
  posted_at: string | null
  platform_post_id: string | null
  platform_post_ids: string[] | null
  error_message: string | null
  summary: string | null
  created_at: string
  updated_at: string
}

export interface PostTheme {
  id: string
  account_id: string
  theme: string
  description: string | null
  example_post: string | null
  is_active: boolean
  created_at: string
}

export interface PostLog {
  id: string
  post_id: string
  action: LogAction
  message: string | null
  created_at: string
}

export interface PostWithAccount extends Post {
  account: Account
}

export interface ReferenceAccount {
  id: string
  user_id: string
  name: string
  platform: Platform
  handle: string | null
  notes: string | null
  created_at: string
}

export interface UserApiKeys {
  user_id: string
  openrouter_key: string | null
  openai_key: string | null
  elevenlabs_key: string | null
  updated_at: string
}

export interface Video {
  id: string
  user_id: string
  account_id: string | null
  title: string
  script: string | null
  status: VideoStatus
  voice_url: string | null
  final_video_url: string | null
  publish_status: PublishStatus
  published_to: Platform[] | null
  tiktok_publish_id: string | null
  youtube_video_id: string | null
  published_at: string | null
  error_message: string | null
  created_at: string
  updated_at: string
}

export interface Scene {
  id: string
  video_id: string
  order_index: number
  caption_text: string | null
  narration_text: string | null
  image_prompt: string | null
  image_url: string | null
  audio_url: string | null
  duration: number | null
  created_at: string
  updated_at: string
}

export interface VideoWithScenes extends Video {
  scenes: Scene[]
}

export interface AccountPromptSettings {
  account_id: string
  text_extra: string | null
  image_extra: string | null
  themes_extra: string | null
  updated_at: string
}
