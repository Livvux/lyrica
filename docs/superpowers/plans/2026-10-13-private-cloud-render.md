# Private Cloud Render Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add privately authorized Lambda/R2 exports to the locally hosted Lyrica UI while preserving native and local rendering.

**Architecture:** A private owner/project/media store fronts both export backends. SQLite persists idempotent cloud jobs and an exclusive cloud reservation; adapters stage owned media in S3, invoke pinned Remotion and send output directly to private R2. The UI observes durable job state and requests an authorized download.

**Tech Stack:** Next.js16/React19, TypeScript, Node SQLite, Remotion4.0.535, pinned AWS S3 SDK, Node test runner.

**Spec:** `docs/private-cloud-render-spec.md`

## Global Constraints

- Preserve all original/native/T3 work and protected production configuration; isolated branch starts at9ace701.
- No AWS permission/resource expansion; current Frankfurt function2048MiB/120s/concurrency1 and exactly matching packages.
- One remaining synthetic cloud attempt, existing totalUSD2, no real owner material in external tests.
- New R2 buckets/credentials/permissions and persistent code lifecycle need exact approval and secure owner credential entry.
- Object access requires owner/project checks, never a client-supplied storage key; private missing configuration fails closed.

## Review Focus

- Credential expiry or missing configuration must produce a safe actionable error before spending a new render attempt.
- A crash between Lambda invocation and saved render ID must not cause duplicate rendering or release the global reservation.
- A refresh, logout or another project must not expose a previous project's media or download links.
- Successful output with failed S3 cleanup must remain downloadable and cleanup retry must stay within that job's prefix.
- Native loopback authentication, upload/preview range support and local fallback must survive the new private gate.

### Task1: Private owner/project/media store

**Files:** `src/lib/private-render/{settings,store,auth}.ts`; `src/app/api/session/route.ts`; `src/components/private-access.tsx`; `tests/private-access.test.ts`; `scripts/setup-private-render.mjs`.

**Interfaces:** `PrivateStore(directory)` stores projects, sessions and registered media; `requireActor(request):Actor` returns owner/project after verifying a web or existing desktop session; `getSettings()` reads protected host config without logging values.

- [ ] Write/run failing tests for cross-owner media404, session expiry, mutation Origin rejection, default project persistence, unregistered legacy files and secure config modes.
- [ ] Implement SQLite transactions, password/session hashing, desktop identity reuse and personally run secure setup wizard.
- [ ] Implement login/session and project choice UI; verify full suite and commit.

### Task2: Registered private uploads and local compatibility

**Files:** `src/lib/private-render/media.ts`; upload-audio/bg/logo, audio/[filename], transcribe, identify-mix, render/[filename] routes; existing local render route; `tests/private-media.test.ts`.

**Interfaces:** `registerMedia(actor,file):MediaRecord`, `resolveOwnedMedia(actor,filename):Promise<path>`, `authorizeMedia(actor,filename)`; local exports register output ownership before returning their filename.

- [ ] Write/run failing ownership, traversal, actual-size/type, range, cache recovery and R2-archive fixture tests.
- [ ] Archive/proxy through injected R2 adapter, cache privately, guard every filename-consuming route and preserve local renderer behaviour.
- [ ] Run full tests/typecheck and commit.

### Task3: Durable bounded cloud orchestration

**Files:** `src/lib/private-render/{schema,cloud-jobs,cloud-adapter,registry}.ts`; `src/app/api/cloud-render/{route.ts,[id]/route.ts,[id]/cancel/route.ts,[id]/download/route.ts}`; `tests/cloud-jobs.test.ts`.

**Interfaces:** `CloudJobs.start(actor,key,config)`, `status(actor,id)`, `cancel(actor,id)`, `download(actor,id)`; injected `CloudAdapter` stages, starts, polls, cancels, signs and cleans own keys only.

- [ ] Write/run failing tests for identical double starts, changed-key conflict, atomic global reservation, remaining-attempt ceiling, restarts/ambiguous starts, cancellation acknowledgement, R2 output and cleanup retry.
- [ ] Implement validated registry/limits, durable states and production AWS/R2 adapters; never persist signed input props or credentials.
- [ ] Run full tests/typecheck and commit.

### Task4: Export UI, acceptance and integration delivery

**Files:** export-button, private-access and page integration; `tests/cloud-export-flow.test.ts`; `docs/private-cloud-render-operations.md`.

**Interfaces:** Cloud UI uses only authorized job endpoints and an idempotency key; Local retains the existing SSE renderer. Restored pending job references are scoped to actor/project.

- [ ] Write/run failing UI-state tests for duplicate clicks, reconnect, network failure, cancel pending/confirmed and failed download.
- [ ] Implement Cloud/Local choice with readiness and limits; run fixture-backed local server/browser acceptance without cloud spending.
- [ ] Run lint/typecheck/full tests/build and one fresh independent whole-branch review; fix material findings with regression tests.
- [ ] Create PR with concrete validation and limitations; document protected configuration, switch and rollback. Apply only verified approved local switch, otherwise identify exact pending secure provisioning.
