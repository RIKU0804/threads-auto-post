# TypeScript / UX Review -- Video Generation Feature
> threads-auto-post / Next.js 16.2.4 / 2026-05-20  
> Scope: src/lib/video/, src/lib/platforms/publishers.ts, src/app/api/auth/{tiktok,youtube}/, src/app/api/videos/, src/app/(dashboard)/dashboard/videos/, src/components/videos/
> Excluded: remotion/ subpackage

---

## Verdict: BLOCK -- 2 CRITICAL + 7 HIGH issues must be resolved before merge

---

## CRITICAL Issues

### C-1 -- elevenlabs.ts:108 -- Request-scoped Supabase client called from detached background job
**File:** `src/lib/video/elevenlabs.ts`

`fetchElevenLabsKey()` calls `createServerSupabaseClient()`, which reads `cookies()` from the Next.js request context. This function is invoked from `pipeline.ts` inside a `setImmediate` callback -- a detached background task with no active HTTP request.

Result: `supabase.auth.getUser()` always resolves to `{ user: null }`. The per-user API key lookup is silently bypassed and the pipeline falls through to `process.env.ELEVENLABS_API_KEY`. Every video is billed to the app owner key regardless of which user triggered generation, and any user can exhaust the shared quota.

**Fix:** Resolve the user ID or API key from the request handler **before** crossing the `setImmediate` boundary. Pass it as an explicit argument into the pipeline. Do not call `createServerSupabaseClient` outside a live request context. If a DB lookup is needed inside the job, use `createAdminClient` with an explicit user ID.

---

### C-2 -- pipeline.ts:283 -- Double-cast through unknown erases OpenAI SDK return type
**File:** `src/lib/video/pipeline.ts`

    (client.images.generate as unknown as ImageGenerateFn)({ model: ..., ... })

The hand-rolled `ImageGenerateFn` interface is not validated against the actual SDK type. If the SDK response shape drifts (e.g. `data[].url` becomes optional), the cast silently accepts the mismatch and the downstream `scene.image_url = response.data[0].url!` non-null assertion throws at runtime instead of compile time.

**Fix:** Use the SDK return type directly. If the SDK types are incomplete for gpt-image-1, augment them with a declaration merge -- do not bypass via `as unknown`.

---

## HIGH Issues

### H-1 -- pipeline.ts:328, 370 -- Unsafe `as string` casts on nullable columns
**File:** `src/lib/video/pipeline.ts`

Both DB columns are typed `string | null`. A plain `.filter(Boolean)` call does not narrow element types in TypeScript -- the casts silence the compiler without providing runtime safety. If a scene is inserted with a null prompt, the downstream call receives the literal string `"null"` or throws unexpectedly.

**Fix:** Use a type predicate filter:
    .filter((s): s is Scene & { image_prompt: string } => s.image_prompt != null)

---

### H-2 -- publishers.ts:199-200, 510-512 -- Invisible mutation of Account argument
**File:** `src/lib/platforms/publishers.ts`

`tryRefreshToken` and `refreshTikTokAccountToken` mutate fields directly on the `Account` object passed by reference (`account.access_token = refreshed.accessToken`). The return type of `tryRefreshToken` is `boolean` -- callers cannot see which fields changed.

**Fix:** Return updated token fields from the function (e.g. `Promise<RefreshedTokens | null>`) and let the caller decide how to persist them. Do not mutate function arguments.

---

### H-3 -- api/auth/youtube/callback/route.ts:56-58 -- Non-null assertions not colocated with guard
**File:** `src/app/api/auth/youtube/callback/route.ts`

`process.env.YOUTUBE_OAUTH_CLIENT_ID!` and `YOUTUBE_OAUTH_CLIENT_SECRET!` are asserted non-null inside `exchangeCodeForToken` (lines 56-58). The validation guard lives in the outer `GET` handler at line 86. Any future caller of `exchangeCodeForToken` that skips the guard will throw at runtime with a cryptic error message.

**Fix:** Validate env vars once at module load (throw at startup if absent), or pass them as explicit parameters so the helper does not depend on side-channel globals.

---

### H-4 -- api/videos/route.ts:66-94 -- Hand-rolled body validation; Zod installed but unused
**File:** `src/app/api/videos/route.ts`

All request body validation is manual `typeof` checks with no length or range bounds. Zod 4.4.3 is in `package.json` and installed. A comment in `script.ts` incorrectly claims Zod is absent. Missing: min/max length on `theme`, integer range on `scene_count` and `duration_seconds`, URL validation on `background_music_url`.

**Fix:** Define a Zod schema and call `.safeParse()` at the entry point. This also eliminates the inaccurate comment.

---

### H-5 -- VideoDetail.tsx:208 -- Private storage path used directly as video src (silent 403)
**File:** `src/components/videos/VideoDetail.tsx`

`final_video_url` holds the raw Supabase Storage object path (e.g. `uuid/uuid/final.mp4`). The `videos` bucket is private per `storage.ts`. Using this path as `<video src={video.final_video_url}>` returns a 403 for every user with a completed video -- the player is silently broken with no error feedback.

**Fix:** Generate a signed URL server-side using `supabase.storage.from("videos").createSignedUrl(path, ttlSeconds)` and pass it as the `src`.

---

### H-6 -- SceneRow.tsx:15-33 -- Audio element not cleaned up on unmount; play() rejection unhandled
**File:** `src/components/videos/SceneRow.tsx`

Two separate bugs:

1. `new Audio(scene.audio_url)` is stored in component state with no `useEffect` cleanup. When the component unmounts mid-playback, audio continues and the `ended` listener calls `setPlaying(false)` on the unmounted component, producing a React strict-mode warning.

