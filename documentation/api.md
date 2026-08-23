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

### `removeFile(id)`

- **Type:** `(id: string) => void`

Removes a tracked file by ID. If its upload is still in progress, the request is aborted first.

## Error classes

The package exports these error classes:

- `FileError` for invalid or unavailable files
- `XhrRequestError` for network or request failures
- `XhrResponseError` for unsuccessful or unusable responses
- `UploadCancelledError` when an upload is intentionally aborted
