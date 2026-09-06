# Upload Lifecycle

This page documents exactly what `status` transitions happen, and in what order, for every outcome an upload can have — including the cases that tend to surprise people: a chunk failing partway through, cancelling mid-upload, and retrying or restarting after a failure.

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

Once a chunk exhausts its retries, the **entire upload** fails: `status` becomes `"error"`, `onUploadError` fires with the underlying error, and no later chunks are attempted. There's no partial-success state — a file is either fully `done` or it's `error`, even if 9 of 10 chunks made it through.

## Cancelling mid-upload

Only one request is ever in flight per file at a time — for a chunked upload, that's whichever chunk is currently sending. Calling `removeFile(id)` (or unmounting the component, which aborts everything still in flight) aborts that request immediately.

A cancellation is **never retried**, even if the chunk still has retry attempts left — it's treated as intentional and propagates straight through as an `UploadCancelledError`, without pausing at intermediate chunks either. `removeFile` also removes the item from `files` in the same call, so by the time `onUploadError`/`onUploadFinish` fire for the cancellation, the file is already gone from the tracked list — don't rely on reading it back out of `files` from inside those callbacks.

## `retryUpload` restarts — it doesn't resume

This is the one most worth calling out explicitly: **`retryUpload` starts the upload over from scratch, not from where it failed.** For a chunked upload, that means a brand-new `uploadId` and chunking beginning again at `chunkIndex` `0` — none of the progress from the failed attempt carries over.

The chunks that were already sent under the _previous_ `uploadId` are now orphaned on the server. This is exactly why your chunk endpoint needs to clean up incomplete/abandoned uploads (see [Backend Integration](/backend-integration)) — every failed-then-retried chunked upload leaves one behind.

The same applies if the user reloads the page mid-upload instead of hitting a retry button: all upload state lives only in React state and an in-memory ref, so nothing survives a reload. A fresh `addFile` call after reloading is indistinguishable from uploading the file for the first time — new `id`, new `uploadId` if it's chunked, and the bytes already sent before the reload are abandoned server-side. There is currently no support for resuming a partially-completed upload; every restart re-sends the whole file.
