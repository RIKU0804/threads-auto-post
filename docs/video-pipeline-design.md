# AI Short-Video Generation Pipeline — Design Doc

Status: **Design (not implemented)**
Owner: Backend
Last reviewed: 2026-05-20
Target stack: Next.js 16.2.4 (App Router) + React 19.2 + Supabase + Vercel + Remotion

> Codebase note: this repo runs Next.js **16.2.4**. Anything below that smells like Next 13/14 behavior was confirmed against `node_modules/next/dist/docs/`. The flags I'm still unsure about are called out inline as `[VERIFY]`.

---

## 0. Scope and assumptions

In scope for this doc:
- API surface (`/api/videos/...`)
- Async pipeline orchestration & state machine
- Where Remotion `renderMedia` runs (this is the load-bearing decision)
- Supabase Storage layout & RLS
- Hooking TikTok into the existing `publishers.ts` strategy pattern
- UI page inventory (URLs only — no UI design)

Already exists / out of scope:
- `videos` / `scenes` tables (`supabase/migrations/20260520_videos_and_scenes.sql`)
- `src/lib/video/script.ts` (script generation)
- `src/lib/video/elevenlabs.ts` (TTS)
- `src/lib/ai/image.ts` (gpt-image-1)
- `remotion/` project with `ShortVideoMain` composition
- `src/lib/platforms/tiktok.ts` (Direct Post adapter, currently unwired)

---

## 1. API Routes

### Conventions (match existing code in `src/app/api/posts/route.ts`)

- Auth: `const supabase = await createServerSupabaseClient(); const { data: { user } } = await supabase.auth.getUser(); if (!user) return 401`. There is **no `src/lib/auth/` directory** — the spec referenced one but the actual pattern lives in `src/lib/supabase.ts`. Use that.
- All ownership re-checked on the server even when RLS would already block it (defense-in-depth / IDOR — same as `posts/[id]/publish/route.ts`).
- Rate limiting via `checkRateLimit(user.id, bucket, ...)`. Add a new bucket preset `video` with **fail-closed** (cost protection — each pipeline burns ~$0.30+ of image+TTS+render).
- Error responses follow existing shape: `{ error: string, code?: string }` with appropriate HTTP status. Do **not** introduce the `{ success, data, error }` envelope from typescript/patterns.md — it doesn't match this repo.
- JSON limits: clamp strings server-side (see `clampStr` in posts route).
- All async work after the response uses `import { after } from 'next/server'` only when total work fits in `maxDuration`. For real pipeline work see §2.

### 1.1 `POST /api/videos` — kick off generation

**Auth:** required. **Rate limit:** bucket `video`, limit `5 / hour`, fail-closed.

Request:
```ts
{
  theme: string             // 1..200 chars, required
  accountId?: string        // optional: TikTok account to default-publish to later
  sceneCount?: number       // optional override, default 5, range 3..10
  voiceId?: string          // optional ElevenLabs voice override
}
```

Response 200:
```ts
{
  id: string                // videos.id
  status: 'generating_script'
}
```

Errors:
- 400 invalid input
- 401 unauthenticated
- 404 accountId not owned
- 429 `code: 'RATE_LIMITED'`
- 500 internal

Behavior:
1. Validate input, verify `accountId` ownership if provided.
2. Insert `videos` row with `status='generating_script'`, `title=<theme truncated>`, `user_id=user.id`. Atomic — this row is the lock.
3. **Enqueue** pipeline job (see §2). Do NOT inline the pipeline.
4. Return immediately with the new id.

### 1.2 `GET /api/videos` — list user's videos

**Auth:** required.

Query: `?status=<status>&limit=<n>` (limit default 50, max 200).

Response: `Video[]` ordered by `created_at desc`. Same shape as `posts` GET — direct row JSON, not envelope-wrapped.

### 1.3 `GET /api/videos/[id]` — single video with scenes

**Auth:** required. Verify `videos.user_id === user.id` after select.

Response:
```ts
{
  ...video,
  scenes: Scene[]           // ordered by order_index asc
  signed_urls?: {           // present only when status === 'ready'
    final_mp4: string       // 1h signed URL
  }
}
```

Errors: 404 if not owned or missing.

### 1.4 `POST /api/videos/[id]/regenerate-scene` — re-run a single scene

