export type Platform = 'threads' | 'tiktok' | 'instagram' | 'x'
export type PostStatus = 'draft' | 'scheduled' | 'posted' | 'failed'
export type LogAction = 'generated' | 'approved' | 'scheduled' | 'posted' | 'failed'

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
  scheduled_at: string | null
  posted_at: string | null
  platform_post_id: string | null
  error_message: string | null
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
