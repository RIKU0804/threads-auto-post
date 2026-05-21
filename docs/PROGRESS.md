# 進捗メモ — 2026-05-20

## 概要

AI動画生成サブシステム + TikTok/YouTube Shorts 自動投稿機能を追加実装。
5並列エージェントで実装 → 3並列エージェントでトリプルレビュー → CRITICAL 6件修正完了。
TypeScript build clean。次は **ユーザー側のセットアップ作業** が必要。

---

## ✅ 完了している作業

### コード実装
- [x] Supabase マイグレーション 3本作成
  - `supabase/migrations/20260520_videos_and_scenes.sql`
  - `supabase/migrations/20260520_videos_pipeline_extensions.sql`
  - `supabase/migrations/20260520_video_storage_bucket.sql`
- [x] 型定義拡張（`src/types/database.ts`）
  - Platform: `'threads' | 'instagram' | 'x' | 'tiktok' | 'youtube'`
  - 新規型: `Video`, `Scene`, `VideoStatus`, `PublishStatus`, `VideoWithScenes`
  - Account に tiktok/youtube カラム追加
  - UserApiKeys に elevenlabs_key 追加
- [x] GPT 台本+シーン分割: `src/lib/video/script.ts`
- [x] ElevenLabs TTS: `src/lib/video/elevenlabs.ts`
- [x] Supabase Storage helpers: `src/lib/video/storage.ts`
- [x] パイプラインオーケストレータ: `src/lib/video/pipeline.ts`
- [x] ジョブキュー抽象: `src/lib/video/jobs.ts`
- [x] Remotion subproject: `remotion/` (composition `ShortVideoMain`, 1080×1920 30fps)
- [x] TikTok publisher 統合 + OAuth: `src/lib/platforms/publishers.ts`, `src/app/api/auth/tiktok/**`
- [x] YouTube publisher 統合 + OAuth: 同上, `src/app/api/auth/youtube/**`
- [x] 動画API: `src/app/api/videos/**`（CRUD + status + regenerate + publish）
- [x] 動画UI: `src/app/(dashboard)/dashboard/videos/**`, `src/components/videos/*.tsx`
- [x] アーキ設計ドキュメント: `docs/video-pipeline-design.md`
- [x] トリプルレビュー結果: `docs/review/{security,architecture,ts-ux}-review.md`

### バグ修正（CRITICAL 6件）
- [x] TikTok access_token を AES-256-GCM で暗号化（YouTube と整合）
- [x] `fetchVideoBytes` (SSRFガード無し) を youtube.ts から削除
- [x] publish 失敗時のクライアント返却を固定文言に変更（DB構造漏洩防止）
- [x] `final_video_url` に signed URL を保存（storagePath だと再生・公開不能）
- [x] ElevenLabs key 取得を userId 引数 + admin client に変更（バックグラウンド対応）
- [x] OpenAI image SDK の double-cast 撤廃、runtime narrowing 化

### バグ修正（HIGH 追加分）
- [x] SceneRow.tsx Audio リーク → useEffect cleanup + useRef
- [x] VideoDetail.tsx ポーリング失敗を Toast 通知（5回連続で警告）
- [x] H-5 (`<video src>` 403) は CRITICAL #4 で自動解決

---

## 🚧 残作業（**ユーザー実施必要**）

### 1. Supabase migration 適用 ✅ **2026-05-20 完了**

本番DB (`rbsndzcymzdwpekvllqt`, ap-northeast-1) に Supabase MCP 経由で適用済み:
- `videos_and_scenes_20260520`
- `videos_pipeline_extensions_20260520`
- `video_storage_bucket_20260520`

確認済: videos / scenes テーブル, final_video_url / audio_url カラム, tiktok / youtube カラム, elevenlabs_key カラム, `videos` Storage バケット (private)

### 2. 環境変数設定

`.env.local`（または Vercel Project Settings）に以下を追加：

```bash
# 暗号化キー（必須・既存）
ENCRYPTION_KEY=<32バイトbase64; openssl rand -base64 32 で生成>

# OpenAI（既存）
OPENAI_API_KEY=sk-...

# ElevenLabs（新規）
ELEVENLABS_API_KEY=...

# TikTok OAuth（新規）
TIKTOK_CLIENT_KEY=...
TIKTOK_CLIENT_SECRET=...
TIKTOK_REDIRECT_URI=https://<your-domain>/api/auth/tiktok/callback

# YouTube OAuth（新規）
YOUTUBE_OAUTH_CLIENT_ID=...
YOUTUBE_OAUTH_CLIENT_SECRET=...
YOUTUBE_OAUTH_REDIRECT_URI=https://<your-domain>/api/auth/youtube/callback

# Vercel
NEXT_PUBLIC_APP_URL=https://<your-domain>

# （任意）バックグラウンドジョブ用
TRIGGER_PUBLIC_API_KEY=<Trigger.dev契約後>
# REMOTION_PROVIDER=lambda  # @remotion/lambda 契約後にこれを有効化
```

