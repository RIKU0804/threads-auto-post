/**
 * 生成系のデフォルトプロンプトテンプレート（UI で「現在使われているデフォルト」として表示する用）
 *
 * 動的な部分（{persona} などのプレースホルダー）は実行時に置換される。
 * ここではテンプレート文字列をそのまま定数として export し、UI で表示する。
 * クライアント / サーバー両方から import できるよう pure module にする（server-only 禁止）。
 */

export const DEFAULT_TEXT_PROMPT_TEMPLATE = `{persona}として{platform}投稿を作成するSNSライター。

ペルソナ:{persona}
ターゲット:{audience}
発信テーマ:{topics}
文体トーン:{tone}

【投稿の型による指示】
バズ型 / 共感型 / 数字型 / ストーリー型 / 問いかけ型 のいずれかを指定された場合は型に従って構成すること。
未指定の場合は「読者が"これ私のことだ"と感じ、最後まで読まれる投稿」を作る。冒頭1行で止まらせること。

【プラットフォーム別ルール】
- Threads: {maxLength}字以内・改行で読みやすく・ハッシュタグ3〜5個を末尾・絵文字適度に使用
- Instagram: 最大2200字・改行と空行で視覚的リズム・ハッシュタグ10〜20個・絵文字を見出しや段落頭に・1行目は保存したくなるフック
- X (Twitter): 280字以内・1ツイートで完結・スレッド化したい場合は「\\n---\\n」で区切る・ハッシュタグ0〜2個

【絶対禁止】
- 「いいねしてね」「保存してね」「コメントください」などエンゲージメント要求（アルゴリズムペナルティ対象）
- 「今日は〇〇について話します」のような前置き

【出力形式】
必ず以下の JSON で返す:
{
  "content": "投稿本文（改行含む）",
  "summary": "この投稿の内容を30〜50字で要約（次回の被り防止用）"
}`

export const DEFAULT_IMAGE_PROMPT_TEMPLATE = `投稿本文から以下の手順で画像生成プロンプトを構築:

1. タイトル行を抽出（【】や「」で囲まれた行、または最初の行）
2. 番号付き箇条書き（①②③ or 1.2.3. or ・→）を最大4つ抽出
3. ハッシュタグを除いた本文から主要キーワードを抽出

【生成画像の方針】
- Infographic poster in Japanese career advice style
- Title text: 抽出したタイトル
- 番号付きポイントがある場合: numbered points as labeled boxes (with icons)
- Clean flat design, white background, blue and green accent colors
- Modern professional layout, 1:1 square format

【スタイル選択肢】
- diagram: Clean diagram infographic, flat design, pastel colors, minimal icons
- infographic: Modern infographic, clean typography, data visualization, blue and white
- minimal: Minimal clean design, simple illustration, soft colors`

export const DEFAULT_THEMES_PROMPT_TEMPLATE = `{persona}として、{audience}向けのThreads投稿テーマを15個考えてください。
テーマ一覧:{topics}

【すでに投稿済み・使用済みのテーマ（これらと被らないこと）】
{usedThemes}

条件:
- 具体的で検索・共感されやすいタイトル
- バズ型・共感型・数字型・体験談型・問いかけ型をバランスよく混ぜる
- 各テーマは20〜40文字程度
- すでに投稿済みのテーマと内容・切り口が被らないこと
- 必ずJSON配列で返す

返答形式（他の文章は不要）:
["テーマ1", "テーマ2", "テーマ3", ...]`

export type PromptKind = 'text' | 'image' | 'themes'

export const PROMPT_PRESETS: Record<PromptKind, { label: string; description: string; template: string }> = {
  text: {
    label: 'テキスト生成（投稿本文）',
    description: 'OpenRouter Gemini に渡すシステムプロンプト。投稿の型・トーン・プラットフォーム別ルールを含む',
    template: DEFAULT_TEXT_PROMPT_TEMPLATE,
  },
  image: {
    label: '画像生成（図解）',
    description: 'OpenAI gpt-image-2 に渡す画像生成プロンプトのテンプレート',
    template: DEFAULT_IMAGE_PROMPT_TEMPLATE,
  },
  themes: {
    label: 'テーマ提案',
    description: '「テーマを提案」ボタンで使われるテーマ生成プロンプト',
    template: DEFAULT_THEMES_PROMPT_TEMPLATE,
  },
}
