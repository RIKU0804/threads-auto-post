import 'server-only'
import crypto from 'crypto'

/**
 * AES-256-GCM による対称暗号化。
 * 用途: user_api_keys など DB に保存する機密文字列を at-rest で暗号化する。
 *
 * 環境変数 ENCRYPTION_KEY:
 *   - 32 バイトの鍵を hex(64文字) または base64 で指定
 *   - 例: `openssl rand -hex 32`
 *
 * 保存フォーマット: `v1:<iv_b64>:<tag_b64>:<ciphertext_b64>`
 * プレフィックスが無い文字列は「平文（移行前データ）」とみなしてそのまま返す。
 */

const PREFIX = 'v1:'

let plaintextWarnedRecently = false
const PLAINTEXT_WARN_INTERVAL_MS = 60_000

function parseKey(raw: string): Buffer {
  // hex 64 文字 or base64 を許容（base64 は厳密判定: ラウンドトリップ一致 + 32 バイト）
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex')
  }
  const buf = Buffer.from(raw, 'base64')
  if (buf.length !== 32 || buf.toString('base64').replace(/=+$/, '') !== raw.replace(/=+$/, '')) {
    // 値そのものは絶対に出さない。長さと文字種だけ診断用に出す
    const looksHexish = /^[0-9a-fA-F]+$/.test(raw)
    throw new Error(
      `ENCRYPTION_KEY invalid: length=${raw.length} (expected 64 hex), ` +
      `allHexChars=${looksHexish}, base64Bytes=${buf.length}`,
    )
  }
  return buf
}

// 環境変数は貼り付け時に空白・改行・引用符が混入しがちなので徹底除去する
// （hex も base64 も内部に空白を含まないため、全空白除去は安全）
function cleanEnv(v: string | undefined): string {
  if (!v) return ''
  return v
    .trim()
    .replace(/^["']|["']$/g, '') // 両端のクォート
    .replace(/\s+/g, '')          // 中間の空白・改行も全除去
    .trim()
}

function getKey(): Buffer {
  const raw = cleanEnv(process.env.ENCRYPTION_KEY)
  if (!raw) throw new Error('ENCRYPTION_KEY is not configured')
  return parseKey(raw)
}

/** 復号で試す鍵の一覧（現行 + ローテーション用の旧鍵）。 */
function getDecryptKeys(): Buffer[] {
  const keys: Buffer[] = []
  const cur = cleanEnv(process.env.ENCRYPTION_KEY)
  const old = cleanEnv(process.env.ENCRYPTION_KEY_OLD)
  if (cur) { try { keys.push(parseKey(cur)) } catch {} }
  if (old) { try { keys.push(parseKey(old)) } catch {} }
  return keys
}

export function isEncryptionAvailable(): boolean {
  return !!cleanEnv(process.env.ENCRYPTION_KEY)
}

export function encryptSecret(plain: string): string {
  const key = getKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`
}

/**
 * 復号。`v1:` プレフィックスが無ければ平文（移行前）とみなしてそのまま返す。
 * 復号失敗時は null。
 */
export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null
  if (!stored.startsWith(PREFIX)) {
    // 移行前の平文データ
    if (!plaintextWarnedRecently) {
      console.warn('[crypto] decryptSecret: legacy plaintext value detected (no v1: prefix). Re-save the key to encrypt.')
      plaintextWarnedRecently = true
      setTimeout(() => { plaintextWarnedRecently = false }, PLAINTEXT_WARN_INTERVAL_MS)
    }
    return stored
  }
  const [ivB64, tagB64, ctB64] = stored.slice(PREFIX.length).split(':')
  if (!ivB64 || !tagB64 || !ctB64) return null

  // 現行鍵 → 旧鍵 の順で復号を試す（鍵ローテーション対応）
  for (const key of getDecryptKeys()) {
    try {
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(ivB64, 'base64'),
      )
      decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
      const pt = Buffer.concat([
        decipher.update(Buffer.from(ctB64, 'base64')),
        decipher.final(),
      ])
      return pt.toString('utf8')
    } catch {
      // 次の鍵で再試行
    }
  }
  return null
}