2. `void el.play().then(() => setPlaying(true))` discards the promise rejection. Chrome mobile rejects `play()` with `NotAllowedError` due to autoplay policy. The button state becomes permanently stuck with no user feedback.

**Fix:** Create the `Audio` element inside a `useEffect` and return a cleanup that calls `el.pause()` and clears `el.src`. Wrap `el.play()` in try/catch and surface errors to the user.

---

### H-7 -- VideoDetail.tsx:69 -- Polling failure silently stalls progress UI
**File:** `src/components/videos/VideoDetail.tsx`

When the status fetch call fails (network error or 5xx), only `console.error` is called. The progress bar freezes at its last value with no user-facing indication. The polling interval continues firing silently until unmount.

**Fix:** Track a consecutive-failure counter. After N failures, stop polling and display an inline error with a manual retry action.

---

## MEDIUM Issues

### M-1 -- pipeline.ts:451 -- Module-level mutable bundle cache has concurrency race
**File:** `src/lib/video/pipeline.ts`

`let cachedBundlePath: string | null = null` at module level. When two concurrent `setImmediate` jobs both observe `null`, both call `bundle()` simultaneously, wasting CPU and producing redundant artifacts in a serverless environment with concurrent warm instances.

**Fix:** Replace with a promise-based singleton: `let bundlePromise: Promise<string> | null = null`. Assign before awaiting so all concurrent callers share the same promise.

---

### M-2 -- Accessibility gaps across video UI
**Files:** `src/components/videos/VideoStatusBadge.tsx:28`, `VideoDetail.tsx:149`, `SceneRow.tsx:67-98`, `new/page.tsx:124-157`

- Status badge has no `aria-live` region; state transitions are invisible to screen readers.
- Progress bar has no `role="progressbar"`, `aria-valuenow`, `aria-valuemin`, `aria-valuemax`.
- Audio/regenerate buttons in SceneRow have no `aria-label` identifying which scene they target.
- Range sliders in the new-video form announce raw numbers without `aria-valuetext` (e.g. "6 scenes", "45 seconds").

---

### M-3 -- VideoCard.tsx:37, SceneRow.tsx:48 -- Plain img instead of next/image
**Files:** `src/components/videos/VideoCard.tsx`, `src/components/videos/SceneRow.tsx`

ESLint flags both via `next/no-img-element`. Using plain `<img>` forfeits automatic format negotiation (AVIF/WebP), lazy loading integration, and layout-shift prevention from missing dimensions.

---

### M-4 -- Magic color #061b31 repeated across three files
**Files:** `VideoDetail.tsx:140`, `new/page.tsx:75`, `videos/page.tsx:32`

`style={{ color: "#061b31" }}` appears in three files with no shared token or CSS variable. A brand-color change requires three edits.

---

### M-5 -- Inconsistent secure cookie flag between TikTok and YouTube OAuth routes
**Files:** `src/app/api/auth/tiktok/route.ts:55`, `src/app/api/auth/youtube/route.ts:60`

TikTok uses `secure: process.env.NODE_ENV === "production"` (works in local HTTP dev).  
YouTube uses `secure: true` hardcoded (OAuth state cookie rejected by browser on `http://localhost`, silently breaking local development).

---

## LOW Issues

### L-1 -- script.ts:205 -- Redundant intermediate cast
`const raw = parsed as unknown as RawScript` -- `parsed` is already `unknown` from `JSON.parse`; the `as unknown` step is a no-op. Cast directly with a validation function, or use Zod to eliminate the cast entirely.

### L-2 -- elevenlabs.ts:287 -- Dead export
`generateFullNarration` is exported but has zero importers in `src/`. Remove it or use it.

### L-3 -- pipeline.ts:500-501 -- Unnamed Lambda stub parameters
`_inputProps` and `_outputLocation` suppress ESLint in a placeholder stub. Add a `// TODO:` comment with a ticket reference so the stub is not silently forgotten.

### L-4 -- script.ts -- Comment incorrectly claims Zod is absent
Zod 4.4.3 is installed. The comment is misleading and may be used to justify continued manual validation. Remove or correct it.

---

## Verified Correct Patterns

| Pattern | Verdict |
|---|---|
| `import "server-only"` in all lib/video/ modules | Correct |
| `params: Promise<{ id: string }>` + `await params` in all dynamic route handlers | Correct (matches Next.js 16 docs) |
| `await cookies()` at all call sites | Correct |
| `VideoDetail.tsx` polling cleanup (cancelled flag + clearInterval) | Correct |
| OAuth CSRF via `crypto.timingSafeEqual` + state cookie deleted after use | Correct |
| SSRF guard `assertFetchableHttpsUrl` blocking RFC1918/loopback/ULA/link-local | Correct |
| IDOR defense in regenerate-scene (scene-to-video join + ownership check) | Correct |
| `createAdminClient` used for server-side DB writes in storage.ts and jobs.ts | Correct |

---

## Issue Tally

| Severity | Count |
|---|---|
| CRITICAL | 2 |
| HIGH | 7 |
| MEDIUM | 5 |
| LOW | 4 |

**Verdict: BLOCK.** C-1 (session-context leak into background job) and C-2 (SDK type erasure) are architectural correctness bugs in the primary feature path. H-5 (silent 403 on video playback) means every completed video is broken for every user. H-6 (audio leak + unhandled play() rejection) produces React strict-mode warnings and broken mobile UX. All CRITICAL and HIGH issues must be resolved before this feature ships.
