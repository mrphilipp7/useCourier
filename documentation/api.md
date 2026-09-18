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

#### `url`

- **Type:** `string`
- **Required**

The endpoint that receives whole-file uploads.

#### `beforeUpload`

- **Type:** `(context: { item: UploadItem }) => void`
- **Optional**

Runs before an upload starts. Throw an error to reject the file without starting a request.

#### `onUploadSuccess`

- **Type:** `(context: { item: UploadItem }) => void`
- **Optional**

Runs after the upload API returns a successful response.

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

Runs when `retryUpload` is called. Throw an error to reject the retry before another request starts.

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
