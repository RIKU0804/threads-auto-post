import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { publishPost } from '@/lib/platforms/publishers'
import type { Account } from '@/types/database'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  // body は任意。{ accountId } を渡すと、account_id が空の post に後付けで割当て可能。
  const body = await req.json().catch(() => ({})) as { accountId?: unknown }
  const overrideAccountId = typeof body.accountId === 'string' && body.accountId.trim().length > 0
    ? body.accountId.trim()
    : null

  const { data: post, error: postError } = await supabase
    .from('posts')
    .select('*, account:accounts(*)')
    .eq('id', id)
    .single()

  if (postError || !post) {
    return NextResponse.json({ error: '投稿が見つかりません' }, { status: 404 })
  }

  let account = post.account as Account | null

  // 所有者チェック (IDOR 対策) - post.user_id を必須とする
  if (!post.user_id || post.user_id !== user.id) {
    return NextResponse.json({ error: '投稿が見つかりません' }, { status: 404 })
  }

  // account が未割当の場合は overrideAccountId で後付け割当を試みる
  if (!account && overrideAccountId) {
    const { data: ownedAccount, error: accErr } = await supabase
      .from('accounts')
      .select('*')
      .eq('id', overrideAccountId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (accErr) {
      console.error('[publish account lookup]', id, accErr.message)
      return NextResponse.json({ error: 'アカウント情報の取得に失敗しました' }, { status: 500 })
    }
    if (!ownedAccount) {
      return NextResponse.json({ error: '指定されたアカウントが見つかりません' }, { status: 404 })
    }
    // posts.account_id を更新して以降のロジックで使えるようにする
    const { error: updErr } = await supabase
      .from('posts')
      .update({ account_id: ownedAccount.id })
      .eq('id', id)
    if (updErr) {
      console.error('[publish account assign]', id, updErr.message)
      return NextResponse.json({ error: 'アカウント割当に失敗しました' }, { status: 500 })
    }
    account = ownedAccount as Account
  }

  if (!account) {
    return NextResponse.json(
      { error: '投稿先アカウントが指定されていません。アカウントを選んで投稿してください' },
      { status: 400 },
    )
  }

  // 冪等性: status が draft / failed のときだけ publishing に遷移できる
  // 二重クリック・並行リクエストで二重投稿を防ぐ
  const { data: locked, error: lockError } = await supabase
    .from('posts')
    .update({ status: 'publishing' })
    .eq('id', id)
    .in('status', ['draft', 'failed'])
    .select('id')
    .maybeSingle()

  if (lockError) {
    console.error('[publish lock]', id, lockError.message)
    return NextResponse.json({ error: '投稿状態の更新に失敗しました' }, { status: 500 })
  }
  if (!locked) {
    return NextResponse.json(
      { error: 'この投稿は既に処理中か投稿済みです' },
      { status: 409 },
    )
  }

  try {
    const result = await publishPost({ post, account })

    await supabase
      .from('posts')
      .update({
        status: 'posted',
        posted_at: new Date().toISOString(),
        platform_post_id: result.platformPostId,
        platform_post_ids: result.platformPostIds ?? null,
        error_message: null,
      })
      .eq('id', id)

    await supabase.from('post_logs').insert({
      post_id: id,
      action: 'posted',
      message: `${account.platform} 投稿成功: ${result.platformPostId}`,
    })

    return NextResponse.json({
      success: true,
      platformPostId: result.platformPostId,
      platformPostIds: result.platformPostIds,
    })
  } catch (e) {
    const internalMessage = e instanceof Error ? e.message : 'unknown'
    console.error('[posts/publish]', id, internalMessage)

    // 失敗時は status を failed に戻して error_message を残す
    await supabase
      .from('posts')
      .update({ status: 'failed', error_message: internalMessage.slice(0, 500) })
      .eq('id', id)

    await supabase.from('post_logs').insert({
      post_id: id,
      action: 'failed',
      message: internalMessage.slice(0, 500),
    })

    // クライアントには固定文言だけ返す（内部エラーメッセージは DB 構造や
    // OAuth トークンなどが漏れうるため client に渡さない）。詳細は上の console.error
    // と posts.error_message を所有者のみが RLS 越しに読める。
    return NextResponse.json({ error: '投稿に失敗しました' }, { status: 400 })
  }
}