**Auth:** required. **Rate limit:** bucket `video_scene_regen`, limit `30/hour`, fail-closed.

Request:
```ts
{
  sceneId: string
  target: 'image' | 'audio' | 'both'
  imagePrompt?: string      // optional override
  narrationText?: string    // optional override (audio only)
}
```

Response 202:
```ts
{ sceneId: string, status: 'regenerating' }
```

Behavior:
- Only allowed when `videos.status IN ('ready', 'failed')`. Reject 409 otherwise.
- Compare-and-set on `videos.status` → `'rendering'` (because a scene change forces a re-render).
- Enqueue a `regenerate-scene` job that does the partial work then a full Remotion re-render.

Errors: 400 / 401 / 404 / 409 (`code: 'VIDEO_BUSY'`) / 429.

### 1.5 `POST /api/videos/[id]/publish/tiktok` — publish to TikTok

**Auth:** required. **Rate limit:** existing `publish`-class limit (add `publish_video` bucket, 20/hour, fail-open — TikTok itself rate-limits).

Request:
```ts
{
  accountId: string         // TikTok account
  caption: string           // 1..2200 chars
  privacyLevel?: 'PUBLIC_TO_EVERYONE' | 'SELF_ONLY' | ...
  disableComment?: boolean
  disableDuet?: boolean
  disableStitch?: boolean
}
```

Response 200:
```ts
{ publishId: string, status: 'PROCESSING_UPLOAD' }
```

Behavior — mirrors `src/app/api/posts/[id]/publish/route.ts`:
1. Load video + verify ownership.
2. Reject unless `video.status === 'ready'`.
3. Compare-and-set a new `publishing` flag on `videos` (add column — see §2.2) — guards against double-click double-post.
4. Generate a 1-hour signed Storage URL for the final mp4.
5. Call `publishPost({ post: <video-shaped object>, account })` — TikTok publisher needs to be added to `publishers.ts` (see §5).
6. On success store `tiktok_publish_id`, transition to `published`.
7. On `TikTokAuthError` use the same refresh-then-retry-once pattern already in `publishPost`.

Polling for TikTok publish completion (`PUBLISH_COMPLETE`) is handled by a separate cron, not this route — keep the route fast.

### 1.6 `GET /api/videos/[id]/status` — polling

**Auth:** required.

Response:
```ts
{
  id: string
  status: VideoStatus
  progress: {               // best-effort, NOT authoritative
    scenes_total: number
    scenes_with_image: number
    scenes_with_audio: number
  }
  error_message: string | null
  updated_at: string
}
```

**Recommendation:** client polls this every 3s while status is non-terminal. Skip SSE/Realtime in v1.
- *Why polling, not Supabase Realtime?* Realtime would be lovely but adds a moving part (channel auth, RLS-on-replication). Polling for ≤5 minutes at 3s = ≤100 requests. The cost is in image gen, not API calls.
- *Runner-up:* Supabase Realtime subscribe to `videos:id=eq.<id>` once the team has bandwidth.

---

## 2. Async pipeline orchestration

### 2.1 Where the pipeline runs — **Recommendation: Trigger.dev v3**

The full pipeline can take **2–5 minutes**. Vercel function `maxDuration` caps:
- Hobby: 10s
- Pro: 60s default, configurable up to 300s on Fluid Compute (`export const maxDuration = 300`) `[VERIFY against current Vercel plan]`

Options I considered:

| Option | Verdict |
|---|---|
| (a) Inline in route | **No.** Cannot guarantee <60s. Even 300s is tight once Remotion is in the loop. |
| (b) Vercel `after()` | **No.** Still bound by route's `maxDuration`. Same 60–300s ceiling. Good for fire-and-forget telemetry, not 5-minute jobs. |
| (c) Supabase Edge Functions | **No.** 150s wall-clock limit, no Remotion-capable runtime (no Chromium), Deno-only. |
| (d) Trigger.dev v3 | **Yes.** Native Node, long-running (up to hours), retries + idempotency keys + state visibility, no infra to run. Has built-in concurrency limits per-user — useful for cost control. |
| (e) Inngest | Close runner-up. Equally valid. Trigger.dev wins for this project because its task definitions feel closer to procedural code, which matches the linear pipeline shape better. |
| (f) Self-hosted worker | **No.** Adds ops burden. Only worth it if Remotion render becomes the bottleneck and we move to Lambda anyway (see §3). |

