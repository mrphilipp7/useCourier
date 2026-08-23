# TanStack Start

TanStack Start server routes can receive the `multipart/form-data` requests sent by `useCourier`. This page starts with a basic upload route, then adds chunking as a separate advanced route.

## Client setup

Point `useCourier` at the server route:

```tsx
import { useCourier } from "use-courier";

const { addFile } = useCourier({
  url: "/upload",
});
```

The hook sends each file using the `file` field in a `multipart/form-data` request.

## Server route

Create `src/routes/upload.ts` in your TanStack Start application. The file-based route creates a `POST /upload` endpoint.

```ts
import { createFileRoute } from "@tanstack/react-router";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const UPLOAD_DIR = path.resolve("./uploads");

function safeFileName(fileName: string) {
  return path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, "_");
}

export const Route = createFileRoute("/upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const formData = await request.formData();
          const files = formData
            .getAll("file")
            .filter((value): value is File => value instanceof File);

          if (files.length === 0) {
            return Response.json(
              { error: "At least one file is required" },
              { status: 400 },
            );
          }

          await mkdir(UPLOAD_DIR, { recursive: true });

          const savedFiles = [];
          for (const file of files) {
            const name = safeFileName(file.name);
            const storedName = `${randomUUID()}-${name}`;
            const bytes = Buffer.from(await file.arrayBuffer());

            await writeFile(path.join(UPLOAD_DIR, storedName), bytes);
            savedFiles.push({
              name,
              size: file.size,
              type: file.type,
            });
          }

          return Response.json({
            count: savedFiles.length,
            files: savedFiles,
          });
        } catch (error) {
          console.error(error);
          return Response.json(
            { error: "Error processing files" },
            { status: 500 },
          );
        }
      },
    },
  },
});
```

Start the application and use the upload UI. The route returns the metadata shape expected by `useCourier`:

```json
{
  "count": 1,
  "files": [
    {
      "name": "document.pdf",
      "size": 12345,
      "type": "application/pdf"
    }
  ]
}
```

## What this route does

- Defines a `POST /upload` server route using TanStack Start's file-based routing.
- Reads the request body with `request.formData()`.
- Supports one or more files under the `file` field.
- Returns `400` when no file is provided.
- Stores files in a local `uploads` directory.
- Returns `500` when request processing fails.

## Runtime and production notes

This example uses `node:fs` and is intended for a Node deployment. For serverless or edge deployments, replace local filesystem storage with object storage or another durable storage service.

Add authentication, authorization, file-type validation, and upload limits before using this route in production.

## Chunked uploads

Once the basic upload works, configure a separate route for files larger than your chosen threshold:

```tsx
const { addFile } = useCourier({
  url: "/upload",
  fileChunking: {
    route: "/upload/chunk",
    threshold: 100 * 1024 * 1024,
    chunkSize: 10 * 1024 * 1024,
    maxChunkRetries: 2,
  },
});
```

Create `src/routes/upload/chunk.ts`. TanStack Start maps this file to `POST /upload/chunk`:

```ts
import { createFileRoute } from "@tanstack/react-router";
import {
  mkdir,
  access,
  appendFile,
  readFile,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

const CHUNK_DIR = path.resolve("./tmp/upload-chunks");
const UPLOAD_DIR = path.resolve("./uploads");
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeFileName(fileName: string) {
  return path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, "_");
}

export const Route = createFileRoute("/upload/chunk")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const formData = await request.formData();
          const chunk = formData.get("file");
          const uploadId = formData.get("uploadId");
          const chunkIndex = formData.get("chunkIndex");
          const totalChunks = formData.get("totalChunks");

          if (
            !(chunk instanceof File) ||
            typeof uploadId !== "string" ||
            typeof chunkIndex !== "string" ||
            typeof totalChunks !== "string"
          ) {
            return Response.json(
              { error: "Malformed chunk upload request" },
              { status: 400 },
            );
          }

          if (!UUID_REGEX.test(uploadId)) {
            return Response.json(
              { error: "Invalid uploadId" },
              { status: 400 },
            );
          }

          const index = Number(chunkIndex);
          const total = Number(totalChunks);
          if (
            !Number.isInteger(index) ||
            !Number.isInteger(total) ||
            index < 0 ||
            total <= 0 ||
            index >= total
          ) {
            return Response.json(
              { error: "Invalid chunkIndex/totalChunks" },
              { status: 400 },
            );
          }

          await mkdir(CHUNK_DIR, { recursive: true });
          const chunkPath = path.join(CHUNK_DIR, `${uploadId}-${index}.part`);
          await writeFile(chunkPath, Buffer.from(await chunk.arrayBuffer()));

          if (index !== total - 1) {
            return Response.json({ chunkIndex: index, received: true });
          }

          const chunkPaths = Array.from({ length: total }, (_, chunkNumber) =>
            path.join(CHUNK_DIR, `${uploadId}-${chunkNumber}.part`),
          );

          try {
            await Promise.all(chunkPaths.map((filePath) => access(filePath)));
          } catch {
            return Response.json(
              { error: "Not all chunks have been received" },
              { status: 409 },
            );
          }

          await mkdir(UPLOAD_DIR, { recursive: true });
          const name = safeFileName(chunk.name);
          const finalPath = path.join(UPLOAD_DIR, `${uploadId}-${name}`);
          await writeFile(finalPath, Buffer.alloc(0));

          for (const filePath of chunkPaths) {
            await appendFile(finalPath, await readFile(filePath));
            await unlink(filePath);
          }

          const file = await readFile(finalPath);
          return Response.json({
            count: 1,
            files: [{ name, size: file.byteLength, type: chunk.type }],
          });
        } catch (error) {
          console.error(error);
          return Response.json(
            { error: "Error processing chunk" },
            { status: 500 },
          );
        }
      },
    },
  },
});
```

The route writes chunks by index, so a retry replaces the previous chunk instead of appending duplicate bytes. The client sends chunks sequentially, and the server reassembles them in index order when the final chunk arrives.

This example uses local filesystem storage and should run in a Node deployment. For production, add cleanup for abandoned chunks and use object storage or another durable storage system when local disk is not persistent.

See [Backend Integration](/backend-integration) for the shared upload contract and [Large File Uploads](/large-files) for the chunking flow.
