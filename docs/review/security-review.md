# Security Review — AI Short-Video Generation Subsystem

**Date**: 2026-05-20
**Scope**: TikTok/YouTube OAuth, video pipeline, publish routes, RLS, crypto
**Reviewer**: security-reviewer agent

---

## Findings

---

### [CRITICAL] TikTok access_token stored in plaintext
**File**: `src/app/api/auth/tiktok/callback/route.ts:148–169`
**Issue**: The TikTok short-lived `access_token` is written to `accounts.access_token` without encryption; only the `refresh_token` is encrypted.
**Risk**: If the DB is compromised or an `accounts` row is read via a future IDOR, a live TikTok access token is immediately usable by an attacker to post content as the victim until it expires.
**Fix**: Encrypt the access token with `encryptSecret` before INSERT/UPDATE, and `decryptSecret` in the publisher — exactly as is already done for `youtube_refresh_token` and `tiktok_refresh_token`. Compare YouTube callback (line 131: `const encryptedAccess = encryptSecret(token.access_token)`) — TikTok is missing the equivalent.

---

### [CRITICAL] `fetchVideoBytes` in youtube.ts lacks SSRF guards
**File**: `src/lib/platforms/youtube.ts:73–83`
**Issue**: The exported `fetchVideoBytes` function does no IP/scheme validation and does not set `redirect: 'manual'`, making it trivially exploitable as an SSRF proxy if called with an attacker-supplied URL.
**Risk**: An attacker who gains control of any call site (or if the function is exposed through a future route) can reach internal metadata endpoints (169.254.169.254/latest/meta-data on AWS/GCP), localhost services, or private IP ranges via server-side fetch, potentially leaking cloud credentials.
**Fix**: Apply the same `assertFetchableHttpsUrl` + `redirect: 'manual'` + `AbortSignal.timeout` pattern used in `fetchVideoBytesSafe` (publishers.ts:325). The function is `export`ed, so it can be called from arbitrary code. Either add guards inside it or remove the export and force callers to use the hardened `fetchVideoBytesSafe`.

Note: the actual YouTube publisher path (`youtubePublisher.publish`) calls the hardened `fetchVideoBytesSafe`, not `fetchVideoBytes`, so the exploit path requires a new caller. However, the unguarded export is a loaded weapon.

---