**Decision: Trigger.dev v3** for the orchestration layer. Each pipeline step is a sub-task with its own retry policy. The route handler enqueues; the worker does the work.

Risks of this choice (called out honestly):
- Vendor adds a dependency for a critical path. Mitigated because the actual work units (script gen, image gen, TTS, render) are pure functions of inputs and can be re-hosted on Inngest or a raw queue with low rewrite cost.
- Free tier is enough for early users but will need a paid plan as soon as we onboard ~10 active users. Budget line item.

### 2.2 State machine

Existing migration already constrains `videos.status` to:
`draft | generating_script | generating_images | generating_voice | rendering | ready | failed`

Transitions and writer:

| From | To | Writer | Trigger |
|---|---|---|---|
| (insert) | `generating_script` | `POST /api/videos` | request received |
| `generating_script` | `generating_images` | worker (script step) | script saved, scene rows inserted |
| `generating_images` | `generating_voice` | worker (image step) | all `scenes.image_url` populated |
| `generating_voice` | `rendering` | worker (TTS step) | per-scene audio uploaded + `videos.voice_url` set (or per-scene `audio_url`) |
| `rendering` | `ready` | worker (render step) | mp4 uploaded, `final_video_url` set |
| any non-terminal | `failed` | worker error handler | exception in any step |
| `ready` / `failed` | `rendering` | regenerate-scene route | partial regen requested |

**Schema additions needed** (new migration — flag for db agent):
```sql
ALTER TABLE videos
  ADD COLUMN final_video_url TEXT,
  ADD COLUMN tiktok_publish_id TEXT,
  ADD COLUMN published_at TIMESTAMPTZ,
  ADD COLUMN publish_status TEXT
    CHECK (publish_status IS NULL OR publish_status IN
      ('queued','publishing','published','publish_failed'));

ALTER TABLE scenes
  ADD COLUMN audio_url TEXT;       -- per-scene MP3, matches Remotion schema
```

Rationale: the Remotion schema expects `audio_url` **per scene**, not one big voice file. Current migration's `videos.voice_url` is the wrong granularity — keep it (might be useful for concatenated narration) but the source-of-truth for rendering is `scenes.audio_url`.

### 2.3 Error handling and partial state

Policy: **fail the whole video to `failed` on any unrecoverable step error, but preserve the rows so the user can selectively regenerate.**

- Image gen on scene 3 of 6 fails: retry that single image 2x (Trigger.dev retry). If still failing, set `videos.status='failed'`, write the failing scene's id to `videos.error_message` (truncated to 500 chars like posts route).
- TTS on scene 2 fails: same pattern.
- Remotion render fails: `failed`. User can hit `regenerate-scene` to fix the offending scene and re-render.

**Idempotency:**
- Trigger.dev `idempotencyKey` = `videos.id` for the main pipeline task → re-triggering with the same video id is safely deduped within the configured window.
- Each step writes its result before transitioning state. Workers check current state on entry and short-circuit if already past their step (handles retries cleanly).
- The `POST /api/videos` route does NOT re-enqueue if a row in `generating_*` already exists for this user within the last 10 minutes (returns 409). Prevents accidental duplicate spend.

### 2.4 Cost guardrails

Per-video ballpark: ~$0.05 GPT script + ~$0.20 (5 × gpt-image-1) + ~$0.05 (5 × ElevenLabs) + ~$0.01 render = **~$0.30/video**. Add 50% safety = **~$0.45**.

Guardrails:
- Rate limit `video` bucket: 5/hour, 20/day per user (add a second cron-checked daily counter, or use rate-limit with 86400 window).
- Hard scene cap: 10 (DB has effectively no cap; enforce in route).
- Trigger.dev per-user concurrency = 1 (queue subsequent jobs rather than parallelizing — keeps a runaway client from spending $30 in 5 minutes).

---

## 3. Remotion rendering execution

This is the second load-bearing decision. **Recommendation: `@remotion/lambda` on AWS Lambda**, invoked from the Trigger.dev render task.