### 3. TikTok Developer Portal 申請

URL: https://developers.tiktok.com/

1. アプリ作成（Client Key/Secret 発行）
2. Login Kit 利用申請
3. Content Posting API（Direct Post）申請
4. ⚠️ **PULL_FROM_URL のドメイン事前登録が必要だが、Supabase Storage は登録不可** → 下記「TikTok 設計判断」へ
5. 審査期間: 2〜6週間

### 4. Google Cloud Console（YouTube）セットアップ

URL: https://console.cloud.google.com/

1. 新規プロジェクト作成
2. YouTube Data API v3 を有効化
3. OAuth 2.0 クライアント作成（タイプ: Web アプリケーション）
4. 承認済みリダイレクト URI に `YOUTUBE_OAUTH_REDIRECT_URI` を登録
5. OAuth 同意画面 → **「Testing」モード**を選択
6. **テストユーザー**に納品先クライアントの Gmail を登録
7. これで `youtube.upload` 審査をスキップして使える（クライアント単独利用なら OK）

### 5. TikTok 設計判断（要対話）

PULL_FROM_URL ドメイン登録問題：

- **案A**: FILE_UPLOAD 切替（実装変更 +1〜2日工数）
- **案B**: 中継ドメイン設置（自前CDN/Edgeで `videos.your-domain.com` 経由でSupabaseへ proxy）
- **案C**: TikTok 一旦保留、YouTube Shorts のみ稼働

推奨: **C → A** の順（YouTube先行リリース、TikTokは後追い）

### 6. バックグラウンド実行基盤

現状 `setImmediate` フォールバックで動くが、Vercel の 60s/300s タイムアウトで長尺パイプライン落ちる。
本番運用には必須:

- **Trigger.dev**（推奨、月額無料枠あり）: https://trigger.dev
- または **Inngest**

セットアップ後、`TRIGGER_PUBLIC_API_KEY` を env に追加。

### 7. Remotion レンダリング基盤

現状ローカルレンダ（Chromium 1.5GB必要、Vercel functionsでは動かない）。本番運用には:

- **@remotion/lambda**（AWS、$0.005–0.02/動画、推奨）
- **Cloud Run**（GCP）
- **専用ワーカーサーバー**（EC2/さくらVPS）

`@remotion/lambda` 採用時は `REMOTION_PROVIDER=lambda` env を設定 + `pipeline.ts` の `renderWithRemotionLambda` を実装。

---

## 📋 残バグ（次回対応推奨、現状は動作する）

### Security 残り
- HIGH: TikTok PULL_FROM_URL のドメイン事前登録（運用課題、上記5番）
- MEDIUM: YouTube OAuth state 比較で `timingSafeEqual` 未使用箇所
- MEDIUM: いくつかのエラーメッセージにファイル名が混入
- LOW: `npm audit` 結果未確認

### Architecture 残り
- HIGH: TikTok ドメイン整合性（上記5番）
- MEDIUM: `videos.voice_url` カラムが未使用（per-scene `scenes.audio_url` のみ使う）→ 後日 drop 検討
- MEDIUM: パイプライン途中失敗時の partial state 取り扱い（再開時の挙動）
- MEDIUM: Remotion bundle キャッシュの concurrency race

### TS+UX 残り
- HIGH: API入力検証が手書き typeof（Zodは入ってる、未使用）
- HIGH: `scene.image_prompt as string` 等の cast 後 null 型すり抜け
- MEDIUM: aria-live / role=progressbar 未付与
- MEDIUM: `<img>` を `next/image` に置換すべき箇所
- MEDIUM: YouTube callback の `secure: true` が hardcoded（local dev で動かない）
- LOW: 細かな未使用 export、不要な cast

詳細は `docs/review/*-review.md` を参照。

---

## 🎯 次回 Claude セッションでやること（推奨順）

1. `supabase db push` 実行確認 → エラーがあれば修正
2. 環境変数の動作確認（特に ENCRYPTION_KEY）
3. TikTok / YouTube アプリ申請の進捗確認
4. 申請通り次第、実際の OAuth フローを E2E テスト
5. 残バグ HIGH の追加修正（Zod validation、cast 排除）
6. Trigger.dev 統合
7. @remotion/lambda 統合

---

## 関連リポ

- マスター: `C:\Users\riku0\claude-code\threads-auto-post`
- 納品用: `C:\Users\riku0\claude-code\threads-auto-post-delivery`（Threads単体のまま、未拡張）

クライアント発注内容（参考）:
- 4プラットフォーム × 各依頼+ツール費 = **合計82,000円(税込)** → クライアント返信前に「納品定義」明確化済（マニュアル不要、即時投稿のみ、Remotionテンプレ動画）

---

更新: 2026-05-20
