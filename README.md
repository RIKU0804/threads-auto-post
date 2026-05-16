# SNS Auto Post — マルチプラットフォーム自動投稿システム

Threads / Instagram / X 向けの AI 自動投稿管理 Web アプリ。

## 機能

- **AIテキスト生成** — ペルソナ別の投稿文を自動生成（OpenRouter / Gemini）
- **AI図解生成** — 投稿に合わせた図解画像を自動生成（OpenAI gpt-image-2）
- **参考投稿（テキスト・画像）** — 参考にしたい投稿/画像をペーストしてテイスト寄せ
- **プレビュー・承認フロー** — 確認してから投稿
- **多アカウント対応** — ペルソナ別に複数アカウント管理
- **Threads / Instagram / X** に対応（X はスレッド投稿対応・トークンは自動リフレッシュ）

## セットアップ

### 1. 環境変数

```bash
cp .env.example .env.local
```

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxxx
SUPABASE_SERVICE_ROLE_KEY=xxxx
NEXT_PUBLIC_APP_URL=https://your-domain.example
OPENAI_API_KEY=sk-xxxx
OPENROUTER_API_KEY=sk-or-xxxx
# X (Twitter) の refresh_token を使う場合のみ（access_token のみで運用するなら不要）
X_CLIENT_ID=xxxx
X_CLIENT_SECRET=xxxx
```

### 2. Supabase DBセットアップ

[supabase.com](https://supabase.com) でプロジェクト作成後、SQL Editor で `supabase/schema.sql` を実行（新規）。
既存環境を最新化する場合は `supabase/migrations/` の SQL を順番に適用する。
画像アップロード用に Storage バケット `post-images` を作成（public read を有効化）。

### 3. プラットフォーム別の認証

- **Threads**: [developers.facebook.com](https://developers.facebook.com) で App を作成し Threads API を追加 → long-lived access token を取得 → アプリの「アカウント管理」画面で登録。期限切れ時は publish 実行時に自動でリフレッシュされる。
- **Instagram**: Instagram Business Account を Facebook Page に接続 → Graph API の access token を取得 → アプリで `instagram` を選んで登録（Business Account ID は自動取得）。
- **X (Twitter)**: X Developer Portal で OAuth 2.0 アプリを作成し、ユーザー access_token を取得（scope: `tweet.write tweet.read users.read offline.access`）→ アプリの「アカウント追加」画面で X タブを開き、access_token を貼り付けて登録。refresh_token を併せて設定すると自動更新されます。

### 4. 起動

```bash
npm install
npm run dev
```

### 5. Vercel デプロイ

```bash
vercel
```

## 技術スタック

| カテゴリ | 技術 |
|----------|------|
| フロントエンド | Next.js 16 + Tailwind CSS |
| DB | Supabase (PostgreSQL + RLS) |
| テキスト生成 | OpenRouter (Gemini 2.0 Flash) |
| 画像生成 | OpenAI gpt-image-2 |
| 投稿API | Threads Graph API / Instagram Graph API / X API v2 |
| デプロイ | Vercel |

---

*This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).*

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
