# Hono

This example implements the standard upload endpoint from the [Backend Integration](/backend-integration) guide with Hono. It accepts one or more files from the `file` field and returns metadata about each file.

## Client setup

Point `useCourier` at the Hono route:

```tsx
import { useCourier } from "use-courier";

const { addFile } = useCourier({
  url: "/upload",
});
```

The hook sends files as `multipart/form-data` with the field name `file`.

## Hono route

```ts
import { Hono } from "hono";

const route = new Hono().post("/", async (c) => {
  try {
    const body = await c.req.parseBody({ all: true });
    const value = body.file;

    const files = Array.isArray(value)
      ? value.filter((item): item is File => item instanceof File)
      : value instanceof File
        ? [value]
        : [];

    if (files.length === 0) {
      return c.text("At least one file is required", 400);
    }

    const response = {
      count: files.length,
      files: files.map((file) => ({
        name: file.name,
        size: file.size,
        type: file.type,
      })),
    };

    console.log(response);
    return c.json(response);
  } catch {
    return c.text("Error processing files", 500);
  }
});

export default route;
```

Mount the route at `/upload` in your Hono application, or update the client `url` to match wherever you mount it.

## What this route does

- Parses a `multipart/form-data` request.
- Supports one file or multiple files under the `file` field.
- Returns `400` when no file is provided.
- Returns file name, size, and MIME type in a JSON response.
- Returns `500` when request processing fails.

This example logs file metadata instead of storing the files. In a production application, replace the `console.log` call with storage logic such as writing to object storage or a filesystem, and add authentication, authorization, file-type validation, and size limits.

## Chunked uploads

For files larger than a configured threshold, point `fileChunking.route` at a second Hono route:

```tsx
const { addFile } = useCourier({
  url: "/upload",
  fileChunking: {
    route: "/upload/chunk",
    threshold: 100 * 1024 * 1024,
    chunkSize: 10 * 1024 * 1024,
  },
});
```

Here is a Node-backed Hono route that validates each chunk, stores chunks by index, and combines them in order when the final chunk arrives:

```ts
import { Hono } from "hono";
import fs from "node:fs/promises";
import path from "node:path";

const CHUNK_TMP_DIR = "./tmp/upload-chunks";
const UPLOAD_DIR = "./uploads";
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sanitizeFileName(fileName: string) {
  return path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, "_");
}

const chunkRoute = new Hono().post("/", async (c) => {
  try {
    const body = await c.req.parseBody({ all: true });
    const chunk = body.file;
    const uploadId = body.uploadId;
    const chunkIndex = body.chunkIndex;
    const totalChunks = body.totalChunks;

    if (
      !(chunk instanceof File) ||
      typeof uploadId !== "string" ||
      typeof chunkIndex !== "string" ||
      typeof totalChunks !== "string"
    ) {
      return c.text("Malformed chunk upload request", 400);
    }

    if (!UUID_REGEX.test(uploadId)) {
      return c.text("Invalid uploadId", 400);
    }

    const parsedIndex = Number(chunkIndex);
    const parsedTotal = Number(totalChunks);

    if (
      !Number.isInteger(parsedIndex) ||
      !Number.isInteger(parsedTotal) ||
      parsedIndex < 0 ||
      parsedTotal <= 0 ||
      parsedIndex >= parsedTotal
    ) {
      return c.text("Invalid chunkIndex/totalChunks", 400);
    }

    await fs.mkdir(CHUNK_TMP_DIR, { recursive: true });
    const chunkPath = path.join(
      CHUNK_TMP_DIR,
      `${uploadId}-${parsedIndex}.part`,
    );

    // Writing by index makes a retried chunk replace its previous copy
    // instead of appending duplicate bytes.
    await fs.writeFile(chunkPath, Buffer.from(await chunk.arrayBuffer()));

    if (parsedIndex !== parsedTotal - 1) {
      return c.json({ chunkIndex: parsedIndex, received: true });
    }

    const chunkPaths = Array.from({ length: parsedTotal }, (_, index) =>
      path.join(CHUNK_TMP_DIR, `${uploadId}-${index}.part`),
    );

    try {
      await Promise.all(chunkPaths.map((filePath) => fs.access(filePath)));
    } catch {
      return c.text("Not all chunks have been received", 409);
    }

    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    const safeFileName = sanitizeFileName(chunk.name);
    const finalPath = path.join(UPLOAD_DIR, `${uploadId}-${safeFileName}`);

    await fs.writeFile(finalPath, Buffer.alloc(0));
    for (const filePath of chunkPaths) {
      await fs.appendFile(finalPath, await fs.readFile(filePath));
      await fs.unlink(filePath);
    }

    const stats = await fs.stat(finalPath);

    return c.json({
      count: 1,
      files: [{ name: safeFileName, size: stats.size, type: chunk.type }],
    });
  } catch (error) {
    console.error(error);
    return c.text("Error processing chunk", 500);
  }
});

export default chunkRoute;
```

This example uses the Node filesystem, so it is intended for a Hono application running on Node. For Hono on Workers, use object storage or another storage service instead of `node:fs`.

The client sends chunks sequentially, but the server still stores them by `uploadId` and `chunkIndex`. That makes retries replace the chunk rather than append duplicate bytes. See [Large File Uploads](/large-files) for the full chunking flow.
