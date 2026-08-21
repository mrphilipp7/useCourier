# Backend Integration

`useCourier` sends files using `multipart/form-data`. Your backend must expose an endpoint that accepts the uploaded file and returns a JSON response.

## Standard uploads

Configure the regular upload endpoint with `url`:

```tsx
const { files, addFile } = useCourier({
  url: "/api/uploads",
});
```

The request contains one file field:

| Field  | Description        |
| ------ | ------------------ |
| `file` | The selected file. |

Your endpoint should:

1. Parse the multipart request.
2. Validate and store the file.
3. Return a successful `2xx` status.
4. Return a valid JSON response.

## Response handling

The hook parses the response body as JSON. A successful response is returned through `addFile` or `retryUpload`:

```ts
{
  success: true,
  data: response,
}
```

Any non-`2xx` response becomes an upload error:

```ts
{
  success: false,
  error: Error,
}
```

Use a `4xx` status for client errors, such as invalid files, and a `5xx` status for server-side failures.

## Chunked uploads

For large files, configure a separate chunk endpoint:

```tsx
const { addFile } = useCourier({
  url: "/api/uploads",
  fileChunking: {
    route: "/api/uploads/chunks",
    threshold: 100 * 1024 * 1024,
    chunkSize: 10 * 1024 * 1024,
  },
});
```

Files larger than `threshold` are sent to `route` in sequential requests. Each request contains:

| Field         | Description                                |
| ------------- | ------------------------------------------ |
| `file`        | The current chunk.                         |
| `uploadId`    | An ID shared by every chunk in one upload. |
| `chunkIndex`  | The zero-based index of the current chunk. |
| `totalChunks` | The total number of chunks for the file.   |

The final chunk response becomes the upload result returned by the hook.

## Server responsibilities

The chunk endpoint must:

1. Parse the `file`, `uploadId`, `chunkIndex`, and `totalChunks` fields.
2. Store each chunk under its `uploadId` and `chunkIndex`.
3. Detect when all chunks for an upload have arrived.
4. Reassemble the chunks in index order.
5. Return the completed upload response from the final request.

The client does not reassemble the file. The server should also clean up incomplete or expired uploads so abandoned chunks do not accumulate indefinitely.

## Backend considerations

- Configure multipart parsing for both standard and chunked endpoints.
- Enforce file-size and request-size limits.
- Configure CORS when the frontend and backend use different origins.
- Validate file types, authentication, and authorization server-side.
- Use an upload ID and chunk index to prevent chunks from being mixed between uploads.
- Make chunk writes idempotent when possible so retries do not corrupt the completed file.

## Framework examples

The framework-specific guides show how to implement this contract with Express, Next.js, TanStack Start, and Hono.
