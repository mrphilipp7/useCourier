# Backend Integration

`useCourier` sends files using `multipart/form-data`. Your backend must expose an endpoint that accepts the uploaded file and returns a JSON response.

## Standard uploads

Configure the regular upload endpoint with `url`:

```tsx
const { files, addFile } = useCourier({
  url: "/api/uploads",
});
```

The request contains the file, plus any extra fields you add with `formFields` (sent before the file):

| Field  | Description                                            |
| ------ | ------------------------------------------------------ |
| `file` | The selected file. Use `fieldName` to change the name. |

Requests use `POST` by default; set `method` to use `PUT` or `PATCH`.

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

Any non-`2xx` response, or a `2xx` response whose body is not valid JSON (including an empty body), becomes an upload error:

```ts
{
  success: false,
  error: Error,
}
```

Use a `4xx` status for client errors, such as invalid files, and a `5xx` status for server-side failures. The error is an `XhrResponseError` with the response's `status` and raw `body`, so the client can tell them apart.

## Authentication

Send a token with `headers`, or cookies with `withCredentials`. Both apply to every request, including each chunk:

```tsx
const { addFile } = useCourier({
  url: "https://api.example.com/uploads",
  headers: async () => ({
    Authorization: `Bearer ${await getAccessToken()}`,
  }),
});
```

When the upload endpoint is on a different origin than your page, the browser enforces CORS:

- A custom header such as `Authorization` makes the browser send a preflight `OPTIONS` request first. Your server must answer it and list the header in `Access-Control-Allow-Headers`.
- With `withCredentials: true`, the server must send `Access-Control-Allow-Credentials: true` and name your page's exact origin in `Access-Control-Allow-Origin`; `*` isn't allowed with credentials.
- With `method: "PUT"` or `"PATCH"`, list the method in `Access-Control-Allow-Methods`.

A rejected token comes back as an `XhrResponseError` whose `status` is `401` or `403`, which you can check in `onUploadError`.

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

The final chunk response becomes the upload result returned by the hook, so it must be valid JSON. Responses to earlier chunks are never read: any `2xx` status, including an empty `204`, counts as the chunk being received.

Before 0.4.0, every chunk response had to be valid JSON, and a non-JSON response left the upload stuck in `processing`.

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
- Configure CORS when the frontend and backend use different origins (see [Authentication](#authentication)).
- Validate file types, authentication, and authorization server-side.
- Use an upload ID and chunk index to prevent chunks from being mixed between uploads.
- Make chunk writes idempotent when possible so retries do not corrupt the completed file.

## Framework examples

The framework-specific guides show how to implement this contract with Express, Next.js, TanStack Start, and Hono.
