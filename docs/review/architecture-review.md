# Architecture Review — AI Short-Video Generation Pipeline

**Date:** 2026-05-20
**Reviewer:** code-reviewer agent
**Scope:** src/lib/video/, src/app/api/videos/, src/lib/platforms/publishers.ts (VideoPublisher section), remotion/, supabase/migrations/20260520_videos_and_scenes.sql
**Pipeline under review:** theme → GPT script+scenes → gpt-image-1 illustrations → ElevenLabs TTS → Remotion MP4 render → publish to TikTok/YouTube Shorts

---

## CRITICAL Issues
[CRITICAL] Raw storage path stored as final_video_url — publisher fetch will always fail

File: src/lib/video/pipeline.ts:550-551, src/app/api/videos/_lib/publish-helper.ts:87

uploaded.storagePath is a raw bucket path such as userId/videoId/final.mp4. This path is stored directly to videos.final_video_url. When publishVideoToAccount calls publishVideo({ video: v, account }), v.final_video_url is that raw path, not a signed URL. fetchVideoBytesSafe then calls assertFetchableHttpsUrl on it — which rejects it because it does not start with https:// — and the YouTube publisher throws before ever uploading. The TikTok PULL_FROM_URL path also sends the raw path to TikTok as the download URL, which also fails.

uploadFinalVideo in storage.ts already generates a 7-day signed URL and returns it. The fix is to store that signed URL (or re-issue a fresh signed URL at publish time) rather than the raw path.

VideoDetail.tsx:209 also uses video.final_video_url as the browser video src, so the player is silently broken on a private bucket if the raw path is stored.

Fix: pipeline.ts:551 — store uploaded.signedUrl instead of uploaded.storagePath.
Alternatively, call createSignedUrl in publishVideoToAccount before invoking publishVideo.


[CRITICAL] ElevenLabs key lookup calls createServerSupabaseClient() from a background job — no HTTP session context

File: src/lib/video/elevenlabs.ts:106-129

fetchElevenLabsKey() calls createServerSupabaseClient() and then supabase.auth.getUser(). That function reads the session from the request cookie, which does not exist when the pipeline is executing inside a setImmediate callback or a background worker. The try/catch on lines 122-125 silently swallows the resulting auth failure and falls back to process.env.ELEVENLABS_API_KEY. This means:

1. Per-user API key lookup never works in the pipeline — every user always uses the server-level env key.
2. The failure is invisible — no log line is emitted when the auth path fails.

The per-user key lookup needs to be refactored to accept an explicit userId parameter and use createAdminClient() instead of the session-based client. All other pipeline steps already follow this pattern correctly (fetchOpenAiKey(userId), fetchOpenAiKeyForUser(userId)).

---

## HIGH Issues

[HIGH] enqueueVideoPipeline has no idempotency guard — double-POST creates two full pipeline runs

File: src/lib/video/jobs.ts:93-102

There is no check before enqueueing whether the video already has an active or completed pipeline run. A double POST to /api/videos or a client retry creates two simultaneous runVideoPipeline calls for the same videoId. The status-based idempotency check inside runVideoPipeline is a race condition guard, not a duplicate-call guard: both workers can read status=draft before either writes generating_script.

Fix: add a database-level guard in enqueueVideoPipeline — set status=generating_script atomically (using a conditional update that checks status=draft) before dispatching, and skip dispatch if the update is a no-op.

[HIGH] fire-and-forget enqueue in POST /api/videos provides no user-visible feedback on failure

File: src/app/api/videos/route.ts:113

void enqueueVideoPipeline(data.id, {...}).catch(err => console.error(...))

If enqueueVideoPipeline throws, the video record is created with status=draft and stays there permanently with no error_message. The user sees a video that never progresses. The console.error is server-side only.

Fix: either await the enqueue inside the try block and return an appropriate error response, or if fire-and-forget is required (to avoid blocking the 201 response), update the video to status=failed with a user-readable message in the catch handler.

[HIGH] Scene regeneration is fully fire-and-forget with no status feedback to the client

