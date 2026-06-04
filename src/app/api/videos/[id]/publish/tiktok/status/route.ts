// TikTok Direct Post の公開ステータス確認エンドポイント。
//
// TikTok は video/init で publish_id を返した時点では公開未完了（非同期ダウンロード）。
// publish-helper は tiktok を publish_status='publishing' のまま残し tiktok_publish_id を保存する。
// クライアントはこのエンドポイントをポーリングして公開完了/失敗を確定させる。

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { createAdminClient } from '@/lib/supabase-admin'
import { decryptSecret } from '@/lib/crypto'
import { checkTikTokPublishStatus, TikTokAuthError } from '@/lib/platforms/tiktok-status'
import type { Platform, Video } from '@/types/database'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

    // 動画の所有者検証 + TikTok アカウント取得（access_token を含む）
    const { data: video, error: vErr } = await supabase
      .from('videos')
      .select('*, account:accounts(*)')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle()
    if (vErr) throw vErr
    if (!video) return NextResponse.json({ error: '動画が見つかりません' }, { status: 404 })

    const v = video as Video & { account: { access_token: string | null; platform: string } | null }

    if (!v.tiktok_publish_id) {
      return NextResponse.json({ error: 'TikTok の公開IDがありません' }, { status: 400 })
    }
    // 既に確定済みならそのまま返す
    if (v.publish_status === 'published' || v.publish_status === 'publish_failed') {
      return NextResponse.json({ state: v.publish_status === 'published' ? 'complete' : 'failed', publishStatus: v.publish_status })
    }

    const accessToken = decryptSecret(v.account?.access_token ?? null)
    if (!accessToken || v.account?.platform !== 'tiktok') {
      return NextResponse.json({ error: 'TikTok アカウントの認証情報がありません' }, { status: 400 })
    }

    let result
    try {
      result = await checkTikTokPublishStatus({ accessToken }, v.tiktok_publish_id)
    } catch (e) {
      if (e instanceof TikTokAuthError) {
        return NextResponse.json({ error: 'TikTok の認証が切れています。再連携してください' }, { status: 401 })
      }
      throw e
    }

    const admin = createAdminClient()

    if (result.state === 'complete') {
      const publishedTo = Array.isArray(v.published_to) ? [...v.published_to] : []
      const tk = 'tiktok' as Platform
      if (!publishedTo.includes(tk)) publishedTo.push(tk)
      await admin
        .from('videos')
        .update({
          publish_status: 'published',
          published_to: publishedTo,
          published_at: new Date().toISOString(),
          error_message: null,
        })
        .eq('id', id)
      return NextResponse.json({ state: 'complete', publishStatus: 'published' })
    }

    if (result.state === 'failed') {
      await admin
        .from('videos')
        .update({
          publish_status: 'publish_failed',
          error_message: (result.failReason ?? 'TikTok 公開に失敗しました').slice(0, 500),
        })
        .eq('id', id)
      return NextResponse.json({ state: 'failed', publishStatus: 'publish_failed' })
    }

    // in_progress / unknown はまだ確定しないので publishing のまま
    return NextResponse.json({ state: result.state, publishStatus: 'publishing', rawStatus: result.rawStatus })
  } catch (e) {
    console.error('[videos/publish/tiktok/status]', id, e instanceof Error ? e.message : 'unknown')
    return NextResponse.json({ error: 'ステータス確認に失敗しました' }, { status: 500 })
  }
}
