import type { Account } from '@/types/database'

// OpenRouter経由でテキスト生成（コスト最適化）
// モデル: google/gemini-2.0-flash-001 (高速・低コスト)
const OPENROUTER_MODEL = 'google/gemini-2.0-flash-001'

type PostType = 'buzz' | 'empathy' | 'numbers' | 'story' | 'question'

interface GenerateTextOptions {
  account: Account
  theme: string
  postType?: string
  recentSummaries?: string[]
  maxLength?: number
}

const postTypeGuide: Record<PostType, string> = {
  buzz: `
【投稿の型：バズ型】

■ 狙い
スクロールを止め、「え、それ本当？」と思わせて拡散させる。

■ 冒頭（1行目が全て）
・逆説＋数字の組み合わせが最強
  例）「高卒で年収500万。学歴より大事だったのは〇〇だった」
  例）「書類落ち30社→翌月に内定。変えたのは1つだけ」
・「〜という常識、嘘でした」「〜は間違いだった」で始める形式も有効
・優しい書き出し厳禁。いきなり本題に入る

■ 構成
1行目：逆説・衝撃事実（読者を止める）
2〜3行：「実は〇〇だった」という種明かし展開
中盤：「なぜそうなのか」を体験談ベースで短く説明
末尾：「これ誰かに教えたくなる」まとめ一言

■ 絶対やらないこと
・「いいねしてね」「保存してね」などの直接的なエンゲージメント要求（Threadsペナルティ対象）
・「今日は〇〇について話します」のような前置き`,

  empathy: `
【投稿の型：共感型】

■ 狙い
「これ私のことだ」と感じさせていいね・引用を最大化する。
共感型はThreadsで最もいいね・リポストに直結する型。

■ 冒頭（読者の心の声をそのまま言語化）
・誰もが感じているが言葉にできていないことを代弁する
  例）「転職したい。でも怖い。でも今のままも嫌。」
  例）「求人見てると、なんか目が死んでいく感覚、わかる？」
・場面描写から入ると「あるある」感が増す
  例）「月曜の朝、布団から出られなかった。また仕事か、と思った瞬間」

■ 構成
1行目：読者の心の声そのまま（短く・鋭く）
2〜3行：「それ、あなただけじゃない」という拡張
中盤：解決策より「そう感じるのは当然」という承認を先に与える
末尾：「同じ経験ある人いますか？」など自然な問いかけ（直接的なコメント誘導は避ける）

■ 文体ルール
・断定より「〜かもしれない」「〜ですよね」
・難しい言葉は使わない。中学生でもわかる言葉で
・解決策を急ぎすぎない。共感が主役`,

  numbers: `
【投稿の型：数字型】

■ 狙い
具体性と信頼感で「保存したい・シェアしたい」情報コンテンツを作る。

■ 冒頭パターン（数字を1行目に必ず入れる）
・リスト宣言型：「高卒転職で失敗する3パターン」
・実績数字型：「書類落ち30社の私が内定をもらった、たった1つの変化」
・統計風：「転職者の7割が後悔する、入社前に確認すべきこと」

■ 構成
1行目：数字＋テーマ（何のリストか一目でわかる）
各項目：「①〇〇：説明」形式で番号付き箇条書き
各項目に1行の体験談・具体例を添える（数字に血を通わせる）
末尾：「以上が〜でした」と締めるか、軽い問いで終わる

■ 数字の使い方
・体験談ベースの数字が信頼感を生む（「30社」「3ヶ月」「年収200万アップ」など）
・「〜割」「〜人に1人」など割合表現も有効
・項目数は3〜5個が最適（多すぎると読まれない）

■ 禁止
・「保存してください」の直接要求
・根拠のない統計の断言`,

  story: `
【投稿の型：ストーリー型】

■ 狙い
読者が「主人公は自分だ」と感じる体験談で感情移入・滞在時間を伸ばす。

■ 冒頭（必ずどん底シーンから始める）
・最も辛かった瞬間・場面から入る
  例）「23歳の秋、10社目の不採用通知を見た瞬間のことは今でも覚えてる」
  例）「『高卒は厳しいですね』と言われた。5社目だった。」
・セリフから始めると映像が浮かびリアリティが増す
・「〇年前の私は〜」という時制表現も有効

■ 構成（4ブロック）
1ブロック：どん底（具体的な場面・感情・セリフ）
2ブロック：転換点（「そんなある日」「3ヶ月後」など時間軸を明示）
3ブロック：変化（何がどう変わったか。数字で示す）
4ブロック：読者への普遍化（「あなたにも〜」で締める）

■ テクニック
・セリフ（「」）を最低1つ使う
・時間軸を数字で明示する（「3ヶ月後」「1年後」）
・感情語を入れる（「怖かった」「悔しかった」「やっと」）
・主人公を"過去の私"にすることで謙虚さと説得力を両立`,

  question: `
【投稿の型：問いかけ型】

■ 狙い
読者が「答えたくなる・考えさせられる」投稿でコメントと滞在時間を増やす。
問いかけ型は初動のコメント発生率が最も高い型。

■ 冒頭パターン
・二択で迫る：「仕事を辞めたい。でも辞めれない。あなたはどっち？」
・常識への問い：「"石の上にも3年"って、誰のための言葉だと思います？」
・逆問い：「転職が怖いんじゃなくて、失敗が怖いだけじゃないですか？」
1行目の問いは短く鋭く。「〜ですよね？」で終わると共感を引きやすい

■ 構成
1行目：問い（読者が「うん、それ」となる鋭い一問）
2〜4行：問いへの自分なりの答えを展開（押しつけず「私はこう思う」で）
中盤：「なぜそう考えるか」を体験談1つで短く補強
末尾：読者への問い返し（「あなたはどうでしたか？」など具体的な一問）

■ 問いかけの作り方
・YESかNOかで答えられる問いより「どっち派？」「いつ気づいた？」が良い
・「コメントください」は絶対に書かない（Threadsのアルゴリズムでペナルティ）
・問いは1投稿に最大2個まで（多いと散漫になる）`,
}