Why:
- Remotion's `renderMedia` ships a headless Chromium per process. Cold-start memory: ~1.5GB. Single Vercel function caps at 3GB but the 300s ceiling is tight and you pay full-instance pricing for the whole pipeline duration — wasteful when only the render step needs the heavy runtime.
- `@remotion/lambda` is purpose-built: it shards a render across multiple Lambda invocations in parallel, then concatenates. A 60-second video that takes 90s on a single beefy node finishes in ~20s on Lambda.
- Cost: ~$0.005–$0.02 per video render at our length. Trivial vs the OpenAI bill.
- No Chromium to ship to Vercel. No bundle bloat.

Runners-up:
- **Cloud Run + a Docker image with Remotion**: viable, especially if we add more video features later (longer videos, custom fonts, etc.). Slightly more ops. Pick this if we want to avoid AWS entirely.
- **Trigger.dev's own machine with Remotion installed**: works for prototyping but you pay for the heavy container even when not rendering. Skip for production.
- **Inline on Vercel function (Node runtime, maxDuration 300)**: only viable if videos are short (<15s) and we accept slow cold starts. Don't ship this.

Setup notes (call out for implementer):
- Lambda function needs the deployed Remotion bundle (`npx remotion lambda sites create` from local dev once, then re-deploy on Remotion bundle changes).
- IAM: pipeline worker needs `lambda:InvokeFunction` + read on the S3 bucket Lambda outputs to.
- Output goes to S3, then our worker downloads the mp4 and uploads to Supabase Storage (so all media lives in one place). `[VERIFY]` — alternative is letting Lambda write directly to Supabase via signed upload URL; cleaner but couples Lambda to Supabase auth.

**Risk to flag (top-2 list, see summary):** every team I've watched hit "render in production" trips over Remotion font loading. Plan for explicit `@remotion/google-fonts` or local font files in the bundle. Don't trust system fonts on Lambda.

---

## 4. Storage

### 4.1 Bucket layout

Single new Supabase Storage bucket: **`videos`** (private).

Paths:
```
videos/{user_id}/{video_id}/scene-{order_index}.png
videos/{user_id}/{video_id}/scene-{order_index}.mp3
videos/{user_id}/{video_id}/voice.mp3              (optional: full narration if used)
videos/{user_id}/{video_id}/final.mp4
```

Why include `user_id` in the path even with RLS: makes the RLS policy a simple prefix match, makes manual ops/audit trivially scoped, and means a signed URL leak never escapes user scope.

Schema (new migration, flag for db agent):
```sql
INSERT INTO storage.buckets (id, name, public) VALUES ('videos', 'videos', false)
  ON CONFLICT DO NOTHING;

-- Read: own folder only
CREATE POLICY "videos bucket: own folder read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'videos' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Write: workers only (service role bypasses RLS). User clients should never upload directly.
-- No INSERT/UPDATE/DELETE policy → only service role can write. This is intentional.
```

### 4.2 Signed URLs

- **TikTok publish**: server generates a 1h signed URL from the admin client (`createAdminClient`) at publish time. TikTok pulls within minutes, so 1h is plenty.
- **Browser preview** (`/dashboard/videos/[id]`): server-side, on `GET /api/videos/[id]`, generate 15-min signed URLs for the final mp4 and each scene image/audio. Return in the response. Refresh on poll.
- **Never** put service-role keys in the browser. The `videos` bucket stays private.

### 4.3 Size budget

- Image: ~1–2MB × 10 = ~20MB max
- Audio: ~50–200KB × 10 = ~2MB max
- mp4: ~5–20MB
- ⇒ ~40MB per video upper bound. Supabase free tier is 1GB storage; expect to need Pro plan after ~25 videos. Budget line item.

---

## 5. TikTok publishing integration

`src/lib/platforms/tiktok.ts` exists but isn't wired. Minimum work to ship:

### 5.1 Type changes (`src/types/database.ts`)

```ts
export type Platform = 'threads' | 'instagram' | 'x' | 'tiktok'
```

Add to `Account` interface:
```ts
tiktok_open_id: string | null
tiktok_refresh_token: string | null   // encrypted — see crypto.ts
tiktok_client_key: string | null      // if per-account; else env-only
```

`[VERIFY]` — check existing `src/lib/crypto.ts` for how Threads stores refresh tokens; mirror it for TikTok.

### 5.2 `publishers.ts` additions

