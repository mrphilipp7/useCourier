# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`use-courier` is a headless React hook (`useCourier`) for file uploads with real upload-progress tracking, retries, cancellation, and chunked uploads for large files. The published package is a single small module at `package/use-courier/`; everything else in the repo (`documentation/`, `tests/`) supports it but isn't shipped.

## Commands

Package manager is **bun** — use `bun`, not `npm`/`yarn`, for installs and scripts (the lockfile is `bun.lock`).

```bash
bun install

bun run typecheck          # typechecks package/use-courier + tests together (tsconfig.json)
bun run build               # compiles package/use-courier -> dist/ only (tsconfig.build.json)
bun run test                 # full test suite (bun test)
bun test tests/use-courier.test.ts        # a single test file
bun test -t "resumes at the failed chunk"  # tests matching a name substring

bun run lint / lint:fix
bun run format / format:check

bun run docs:dev            # VitePress dev server for documentation/
bun run docs:build          # build static site -> documentation/.vitepress/dist/
bun run docs:deploy         # build output -> gh-pages branch (publishes to https://mrphilipp7.github.io/useCourier/)
```

Before any commit, run the same sequence CI and the pre-push hook enforce: `lint` → `format:check` → `typecheck` → `test` → `build`.

**Docs do not deploy automatically.** After merging any change under `documentation/`, `bun run docs:build && bun run docs:deploy` must be run manually to publish it.

**`npm publish` is manual and interactive** — it requires OTP/2FA approval in a browser and cannot be run unattended from this environment. Bumping the version in `package.json` and actually publishing are two separate steps; ask before doing either.

## Architecture

### Two tsconfigs, split on purpose

- `tsconfig.json` — the "everything" config (`package/use-courier/**/*.ts` + `tests/**/*.ts`), with `"types": ["bun"]` so `bun:test` types resolve. No `rootDir`/`outDir`; `noEmit: true`. This is what the editor auto-discovers and what `bun run typecheck` uses.
- `tsconfig.build.json` — extends the above, narrows `include`/`rootDir` to `package/use-courier` only, adds `outDir`/`declaration`. Used only by `build`/`build:types`, so `dist/` never picks up test files.

(This split exists because editors only auto-discover a file literally named `tsconfig.json`; a separate test-only config was invisible to the IDE.)

### The hook (`package/use-courier/`)

The upload logic lives in a framework-agnostic core, `createCourier()` (`create-courier.ts`), which imports no framework: it owns the file list and everything that changes it (`commitFiles`, `performUpload`, `addFile`, `retryUpload`, `removeFile`, `abortAll`) and exposes `getFiles`/`subscribe` like an external store. `use-courier.ts` is a thin React adapter over it: `useSyncExternalStore` for re-renders, `useLatest` to supply the latest props, and `abortAll` on unmount. Another framework's adapter (Vue, #35) should wrap the same core rather than copy logic. The stateless pieces the core uses are separate modules, none of which use React: `transport.ts` (the XHR wrapper), `request-options.ts` (headers and multipart body), `upload-file.ts` (whole-file vs chunked dispatch), `chunked-upload.ts` (chunking, chunk retries, resume state), `overall.ts` (the `overall` aggregate), `callbacks.ts` (`notify`, which runs a callback and reports anything it throws), and `ids.ts`. Keep that split: new upload logic goes in the core or a stateless module, never in an adapter. Only `index.ts` is public; the core is internal for now (see the decisions on #34).

Uses `XMLHttpRequest`, not `fetch` — deliberately, because `fetch` cannot report upload progress. That constraint is why the transport is built the way it is.

State inside `createCourier`, intentionally kept out of the public `files` array:

- `files` — replaced, never mutated, on every change, and only through `commitFiles`, which then notifies subscribers. Every lookup (`retryUpload`, `removeFile`, the `item` passed to callbacks) reads it directly, so a file is visible the moment `addFile` returns, without waiting for a re-render.
- `inFlight: Map<fileId, XMLHttpRequest>` — the current in-flight request per file, so `removeFile`/`abortAll` can `.abort()` it. Only one entry per file at a time, even mid-chunking.
- `resumeState: Map<fileId, { uploadId, nextChunkIndex }>` — set when a chunk exhausts `fileChunking.maxChunkRetries`; lets `retryUpload` resume a failed chunked upload at the chunk that actually failed (reusing the same `uploadId`) instead of restarting the whole file from chunk 0. Cleared on full success or `removeFile`.
- `generation` — bumped by `abortAll`, so an upload still waiting on async headers (no request yet to abort) knows it was cancelled. A counter rather than a "disposed" flag because React Strict Mode unmounts and remounts once in development, and the courier must keep working after that.
- Options are never stored: the core calls the adapter's `getOptions()` each time it needs one, so every callback, `url`, and `fileChunking` is the latest value even though an upload outlives the render it started in.

Callbacks split into two kinds: `beforeUpload`/`onUploadRetry` are gates — throwing from them rejects the attempt, so they're called directly. The rest are notifications and always go through `notify`, so a throw is reported and can never change a file's status or the `UploadResult`.

Chunks within one file are always sent strictly sequentially, never in parallel. The chunk-endpoint contract keys chunks by `uploadId` + `chunkIndex` and reassembles once every index has arrived — this is exactly why resuming under the same `uploadId` after a retry needs no backend changes.

Cancellation only happens via `removeFile` (or unmount, which aborts everything still in flight) — there is no other abort path in real usage, and `removeFile` always drops the file from `files` in the same call a cancellation would occur. A cancellation is never automatically retried.

The full `status` state machine and the non-obvious behaviors around it (e.g. `idle` is a type but is never actually observed in `files`; a page reload mid-upload still restarts from scratch even though a same-session `retryUpload` now resumes) are documented in `documentation/upload-lifecycle.md` — read it before touching retry/cancel/status logic, and update it if that logic changes.

### Testing: why there's a hand-rolled XHR mock

Runner is `bun test` with `happy-dom` (via `@happy-dom/global-registrator`, preloaded through `bunfig.toml` → `tests/setup.ts`) providing `document`/`render()` so `@testing-library/react`'s `renderHook` works. The registrator disables happy-dom's same-origin policy so tests can talk to mock HTTP servers on arbitrary ports.

happy-dom's real `XMLHttpRequest` only implements _download_ progress, not _upload_ progress — the one thing this hook exists to provide — so it cannot exercise the hook's actual behavior. `tests/mock-xhr.ts` is a small hand-rolled `XMLHttpRequest` double, swapped onto `globalThis.XMLHttpRequest` in `beforeEach`, giving tests full synchronous control over when `progress`/`load`/`error`/`abort` fire. Don't rely on happy-dom's XHR for anything upload-progress- or retry-related — use the mock and drive it explicitly (see existing tests for the `act()` patterns needed around it).

### Documentation lives in three places — a behavior change means updating up to three

1. `documentation/*.md` — VitePress source, the human-facing docs site.
2. `documentation/public/llms.txt` — short linked index for LLM tooling.
3. `documentation/public/llms-full.txt` — every doc page concatenated into one file for LLM tooling. This is hand-maintained, not generated from (1) — an edit to a doc page must be manually mirrored here or it silently goes stale.

### GitHub Pages base-path gotcha

The GitHub repo is named `useCourier` (capital C); the npm package is `use-courier` (lowercase-hyphenated). This mismatch is intentional. `documentation/.vitepress/config.ts`'s `base` must match the **GitHub repo name** exactly (`/useCourier/`), not the npm package name, because GitHub Pages serves a project site at a path matching the repo name. Getting this wrong 404s every asset on the deployed site.

### Versioning policy while pre-1.0

Follow semver's minor-slot convention for `0.x` releases: a fix that doesn't change documented behavior is a patch (`0.1.x`); anything that adds, removes, or changes documented behavior — even non-breaking — is a minor bump (`0.x.0`), since there's no "true" major slot to distinguish breaking from non-breaking until `1.0.0`. Reserve `1.0.0` for when the API is considered stable, not for any particular feature.

### Workflow conventions

- Every change goes through a feature branch → PR → CI (lint, format check, typecheck, test, build) → merge, including solo work. Branch protection on `main` requires this for non-admin contributors.
- Feature ideas are tracked as GitHub Issues labeled `enhancement` — check there before assuming an idea is new.
