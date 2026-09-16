# Upload Lifecycle

This page documents exactly what `status` transitions happen, and in what order, for every outcome an upload can have — including the cases that tend to surprise people: a chunk failing partway through, cancelling mid-upload, and what actually happens when you retry after a failure.

## Status state machine

| From                       | To           | Trigger                                                                                                  |
| -------------------------- | ------------ | -------------------------------------------------------------------------------------------------------- |
| _(none)_                   | `uploading`  | `addFile` adds the file to `files` and starts the request                                                |
| `uploading`                | `processing` | All bytes have been sent (`uploadProgress` reaches 100) and the hook is waiting on the server's response |
| `uploading` / `processing` | `done`       | The server responds with a `2xx` status                                                                  |
| `uploading` / `processing` | `error`      | A network error, a non-`2xx` response, a `beforeUpload`/`onUploadRetry` rejection, or a cancellation     |
| `error`                    | `uploading`  | `retryUpload(id)` is called                                                                              |

`idle` exists as a type but isn't a state you'll ever observe in `files` — every file is already `uploading` by the time `addFile` adds it to the list. `done` and `error` are terminal: the only way out of `error` is `retryUpload`, and there's no way out of `done` at all.

## When a chunk fails

Each chunk is retried independently, up to `fileChunking.maxChunkRetries` (default `2`) **additional** attempts, reusing the same `uploadId` and `chunkIndex` — earlier, already-succeeded chunks are not re-sent.

Once a chunk exhausts its retries, the **entire upload** fails: `status` becomes `"error"`, `onUploadError` fires with the underlying error, and no later chunks are attempted. There's no partial-success state — a file is either fully `done` or it's `error`, even if 9 of 10 chunks made it through. A later `retryUpload` call can pick up from exactly this point — see below.

## Cancelling mid-upload

Only one request is ever in flight per file at a time — for a chunked upload, that's whichever chunk is currently sending. Calling `removeFile(id)` (or unmounting the component, which aborts everything still in flight) aborts that request immediately.

A cancellation is **never retried**, even if the chunk still has retry attempts left — it's treated as intentional and propagates straight through as an `UploadCancelledError`, without pausing at intermediate chunks either. `removeFile` also removes the item from `files` in the same call, so by the time `onUploadError`/`onUploadFinish` fire for the cancellation, the file is already gone from the tracked list — don't rely on reading it back out of `files` from inside those callbacks.

## `retryUpload` resumes a chunked upload — it doesn't restart

For a chunked upload, `retryUpload` picks up at the chunk that failed instead of starting the whole file over: it reuses the same `uploadId` and begins again at that `chunkIndex`, so chunks that already succeeded aren't re-sent. `uploadProgress` reflects the resumed starting point immediately, rather than resetting to `0` and jumping back up once the resumed chunk's first progress event arrives.

This works without any changes to your server: the chunk-endpoint contract already keys chunks by `uploadId` + `chunkIndex` and reassembles once every index has arrived (see [Backend Integration](/backend-integration)), so resuming under the same `uploadId` looks identical to the server as a slower single attempt — nothing is orphaned.

For a non-chunked (whole-file) upload there's no partial progress to resume from, so `retryUpload` re-sends the entire file, same as it always has.

**This only covers retrying within the same page session.** If the user reloads the page mid-upload instead of clicking retry, everything is lost: all upload state lives only in React state and an in-memory ref, so nothing survives a reload. A fresh `addFile` call after reloading is indistinguishable from uploading the file for the first time — new `id`, new `uploadId` if it's chunked — and the bytes already sent before the reload are abandoned server-side. There is currently no support for resuming an upload across a page reload, only across a manual retry in the same session.