Add a `tiktokPublisher: Publisher`. Key differences from existing publishers:
- It takes a **video URL** (signed Supabase URL) not an image — extend `PublishContext` to allow `video_url?: string` OR introduce a separate `VideoPublishContext`. **Recommend the separate context**: the `Post` shape doesn't fit videos and shoehorning it in pollutes the existing publishers. Add a parallel `publishVideo({ video, account })` function.
- `validate`: require `account.access_token`, `account.tiktok_open_id`, `video.final_video_url`.
- `publish`: call `getTikTokCreatorInfo` first (catches scope issues early with a clear error), then `createTikTokVideoPost`. Return `{ platformPostId: publishId }`.
- Auth error handling: wrap `TikTokAuthError` and call `refreshTikTokToken` in the existing `tryRefreshToken` (extend it). Mirror Threads exactly.

### 5.3 Domain whitelisting gotcha

TikTok PULL_FROM_URL requires the domain to be **pre-registered as a URL prefix** in the TikTok developer portal. Supabase Storage URLs look like `https://<project-ref>.supabase.co/storage/v1/object/sign/videos/...` — register `https://<project-ref>.supabase.co/storage/v1/object/sign/videos/` as the prefix. Document this in the TikTok onboarding runbook (out of scope here, flag for implementer).

### 5.4 Polling publish completion

After `createTikTokVideoPost`, status starts as `PROCESSING_UPLOAD`. Don't poll in the request handler — TikTok can take 30s+.

Add a cron route `POST /api/cron/tiktok-publish-status` protected by the existing cron-auth pattern (referenced as `withCronAuth` in the spec but not yet in repo — `[VERIFY]`, may live elsewhere). It selects `videos WHERE publish_status='publishing'`, calls `getTikTokPublishStatus`, transitions to `published` / `publish_failed`. Run every 1 minute.

---

## 6. UI flow (URLs only)

| Path | Purpose |
|---|---|
| `/dashboard/videos` | List user's videos. Status badges. Filters. |
| `/dashboard/videos/new` | Theme input + optional scene count + generate button. POSTs to `/api/videos`, then redirects to `/dashboard/videos/[id]`. |
| `/dashboard/videos/[id]` | Status page. Live progress (poll `/api/videos/[id]/status` every 3s while non-terminal). Per-scene cards with image preview + caption + audio preview + "regenerate" button. Once `ready`: video player + "Publish to TikTok" button + account picker. |

No design decisions on the UI itself in this doc — that's a separate frontend task.

---

## 7. Open questions to settle before implementation

1. **Trigger.dev account / billing** — who owns it? If we don't want a 4th vendor, Inngest has near-identical capability and a generous free tier. Either is fine; pick one and commit.
2. **AWS account for `@remotion/lambda`** — same question. If we don't want AWS, Cloud Run is the next pick.
3. **`maxDuration` of Vercel Pro plan in this project** — verify before depending on >60s anywhere.
4. **Existing cron auth pattern** — find it (the spec says `src/lib/auth/withCronAuth.ts` but I didn't see `src/lib/auth/` in the tree). Confirm before designing the TikTok status cron.
5. **TikTok creator-info scope** — the developer portal needs `video.publish` scope. This may not be on the connected account yet. Flag during account-connect testing.
6. **Per-account vs per-video TTS voice override** — current `videos` table has no `voice_id`. Decide whether voice selection is a video-level or account-level setting; impacts schema. Recommend account-level with per-video override.

---

## 8. First-PR scope (recommended starting point)

To unblock everything else **without** introducing a vendor commitment yet:

1. **Schema patch**: add `final_video_url`, `tiktok_publish_id`, `published_at`, `publish_status` to `videos`. Add `audio_url` to `scenes`. Add `videos` storage bucket + RLS policy.
2. **`POST /api/videos`** (enqueue stub — log "would enqueue" instead of actually calling Trigger.dev)
3. **`GET /api/videos`** + **`GET /api/videos/[id]`** + **`GET /api/videos/[id]/status`**
4. **Rate limit bucket**: `video`, 5/hour, fail-closed.
5. UI shells: `/dashboard/videos`, `/dashboard/videos/new`, `/dashboard/videos/[id]`.

This gives us a working CRUD surface that can be demoed and unit-tested. The async pipeline + Remotion render + TikTok publish land in PR #2, #3, #4 respectively, each behind the work-already-shipped in PR #1.
