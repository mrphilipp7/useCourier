# API Reference

## `useCourier`

Creates an upload manager for files selected in a React component.

```tsx
const { files, addFile, retryUpload, removeFile } = useCourier({
  url: "/api/uploads",
});
```

`useCourier` accepts a generic response type for the data returned by your upload API:

```tsx
const { addFile } = useCourier<UploadResponse>({
  url: "/api/uploads",
});
```

### Options

Every callback receives `{ item }` (plus `data` for `onUploadSuccess` and `error` for `onUploadError`), where `item` is the file's current state. See [How callbacks behave](/upload-lifecycle#how-callbacks-behave) for what `item` contains in each callback and what happens if a callback throws.

#### `url`

- **Type:** `string`
- **Required**

The endpoint that receives whole-file uploads.

#### `method`

- **Type:** `"POST" | "PUT" | "PATCH"`
- **Optional** (default `"POST"`)

The HTTP method for every upload request, including chunk requests.

#### `headers`

- **Type:** `Record<string, string> | (context: { item: UploadItem }) => Record<string, string> | Promise<Record<string, string>>`
- **Optional**

Headers sent with every upload request, such as an `Authorization` token. Pass a function to compute them per file. It's called once per request, including every chunk and every retry, so it can return a fresh token each time, and it can be `async`:

```tsx
const { addFile } = useCourier({
  url: "/api/uploads",
  headers: async () => ({
    Authorization: `Bearer ${await getAccessToken()}`,
  }),
});
```

With async headers, the request starts once the promise resolves. If the file is removed while it's pending, the upload is cancelled instead of starting. If the function throws or rejects, the upload fails with that error. On a different origin, custom headers need CORS set up on the server; see [Authentication](/backend-integration#authentication).

#### `withCredentials`

- **Type:** `boolean`
- **Optional** (default `false`)

Sends cookies and HTTP authentication with cross-origin uploads. Same-origin requests always include cookies, so you only need this when the upload endpoint is on another origin.

#### `fieldName`

- **Type:** `string`
- **Optional** (default `"file"`)

The form field the file, or each chunk, is sent under.

#### `formFields`

- **Type:** `Record<string, string> | (context: { item: UploadItem }) => Record<string, string>`
- **Optional**

Extra form fields sent with every upload request, ahead of the file so streaming parsers like Multer can read them before the file arrives:

```tsx
const { addFile } = useCourier({
  url: "/api/uploads",
  formFields: ({ item }) => ({
    folderId: currentFolder.id,
    originalName: item.file.name,
  }),
});
```

Chunk requests also include `uploadId`, `chunkIndex`, and `totalChunks`, so avoid those names.

#### `beforeUpload`

- **Type:** `(context: { item: UploadItem }) => void`
- **Optional**

Runs before every upload attempt, including each `retryUpload`. Throw an error to reject the file without starting a request. Because it runs again on retry, a file it rejected (for example, one that is too large) stays rejected, while a file rejected for a reason that has since changed (for example, a quota) can go through.

#### `onUploadSuccess`

- **Type:** `(context: { item: UploadItem; data: TUploadResponse }) => void`
- **Optional**