File: src/app/api/videos/[id]/regenerate-scene/route.ts:53-60

The route returns HTTP 202 immediately and dispatches void regenerateSceneImage(sceneId).catch(...). When the background operation fails, the error goes to console.error and the scene retains its stale image_url. There is no polling endpoint to discover whether regeneration succeeded or failed. The UI cannot show a failure state for an individual scene.

[HIGH] sceneCount option collapses min/max to the same value in script generation

File: src/lib/video/script.ts:299-301

  const sceneCountMin = opts.sceneCount ?? DEFAULT_SCENE_COUNT_MIN
  const sceneCountMax = opts.sceneCount ?? DEFAULT_SCENE_COUNT_MAX

When a caller passes sceneCount: 5, both sceneCountMin and sceneCountMax are set to 5. GPT is instructed to generate exactly 5-5 scenes. The variable name sceneCountMax is misleading when a fixed count is passed. If the intent was to allow a flexible range, the single sceneCount parameter cannot express it. The API surface should expose sceneCountMin and sceneCountMax separately, or the variable names should be updated to remove the false implication of a range.

---

## MEDIUM Issues

[MEDIUM] Idempotency check for generateScript reads video and scenes in two separate non-atomic queries

File: src/lib/video/pipeline.ts:198-202

  const video = await loadVideo(videoId)
  const existingScenes = await loadScenes(videoId)
  if (existingScenes.length > 0 && video.script) { return }

A concurrent second pipeline run can pass this check between the two reads. The existing-scenes delete + re-insert on lines 231-246 would then corrupt scenes for the other worker. A single conditional status update (see HIGH idempotency fix) is the correct guard.

[MEDIUM] videos.voice_url column is dead — migration comment contradicts implementation

File: supabase/migrations/20260520_videos_and_scenes.sql:9

The migration comment documents step 4 as: ElevenLabs de video zentai no onsei → videos.voice_url. The actual implementation stores audio per-scene in scenes.audio_url. The voice_url column on videos is never written. The migration should either remove the column or the comment should reflect the per-scene audio architecture. The dead column risks confusing future developers.

[MEDIUM] Storage upload uses cacheControl 3600 — CDN may serve stale file for up to 1 hour after upsert-based regeneration

File: src/lib/video/storage.ts:102

All uploads pass cacheControl: 3600. Scene image regeneration uses upsert: true to overwrite the existing file at the same path. If the CDN has cached the old file, a new signed URL pointing to the same path may serve the stale version for up to 60 minutes after a user-triggered regeneration.

Fix: either use a unique path per regeneration attempt (append a generation counter or timestamp), or reduce cacheControl to 0 for mutable assets.

[MEDIUM] markVideoFailed writes raw err.message to videos.error_message

File: src/lib/video/pipeline.ts:599-604

err.message from OpenAI SDK errors, Supabase errors, or Remotion render errors may contain internal stack paths, API error codes, or request IDs. The error_message column is surfaced to users in the UI. Translate internal errors to user-friendly messages at the pipeline boundary and log the raw error server-side.

[MEDIUM] Pipeline state machine has no generating_voice status transition

File: src/lib/video/pipeline.ts (generateSceneAudio function)

The migration comment lists: draft → generating_script → generating_images → generating_voice → rendering → ready. However generateSceneAudio does not call updateVideoStatus(videoId, generating_voice) before starting ElevenLabs synthesis. The video jumps from generating_images directly to rendering with no intermediate state. Users and operators cannot distinguish waiting-for-TTS from waiting-for-render by inspecting videos.status.

[MEDIUM] TikTok PULL_FROM_URL flow requires domain pre-registration with TikTok

File: src/lib/platforms/tiktok.ts (called from tiktokVideoPublisher)

TikTok Content Posting API with source_type: PULL_FROM_URL requires the video URL domain to be pre-registered in the TikTok developer portal. Supabase Storage signed URLs use the Supabase project subdomain (*.supabase.co), which is not pre-registerable by the app operator. Attempting to post will receive a domain_not_allowlisted error at runtime, not at validate time. This is a cross-agent integration gap — the TikTok agent assumed a pre-registered domain; the Storage agent chose Supabase Storage.

