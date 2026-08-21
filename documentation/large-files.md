# Large File Uploads

Chunking is the advanced upload path for files that should not be sent in one request. When enabled, `useCourier` splits a large file into smaller pieces and sends those pieces sequentially to your chunk endpoint.

## When chunking starts

Chunking is enabled with the `fileChunking` option. A file is chunked only when its size is greater than `threshold`.

```tsx
import { useCourier } from "use-courier";

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

Files at or below the threshold use the regular `url` endpoint. Larger files use `fileChunking.route` instead.

## Configuration

| Property          | Type     | Description                                              |
| ----------------- | -------- | -------------------------------------------------------- |
| `route`           | `string` | Endpoint that receives each chunk.                       |
| `threshold`       | `number` | File size in bytes at which chunking begins.             |
| `chunkSize`       | `number` | Size of each chunk in bytes. Defaults to `threshold`.    |
| `maxChunkRetries` | `number` | Additional attempts for a failed chunk. Defaults to `2`. |

All sizes are measured in bytes. For example, `10 * 1024 * 1024` represents 10 MiB.

## How a chunked upload works

For a file with a size of 12 MiB and a `chunkSize` of 5 MiB, the hook sends three requests:

1. Chunk `0`: bytes `0` through `5 MiB`
2. Chunk `1`: bytes `5 MiB` through `10 MiB`
3. Chunk `2`: the remaining `2 MiB`

The requests are sent one at a time. Each request uses `multipart/form-data` and includes:

| Field         | Description                                       |
| ------------- | ------------------------------------------------- |
| `file`        | The current chunk as a file part.                 |
| `uploadId`    | A unique ID shared by every chunk in this upload. |
| `chunkIndex`  | The zero-based index of the current chunk.        |
| `totalChunks` | The total number of chunks for the file.          |

The final chunk response becomes the `data` value returned by `addFile` or `retryUpload`.

## Progress and retries

Progress is reported as the total number of bytes sent across all chunks, not just the current chunk. This means the `uploadProgress` value continues smoothly from one chunk to the next.

If a chunk fails, the hook retries that chunk up to `maxChunkRetries` additional times before marking the upload as failed. Cancellation is not retried. Calling `removeFile` aborts the active request and removes the file from the tracked list.

## Server responsibilities

The chunk endpoint must:

1. Read the `file`, `uploadId`, `chunkIndex`, and `totalChunks` fields.
2. Store each chunk under its `uploadId` and `chunkIndex`.
3. Detect when all chunks for an upload have arrived.
4. Reassemble the chunks in index order.
5. Return the completed upload response from the final request.

The client does not reassemble the file. Your server must also clean up incomplete or expired uploads so abandoned chunks do not accumulate indefinitely.

## Choosing chunk sizes

A larger chunk size means fewer requests and less request overhead, but each retry sends more data. A smaller chunk size can make retries cheaper and may work better with request-size limits, but it creates more requests.

Choose a `threshold` and `chunkSize` that fit your server's request limits and storage strategy.