interface GeneratedText {
  content: string
  summary: string
}

export async function generateThreadsText({
  account,
  theme,
  postType,
  recentSummaries = [],
  maxLength = 500,
}: GenerateTextOptions): Promise<GeneratedText> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not configured')

  const persona = account.persona ?? '転職ノウハウ発信者'
  const tone = account.tone ?? 'friendly'
  const audience = account.target_audience ?? 'キャリアに不安のある高卒20代'
  const topics = account.post_topics?.join('、') ?? '転職、キャリア、仕事'

  const toneGuide: Record<string, string> = {
    friendly: 'フランクで親しみやすく、友達に話しかけるような口調',
    professional: '専門的で信頼感があり、プロとしての視点から語る口調',
    personal: '自分の体験談を語るような、等身大の共感しやすい口調',
  }

  // 型指定あり → 詳細プロンプト、なし → 最小限（トークン節約）
  const typeInstruction = postType && postType in postTypeGuide
    ? `\n\n${postTypeGuide[postType as PostType]}`
    : '\n\n読者が「これ私のことだ」と感じ、最後まで読まれる投稿にすること。冒頭1行で止まらせること。'

  // 過去要約は最大10件（トークン節約）
  const summariesToUse = recentSummaries.slice(0, 10)
  const pastSummariesInstruction = summariesToUse.length > 0
    ? `\n\n【過去投稿（切り口・主張・構成を被らせないこと）】\n${summariesToUse.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
    : ''

  const systemPrompt = `${persona}としてThreads投稿を作成するSNSライター。

ペルソナ:${persona} / ターゲット:${audience} / テーマ:${topics} / 文体:${toneGuide[tone] ?? toneGuide.friendly}${typeInstruction}${pastSummariesInstruction}

ルール:${maxLength}字以内・改行で読みやすく・ハッシュタグ3〜5個を末尾に・絵文字適度に使用`

  const userPrompt = `以下のテーマでThreads投稿文を1つ作成してください。

テーマ：${theme}
${recentSummaries.length > 0 ? '\n※ 過去投稿と切り口・主張・構成が被らないようにすること。同じ題材でも別の角度・具体例・フレームで語ること。\n' : ''}
必ず以下のJSON形式で返してください：
{
  "content": "投稿本文（改行含む）",
  "summary": "この投稿の内容を30〜50字で要約（次回の被り防止用）"
}`

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'https://threads-auto-post.vercel.app',
      'X-Title': 'Threads Auto Post',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      max_tokens: 600,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`OpenRouter error ${res.status}: ${err}`)
  }

  const json = await res.json() as {
    choices: Array<{ message: { content: string } }>
  }
  const text = json.choices[0]?.message?.content ?? ''

  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('AI応答のパースに失敗しました')

  const parsed = JSON.parse(jsonMatch[0]) as GeneratedText
  return parsed
}