Fix: either switch to FILE_UPLOAD source type (download the video server-side and POST the bytes), or host videos on a pre-registered domain.

[MEDIUM] YouTube publisher buffers the entire MP4 in memory

File: src/lib/platforms/publishers.ts:339-340 (fetchVideoBytesSafe)

fetchVideoBytesSafe calls res.arrayBuffer(), loading the entire video into the Node.js heap before upload. For a 60-second Remotion MP4, this can be 50-200 MB. On a Vercel Function with a 512 MB memory limit, a single publish request may consume most of available memory. The YouTube Data API v3 supports resumable upload — a streaming approach is appropriate for production.

[MEDIUM] No structured logging — all error reporting is via console.error

Files: throughout src/lib/video/ and src/app/api/videos/

Every error path uses console.error(...) with free-form string concatenation. There is no correlation ID, no videoId consistently threaded through all log calls, and no structured fields. This makes post-incident debugging difficult. A structured logger with a per-pipeline-run videoId field is recommended for production observability.

---

## LOW Issues

[LOW] Trigger.dev backend is a stub that silently falls back to inline — TRIGGER_PUBLIC_API_KEY creates false confidence

File: src/lib/video/jobs.ts:60-76

If a developer sets TRIGGER_PUBLIC_API_KEY expecting Trigger.dev integration to be active, they silently get the inline setImmediate backend. On Vercel, the process.stderr.write warning goes to function logs which may not be monitored. Before production deployment, either integrate the Trigger.dev SDK or make the stub throw rather than fall back silently.

[LOW] VideoPublishContext.video types final_video_url as string | null — no type distinction between raw path and signed URL

File: src/lib/platforms/publishers.ts:261-265

The type string | null for final_video_url gives callers no compile-time indication that they must resolve the path to an HTTPS signed URL before passing it to publishVideo. A branded type or a dedicated resolveVideoUrl() helper called at the publishVideoToAccount boundary would make this contract explicit and prevent the CRITICAL-1 class of bug at the type level.

[LOW] DEFAULT_SCENE_COUNT_MIN / MAX constants are not exported or documented in the jobs.ts public API

File: src/lib/video/script.ts, src/lib/video/jobs.ts

Route handlers and enqueueVideoPipeline pass sceneCount from the request body or leave it undefined, relying on generateVideoScript to apply defaults. The defaults are not visible in the jobs.ts public API surface. Callers have no discoverability for the default behavior without reading deep into script.ts.

[LOW] assertFetchableHttpsUrl does not guard against all IPv6-mapped IPv4 forms

File: src/lib/platforms/publishers.ts:109-124

The SSRF guard pattern /^(::ffff:)?0.0.0.0$/ does not cover all IPv4-mapped loopback variants (e.g., ::ffff:127.0.0.1). The separate /^127./ check covers the dotted-decimal form, but ::ffff:127.0.0.1 in non-bracket notation would not match it. A belt-and-suspenders addition of /^::ffff:127./.test(host), /^::ffff:10./.test(host), and /^::ffff:192.168./.test(host) would close this minor gap.

---

## Publisher Merge Verification

The merge of the two parallel VideoPublisher definitions into src/lib/platforms/publishers.ts is **clean**.

- The original Publisher / publishPost / publishers hierarchy for text-based platforms (Threads, Instagram, X) is fully intact and unmodified.
- The new VideoPublisher / publishVideo / videoPublishers hierarchy is additive and does not shadow or conflict with any existing export.
- VideoPlatform = Extract<Platform, tiktok | youtube> correctly narrows the platform union.
- videoPublishers is exported as Partial<Record<VideoPlatform, VideoPublisher>>, mirroring the publishers pattern.
- isVideoAuthError and tryRefreshVideoToken are private to the file, consistent with the existing isAuthError / tryRefreshToken helpers.
- No circular imports or namespace collisions detected.

