# Upload Lifecycle

This page documents exactly what `status` transitions happen, and in what order, for every outcome an upload can have — including the cases that tend to surprise people: a chunk failing partway through, cancelling mid-upload, and what actually happens when you retry after a failure.

## See it in action

This is the [basic usage](/get-started#basic-usage) example with every lifecycle callback added. Each callback shows a toast (using [Sonner](https://ui.shadcn.com/docs/components/radix/sonner)) saying when it ran:

```tsx
import { useCourier } from "use-courier";
import { toast } from "sonner";

export function UploadForm() {
  const { files, addFile, retryUpload, removeFile } = useCourier({
    url: "/api/uploads",
    beforeUpload: ({ item }) => {
      toast("I ran before the upload", { description: item.file.name });
    },
    onUploadSuccess: ({ item }) => {
      toast.success("I ran after a successful upload", {
        description: item.file.name,
      });
    },
    onUploadError: ({ item, error }) => {
      toast.error("I ran because the upload failed", {
        description: `${item.file.name}: ${error.message}`,
      });
    },
    onUploadFinish: ({ item }) => {
      toast("I ran after the upload, success or failure", {
        description: item.file.name,
      });
    },
    onUploadRetry: ({ item }) => {
      toast.info("I ran before the retry", { description: item.file.name });
    },
    onRemoveFile: ({ item }) => {
      toast("I ran when the file was removed", {
        description: item.file.name,
      });
    },
  });

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) addFile(file);
  }

  return (
    <>
      <input type="file" onChange={handleFileChange} />
      {files.map((item) => (
        <p key={item.id}>
          {item.file.name}: {item.status} ({item.uploadProgress}%)
          {item.status === "error" && (
            <button onClick={() => retryUpload(item.id)}>Retry</button>
          )}
          <button onClick={() => removeFile(item.id)}>Remove</button>
        </p>
      ))}
    </>
  );
}
```

### Try it

Upload a file and watch the toasts. A successful upload shows `beforeUpload`, then `onUploadSuccess`, then `onUploadFinish`. Turn on **Simulate a failed upload** to see `onUploadError` instead, then click Retry to see `onUploadRetry` followed by `beforeUpload` again. Turn on **Reject the file in `beforeUpload`** to see a file rejected before any request is made.

<LifecycleDemo />

## Status state machine

| From                       | To           | Trigger                                                                                                  |
| -------------------------- | ------------ | -------------------------------------------------------------------------------------------------------- |
| _(none)_                   | `uploading`  | `addFile` adds the file to `files` and starts the request                                                |
| `uploading`                | `processing` | All bytes have been sent (`uploadProgress` reaches 100) and the hook is waiting on the server's response |
| `uploading` / `processing` | `done`       | The server responds with a `2xx` status                                                                  |
| `uploading` / `processing` | `error`      | A network error, a non-`2xx` response, a `beforeUpload`/`onUploadRetry` rejection, or a cancellation     |
| `error`                    | `uploading`  | `retryUpload(id)` is called                                                                              |

`idle` exists as a type but isn't a state you'll ever observe in `files` — every file is already `uploading` by the time `addFile` adds it to the list. `done` and `error` are terminal: the only way out of `error` is `retryUpload`, and there's no way out of `done` at all.

## How callbacks behave

- **`item` is the file as it is when the callback runs**, matching its entry in `files` at that moment. `onUploadSuccess` also receives `data`, the server's parsed response. In `beforeUpload` it's `uploading` at 0%; in `onUploadSuccess` it's `done` at 100%; in `onUploadError` it's `error`, with `uploadProgress` frozen where the upload stopped. For a file `removeFile` cancelled, it's the file's last known state marked `error`, since the file is no longer in `files`.
- **The latest version of each callback is the one that runs.** An upload can outlast the render it started in, so the hook always calls the callbacks, and uses `url` and `fileChunking`, from the most recent render. Callbacks can read current props and state without stale values.
- **A callback that throws can't break an upload.** If `onUploadSuccess`, `onUploadError`, `onUploadFinish`, or `onRemoveFile` throws, the error is reported with the browser's [`reportError`](https://developer.mozilla.org/en-US/docs/Web/API/Window/reportError) (falling back to `console.error`), which logs it and reaches error-tracking tools. The file's `status` and the result `addFile`/`retryUpload` resolve with are unaffected. `beforeUpload` and `onUploadRetry` are different: throwing from them is how you reject a file.

Before 0.6.0, `item` was the file as it was when the upload started (so `onUploadSuccess` saw `status: "idle"`), callbacks came from the render where the upload started, and a throwing `onUploadSuccess` marked a successful upload as `error`.

## When a chunk fails

Each chunk is retried independently, up to `fileChunking.maxChunkRetries` (default `2`) **additional** attempts, reusing the same `uploadId` and `chunkIndex` — earlier, already-succeeded chunks are not re-sent.

Once a chunk exhausts its retries, the **entire upload** fails: `status` becomes `"error"`, `onUploadError` fires with the underlying error, and no later chunks are attempted. There's no partial-success state — a file is either fully `done` or it's `error`, even if 9 of 10 chunks made it through. A later `retryUpload` call can pick up from exactly this point — see below.

## Cancelling mid-upload

Only one request is ever in flight per file at a time — for a chunked upload, that's whichever chunk is currently sending. Calling `removeFile(id)` (or unmounting the component, which aborts everything still in flight) aborts that request immediately.

A cancellation is **never retried**, even if the chunk still has retry attempts left — it's treated as intentional and propagates straight through as an `UploadCancelledError`, without pausing at intermediate chunks either. `removeFile` also removes the item from `files` in the same call, so by the time `onUploadError`/`onUploadFinish` fire for the cancellation, the file is already gone from the tracked list — don't rely on reading it back out of `files` from inside those callbacks.

## `retryUpload` runs your checks again

Every retry goes through the same checks as the first attempt: `onUploadRetry` runs first, then `beforeUpload`, and either one can throw to reject the retry without starting a request. The file stays in `error`, and `onUploadError` and `onUploadFinish` fire again with the new rejection.

This means a file `beforeUpload` rejected can't be uploaded just by retrying it, while a file rejected for a reason that has since changed (for example, the user freed up quota) goes through.

Before 0.5.0, `retryUpload` did not run `beforeUpload`, so a file it rejected could be uploaded by retrying it.

## `retryUpload` resumes a chunked upload — it doesn't restart

For a chunked upload, `retryUpload` picks up at the chunk that failed instead of starting the whole file over: it reuses the same `uploadId` and begins again at that `chunkIndex`, so chunks that already succeeded aren't re-sent. `uploadProgress` reflects the resumed starting point immediately, rather than resetting to `0` and jumping back up once the resumed chunk's first progress event arrives.

This works without any changes to your server: the chunk-endpoint contract already keys chunks by `uploadId` + `chunkIndex` and reassembles once every index has arrived (see [Backend Integration](/backend-integration)), so resuming under the same `uploadId` looks identical to the server as a slower single attempt — nothing is orphaned.

For a non-chunked (whole-file) upload there's no partial progress to resume from, so `retryUpload` re-sends the entire file, same as it always has.

**This only covers retrying within the same page session.** If the user reloads the page mid-upload instead of clicking retry, everything is lost: all upload state lives only in React state and an in-memory ref, so nothing survives a reload. A fresh `addFile` call after reloading is indistinguishable from uploading the file for the first time — new `id`, new `uploadId` if it's chunked — and the bytes already sent before the reload are abandoned server-side. There is currently no support for resuming an upload across a page reload, only across a manual retry in the same session.