### [CRITICAL] Internal error messages returned verbatim to clients
**File**: `src/app/api/videos/_lib/publish-helper.ts:126–127`
**Issue**: `clientMessage` is set to `e.message` and returned directly in a `400` JSON response, with no filtering.
**Risk**: `e.message` can contain: Supabase error detail strings (including table/column names), platform API error bodies (TikTok/YouTube HTTP error text), internal file paths from Node modules, or partial token content if an OAuth error echoes back the credential. This leaks internal infrastructure details to any user who can trigger a publish failure.
**Fix**: Use a fixed user-facing string (`'公開に失敗しました'`) for the HTTP response. Keep the full internal error in `console.error` and in `videos.error_message` (which is only accessible by the video's owner via RLS). Pattern already used correctly in the `GET /api/videos` error handler: `return NextResponse.json({ error: '取得に失敗しました' }, { status: 500 })`.

---

### [HIGH] No rate limit on regenerate-scene (expensive AI operations)
**File**: `src/app/api/videos/[id]/regenerate-scene/route.ts`
**Issue**: `POST /api/videos/[id]/regenerate-scene` dispatches `regenerateSceneImage` (gpt-image-1, ~$0.04/image at medium quality) or `regenerateSceneAudio` (ElevenLabs TTS) on every valid request, with no rate limit check.
**File (context)**: `src/app/api/videos/route.ts:52` — the pipeline-kickoff `POST /api/videos` does have `VIDEO_CREATE_LIMIT = 5 / hour`. Regeneration is un-limited.
**Risk**: A logged-in user with a valid scene can call this endpoint in a tight loop and rack up unbounded OpenAI image-generation or ElevenLabs TTS charges against their own (or a shared) API key. At 5-scene videos this can also trigger 5× parallel ElevenLabs TTS calls per burst.
**Fix**: Apply `checkRateLimit` with a per-user bucket such as `'scene:regenerate'` (e.g., 10 per hour) before the scene ownership check. Use `failMode: 'closed'` to match the video-create pattern.

---

### [HIGH] ElevenLabs key encryption is opportunistic, not enforced
**File**: `src/lib/video/elevenlabs.ts:106–129`
**Issue**: `fetchElevenLabsKey` falls back to `process.env.ELEVENLABS_API_KEY` (plaintext server env), and the DB column `user_api_keys.elevenlabs_key` — when populated — is decrypted with `decryptSecret`, but there is no enforcement that the column value was encrypted before storage. The migration at `20260520_videos_pipeline_extensions.sql:70` adds the column as `TEXT` with no constraint.
**Risk**: If a code path or future migration inserts an ElevenLabs key as plaintext (e.g., a user-settings save route that forgets to call `encryptSecret`), `decryptSecret` will silently return the raw string (it passes through any value without the `v1:` prefix — see `crypto.ts:81–83`). The key is then logged at risk in any future accidental `console.error` that includes the decrypted value.
**Fix**: Follow the same explicit enforcement pattern used in `tiktok/callback` (lines 94–98): check `isEncryptionAvailable()` before allowing the key to be saved; refuse to save plaintext. Also confirm any user-settings route that writes `elevenlabs_key` calls `encryptSecret`.

---

### [HIGH] Publish error message may contain OAuth token fragments
**File**: `src/app/api/videos/_lib/publish-helper.ts:126–127` (also noted as CRITICAL above for information leakage)
**Issue**: This sub-finding is specifically about OAuth tokens: if `refreshYouTubeAccessToken` or `refreshTikTokAccountToken` throws with a message that includes part of the refresh token (e.g., an HTTP error body that echoes the `refresh_token` parameter), that message propagates to `e.message` and then to the client via `clientMessage`.
**Risk**: Partial token material exposed to the browser/API consumer, enabling token replay if the fragment is sufficient.
**Fix**: Same fix as the CRITICAL finding above — sanitize client error responses to a generic string.

---

### [HIGH] YouTube callback missing `import 'server-only'`
**File**: `src/app/api/auth/youtube/route.ts:1` and `src/app/api/auth/youtube/callback/route.ts:1`
**Issue**: Neither YouTube OAuth route has `import 'server-only'` at the top, unlike the TikTok routes (`src/app/api/auth/tiktok/route.ts:21` and `src/app/api/auth/tiktok/callback/route.ts:16`) which do.
**Risk**: Without `server-only`, the Next.js bundler will not prevent the module from being accidentally included in a client bundle. If `YOUTUBE_OAUTH_CLIENT_SECRET` or `ENCRYPTION_KEY` are referenced server-side in these files and a future accidental client-side import occurs, the secret could be bundled into the client JS.
**Fix**: Add `import 'server-only'` as the first line of both `src/app/api/auth/youtube/route.ts` and `src/app/api/auth/youtube/callback/route.ts`.

---

### [MEDIUM] `publish_status` optimistic lock is not atomic (TOCTOU)
**File**: `src/app/api/videos/_lib/publish-helper.ts:70–84`
**Issue**: The ownership check (`SELECT ... WHERE user_id = userId`) and the lock acquisition (`UPDATE ... SET publish_status = 'publishing' WHERE publish_status IN ('unpublished', 'publish_failed')`) are two separate database round-trips with the user-scoped Supabase client.
**Risk**: Under concurrent requests from the same user (e.g., double-click or parallel API calls), both requests can observe `publish_status = 'unpublished'` before either writes `'publishing'`. Both updates can succeed because Supabase JS applies RLS row-filtering but does not provide row-level advisory locks. The result is a double-publish to TikTok/YouTube, wasting quota and potentially creating duplicate videos on the platform.
**Fix**: Execute a single atomic conditional update that combines the owner check with the status CAS in one statement:
```sql
UPDATE videos
SET publish_status = 'publishing', account_id = $accountId
WHERE id = $videoId
  AND user_id = $userId
  AND publish_status IN ('unpublished', 'publish_failed')
RETURNING id;
```
The Supabase JS `.update().eq('id',...).eq('user_id',...).in('publish_status',...).select('id').maybeSingle()` chain achieves this atomically if done in one call. The current code splits ownership into a prior `.select()` which is the TOCTOU gap.

---

### [MEDIUM] `video.error_message` written verbatim from internal exceptions
**File**: `src/lib/video/pipeline.ts:143–148`
**Issue**: `markVideoFailed` writes `err.message` directly to `videos.error_message` with no length cap other than the TEXT column type (unlimited in Postgres).
**Risk**: `err.message` from Supabase client errors can contain SQL fragments, internal table names, or constraint names. These are then readable by the video owner via `GET /api/videos/[id]` (which returns `error_message`), and could expose schema details to a user.
**Fix**: Apply `.slice(0, 500)` on the error message before storage (pattern already used in `publish-helper.ts:122`) and strip sensitive keywords if necessary.

---

### [MEDIUM] `secure: true` missing on TikTok state cookie in non-production
**File**: `src/app/api/auth/tiktok/route.ts:55`
**Issue**: The TikTok state cookie sets `secure: process.env.NODE_ENV === 'production'`, meaning the cookie is sent over HTTP in development/staging environments.
**Risk**: In staging environments served over HTTP, the CSRF-protection state cookie can be observed by a network attacker, allowing the state token to be stolen and used to complete the OAuth flow on behalf of the victim.
**Fix**: The YouTube route already uses `secure: true` unconditionally (line 60 in `youtube/route.ts`). Apply the same unconditional `secure: true` to the TikTok state cookie. Local dev using `localhost` still works with `secure: true` in most modern browsers.

---

### [MEDIUM] No per-user cumulative video count limit
**File**: `src/app/api/videos/route.ts:52–64`
**Issue**: The rate limit allows 5 video creations per hour per user, but there is no lifetime or daily cap on total stored videos. Each video triggers expensive operations: OpenAI image gen (N scenes × ~$0.04), ElevenLabs TTS (N scenes × per-character billing), and Remotion rendering (CPU-hours).
**Risk**: A user who creates 5 videos/hour over many hours accumulates unbounded API costs and storage usage. The rate limit is a latency gate, not a cost gate.
**Fix**: Add a configurable `MAX_VIDEOS_PER_USER` check before INSERT. Query `COUNT(*) FROM videos WHERE user_id = $userId` and reject with `402 / 429` if above threshold. Consider a separate daily cap in addition to the per-hour rate limit.

---

### [MEDIUM] Storage path traversal protection relies on string checks alone
**File**: `src/lib/video/storage.ts:44–51`
**Issue**: `assertId` checks for `/`, `..`, and `\` in userId/videoId. These should be UUIDs from Supabase, but the function accepts arbitrary strings from callers. If a future caller passes non-UUID values (e.g., from an LLM-generated field), a crafted string like `%2F` or a Unicode lookalike could bypass the ASCII check and produce a valid path that crosses into another user's prefix.
**Risk**: If exploited, an attacker-controlled userId could point scene assets at another user's Storage prefix, overwriting their files.
**Fix**: Add a strict UUID regex validation: `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)`. UUIDs from Supabase auth will always match.

---

### [LOW] `appUrl()` hardcoded fallback leaks production hostname
**File**: `src/app/api/auth/tiktok/callback/route.ts:34–36`, `src/app/api/auth/youtube/callback/route.ts:27–29`
**Issue**: Both callback routes fall back to `'https://threads-auto-post-umber.vercel.app'` if `NEXT_PUBLIC_APP_URL` is unset.
**Risk**: In a misconfigured staging environment where `NEXT_PUBLIC_APP_URL` is not set, OAuth redirects go to the production hostname. This is a deployment hygiene issue, not a direct vulnerability, but it can cause staging OAuth sessions to pollute production accounts.
**Fix**: Remove the hardcoded fallback. Throw an error or fall back to a clearly non-production string (`'http://localhost:3000'`) so that misconfiguration is immediately obvious.

---

### [LOW] Logging `oauthError` value from query param without sanitization
**File**: `src/app/api/auth/tiktok/callback/route.ts:65`
**Issue**: `console.error('[tiktok/callback] provider error', oauthError)` logs the raw `error` query parameter without truncation.
**Risk**: An attacker can craft a URL to this callback with an `error` parameter containing very long strings or control characters, polluting server logs. Low severity because it is not exploitable beyond log noise.
**Fix**: `console.error('[tiktok/callback] provider error', oauthError?.slice(0, 64))`.

---

### [LOW] `youtube/callback` logs raw `errorParam` (same issue)
**File**: `src/app/api/auth/youtube/callback/route.ts:103–105`
**Issue**: `errorParam` is sliced to 64 chars for the redirect URL but not for the `console.warn` log line, which uses the raw value.
**Risk**: Same log pollution as above.
**Fix**: Apply the same 64-char truncation to the `console.warn` call.

---

## Positive Findings (What Was Done Well)

- **AES-256-GCM with random IV**: `crypto.ts` uses `crypto.randomBytes(12)` for each encryption, preventing IV reuse. The `v1:` prefix versioning is clean for future key rotation.
- **Key rotation support**: `ENCRYPTION_KEY_OLD` fallback in `getDecryptKeys()` is a production-grade pattern.
- **`timingSafeEqual` on both OAuth flows**: Both TikTok and YouTube callback routes use `crypto.timingSafeEqual` for state comparison. Correct.
- **State cookie cleared after use**: Both callback routes delete the state cookie before completing, preventing replay.
- **`server-only` on all critical lib files**: `crypto.ts`, `publishers.ts`, `tiktok.ts`, `elevenlabs.ts`, `pipeline.ts`, `storage.ts` all have `import 'server-only'`.
- **SSRF guards in `assertFetchableHttpsUrl`**: Covers loopback, RFC 1918, link-local, `::ffff:` IPv4-mapped, fc00::/7, and `.local` domains. `redirect: 'manual'` prevents redirect-based bypass.
- **RLS fully enabled**: `videos`, `scenes`, and `storage.objects` all have explicit RLS policies. Storage bucket is non-public with read-only policy for owners and deny-all writes for authenticated users.
- **IDOR protection on all video routes**: `GET /api/videos/[id]`, `GET /api/videos/[id]/status`, and `POST /api/videos/[id]/regenerate-scene` all filter by `user_id = auth.uid()`.
- **Publish idempotency gate**: The `publish_status IN ('unpublished', 'publish_failed')` conditional update prevents re-publishing a video that is already published or in-flight.
- **Input validation on `POST /api/videos`**: `theme` length bounded to 3–200 chars; `sceneCount` and `targetDurationSec` clamped via `clampInt`. Rate limit is fail-closed (`'closed'`).
- **`tiktok_refresh_token` and `youtube_refresh_token` encrypted at rest**: Both are encrypted before DB write and decrypted only at publish time. Plaintext tokens never written.
- **Error bodies from token endpoints not logged**: Both TikTok and YouTube token exchange functions explicitly log only the HTTP status code, not the response body, to avoid echoing secrets.
- **YouTube access token not persisted**: `refreshYouTubeAccessToken` intentionally does not save the short-lived access token to DB; it is used in-memory only.
- **Storage path traversal basic guards**: `assertId` in `storage.ts` blocks `/`, `..`, and `\` in path components.

---

## Unverifiable Items

- **Supabase RLS enforcement at runtime**: The migration SQL looks correct, but actual RLS enforcement depends on the Supabase project having `Row Level Security` enabled at the project level. This cannot be verified without live DB access.
- **`user_api_keys.elevenlabs_key` write path**: No user-settings route for saving ElevenLabs keys was visible in the reviewed files. Whether encryption is applied at write time is unverified.
- **Remotion `chromiumOptions`**: The renderer is invoked with `chromiumOptions: {}`. Whether Chrome's sandbox is active in the deployment environment (Vercel / Lambda) is unverifiable from code alone. A sandboxless Chrome render is a significant RCE surface if LLM-generated content reaches the renderer.
- **TikTok PULL_FROM_URL domain allowlisting**: TikTok requires the video domain to be pre-registered in their developer portal. Whether `supabasestorage.co` (or the actual Supabase domain) is registered there is a deployment concern, not visible in code.
- **`npm audit`**: Was not run in this environment. Dependency vulnerability status unknown.