---

## Existing Code Disruption Check

The modified pre-existing files introduce no regressions:

- src/lib/platforms/publishers.ts — extended additively. The original exports (Publisher, publishPost, publishers, PublishContext, PublishResult) are unchanged.
- src/types/database.ts — extended with Video, Scene, and related types. No existing type modified.
- src/app/api/generate/text/route.ts — DEMO_ACCOUNT update is a data-only change with no structural impact.

---

## Architecture Decisions: Agreement

The following design choices are well-considered and should be preserved:

1. **Admin client used throughout the pipeline** — Pipeline steps correctly use createAdminClient() rather than the session-based client. This is the right pattern for background jobs.

2. **Per-step idempotency semantics** — Each step checks for existing work before regenerating. This enables safe resume after a partial failure.

3. **SSRF guard in assertFetchableHttpsUrl** — Blocking loopback, RFC 1918, link-local, and IMDS addresses at the publisher layer is correct defense-in-depth. The redirect: manual pairing is also correct.

4. **Fresh signed URLs issued at render time in buildRenderInputProps** — Re-issuing 6-hour signed URLs immediately before Remotion render ensures scenes render successfully even if the pipeline is queued for an extended period.

5. **VideoPlatform = Extract<Platform, ...> type pattern** — Using Extract to narrow a discriminated union is cleaner than a separate type literal and prevents divergence.

6. **Separate VideoPublisher interface from Publisher** — The video and text publishing contexts are genuinely different (Video vs Post). Keeping them as distinct interfaces is the right call.

7. **YouTube access token refreshed on every publish call** — YouTube access tokens expire in 1 hour. Proactive refresh on every call eliminates token-expired failures at publish time.

---

## Cross-Agent Integration Gaps

1. **Storage agent / TikTok agent mismatch** — TikTok agent chose PULL_FROM_URL source type, implicitly requiring a pre-registered domain. Storage agent chose Supabase Storage. The Supabase domain is not pre-registerable by app operators without TikTok developer portal access. This is the most operationally significant cross-agent gap.

2. **Storage agent / Pipeline agent path contract** — Storage agent returns both storagePath and a signed URL from uploadFinalVideo. Pipeline agent stored the raw path, not the signed URL. Neither agent documented the expected type of videos.final_video_url. The contract between these two agents was ambiguous and the pipeline agent chose the non-fetchable field.

3. **ElevenLabs agent / Pipeline execution context mismatch** — ElevenLabs agent assumed HTTP request context (session cookie available). Pipeline agent runs in a background job (no session). The agents did not share a common execution context contract, producing the silent fallback bug.

4. **Migration comment / Audio agent mismatch** — The SQL migration describes videos.voice_url for a single global audio track. The audio agent chose per-scene audio in scenes.audio_url. The migration was not updated to reflect this decision, leaving a dead column and stale comment.

---

## Review Summary

| Severity | Count | Status |
|----------|-------|--------|
| CRITICAL | 2     | block  |
| HIGH     | 4     | warn   |
| MEDIUM   | 7     | info   |
| LOW      | 4     | note   |

**Verdict: BLOCK — the two CRITICAL issues must be resolved before the next implementation step.**

The raw-path/signed-URL bug (CRITICAL 1) means no video can be published to either platform — every publish attempt will fail before any bytes are sent. The ElevenLabs key lookup bug (CRITICAL 2) means per-user API keys silently do not work in any pipeline run; all users share the server-level env key. Both are regressions that would be immediately visible in any end-to-end test.

The four HIGH issues (no enqueue idempotency, silent enqueue failure, silent regeneration failure, scene count collapse) should be addressed in the same fix pass. The TikTok domain pre-registration gap (MEDIUM) is a hard operational blocker for TikTok publishing regardless of the CRITICAL fixes — it requires either an architectural change (switch to FILE_UPLOAD) or an external prerequisite (pre-register Supabase domain with TikTok developer portal).