Runs after the upload API returns a successful response. `data` is the parsed JSON response (for a chunked upload, the final chunk's response), typed as the hook's response type:

```tsx
const { addFile } = useCourier<{ url: string }>({
  url: "/api/uploads",
  onUploadSuccess: ({ item, data }) => {
    console.log(`${item.file.name} is at ${data.url}`);
  },
});
```

#### `onUploadError`

- **Type:** `(context: { item: UploadItem; error: Error }) => void`
- **Optional**

Runs when validation, transport, response handling, or upload processing fails.

#### `onUploadFinish`

- **Type:** `(context: { item: UploadItem }) => void`
- **Optional**

Runs after every upload attempt, whether it succeeds or fails.

#### `onUploadRetry`

- **Type:** `(context: { item: UploadItem }) => void`
- **Optional**

Runs when `retryUpload` is called, before `beforeUpload` runs again. Throw an error to reject the retry before another request starts.

#### `onRemoveFile`

- **Type:** `(context: { item: UploadItem }) => void`
- **Optional**

Runs when a tracked file is removed. Removing an in-progress file also aborts its request.

#### `fileChunking`

- **Type:** `FileChunking`
- **Optional**

Enables chunked uploads for files larger than `threshold`.

```tsx
const { addFile } = useCourier({
  url: "/api/uploads",
  fileChunking: {
    route: "/api/uploads/chunks",
    threshold: 10 * 1024 * 1024,
    chunkSize: 5 * 1024 * 1024,
    maxChunkRetries: 2,
  },
});
```

| Property          | Type     | Description                                              |
| ----------------- | -------- | -------------------------------------------------------- |
| `route`           | `string` | Endpoint that receives each chunk.                       |
| `threshold`       | `number` | File size in bytes at which chunking begins.             |
| `chunkSize`       | `number` | Size of each chunk in bytes. Defaults to `threshold`.    |
| `maxChunkRetries` | `number` | Additional attempts for a failed chunk. Defaults to `2`. |

## Returned values

### `files`

- **Type:** `UploadItem[]`

The current files tracked by the hook. Each item includes:

| Property         | Type                                                         | Description                             |
| ---------------- | ------------------------------------------------------------ | --------------------------------------- |
| `id`             | `string`                                                     | Unique identifier for the tracked file. |
| `file`           | `File`                                                       | The original browser file.              |
| `status`         | `"idle" \| "uploading" \| "processing" \| "error" \| "done"` | Current upload state.                   |
| `uploadProgress` | `number`                                                     | Upload progress from `0` to `100`.      |

`processing` means all bytes have been sent and the hook is waiting for the server response.

### `addFile(file)`

- **Type:** `(file: File) => Promise<UploadResult<TUploadResponse>>`

Adds a file to the tracked list and starts uploading it immediately.

The promise resolves with either:

```ts
{ success: true, data: TUploadResponse }
```

or:

```ts
{ success: false, error: Error }
```

### `retryUpload(id)`

- **Type:** `(id: string) => Promise<UploadResult<TUploadResponse>>`

Retries a file whose status is `error`. The file ID comes from `files`.

For a chunked upload, this resumes from the chunk that failed rather than restarting from scratch — see [Upload Lifecycle](/upload-lifecycle) for exactly what that means, and the one case (a page reload) where it still starts over.

### `removeFile(id)`

- **Type:** `(id: string) => void`

Removes a tracked file by ID. If its upload is still in progress, the request is aborted first.

### `overall`

- **Type:** `OverallUploadState`

Aggregate progress and status across every currently tracked file, recomputed whenever `files` changes:

| Property           | Type                                                         | Description                                                                            |
| ------------------ | ------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `status`           | `"idle" \| "uploading" \| "processing" \| "error" \| "done"` | Worst-status-wins across all tracked files. See below.                                 |
| `averageProgress`  | `number`                                                     | Mean of each file's `uploadProgress`, every file weighted equally.                     |
| `weightedProgress` | `number`                                                     | Bytes sent so far across all files, divided by total bytes, as a `0`-`100` percentage. |

`status` follows the same precedence order most CI/build systems use for an aggregate result: `"error"` if any file has errored, else `"uploading"` if any file is actively sending bytes, else `"processing"` if any file is fully sent and awaiting a response, else `"done"` once every file has finished. `"idle"` only appears here, when there are no tracked files at all — a single file's own `status` never reports `"idle"`.

`averageProgress` and `weightedProgress` diverge whenever tracked files are different sizes. For example, an 80-byte file at 20% alongside a 20-byte file at 100%:

- `averageProgress`: `(20 + 100) / 2 = 60` — both files count equally regardless of size.
- `weightedProgress`: `(80 × 0.20 + 20 × 1.00) / (80 + 20) × 100 = 36` — the larger file's lower percentage pulls the number down, since it represents most of the total bytes.

Use `averageProgress` for a simple "how many of these files are roughly done" indicator, and `weightedProgress` for an accurate "how much of the total data has actually been sent" indicator — they can disagree by a wide margin when file sizes vary a lot.

An errored file's `uploadProgress` isn't excluded or reset for either calculation: the bytes it already sent are real, and [a retry resumes from them](/upload-lifecycle) rather than losing them, so `status` — not the progress numbers — is what tells you a file needs attention.

## Error classes

The package exports these error classes:

- `FileError` for invalid or unavailable files
- `XhrRequestError` for network or request failures
- `XhrResponseError` for unsuccessful or unusable responses
- `UploadCancelledError` when an upload is intentionally aborted

`XhrResponseError` has `status` (the HTTP status, or `0` if there was none) and `body` (the raw response text), so you can handle each failure differently:

```tsx
import { useCourier, XhrResponseError } from "use-courier";

const { addFile } = useCourier({
  url: "/api/uploads",
  onUploadError: ({ error }) => {
    if (error instanceof XhrResponseError && error.status === 401) {
      redirectToLogin();
    } else if (error instanceof XhrResponseError && error.status === 413) {
      showMessage("That file is too large.");
    }
  },
});
```
