# Nuxt

This example uses Nuxt server routes to receive the `multipart/form-data` requests sent by `useCourier`, with the Vue composable on the client. It covers a basic upload first, then adds chunking as a separate advanced route.

## Client setup

Point `useCourier` at the server route from any component:

```vue
<script setup lang="ts">
import { useCourier } from "use-courier/vue";

const { files, addFile } = useCourier({
  url: "/api/upload",
});

function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  Array.from(input.files ?? []).forEach((file) => addFile(file));
}
</script>

<template>
  <input type="file" multiple @change="handleFileChange" />
  <p v-for="item in files" :key="item.id">
    {{ item.file.name }}: {{ item.status }} ({{ item.uploadProgress }}%)
  </p>
</template>
```

`useCourier` sends each file in the `file` field of a `multipart/form-data` request.

## Server route

Create `server/api/upload.post.ts` in a Nuxt application. The `.post` suffix makes it a `POST /api/upload` endpoint; `defineEventHandler`, `readMultipartFormData`, and `setResponseStatus` are auto-imported in Nuxt server routes.

```ts
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const UPLOAD_DIR = path.resolve("./uploads");

function safeFileName(fileName: string) {
  return path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, "_");
}

export default defineEventHandler(async (event) => {
  try {
    const parts = (await readMultipartFormData(event)) ?? [];
    const files = parts.filter((part) => part.name === "file" && part.filename);

    if (files.length === 0) {
      setResponseStatus(event, 400);
      return { error: "At least one file is required" };
    }

    await mkdir(UPLOAD_DIR, { recursive: true });

    const savedFiles = [];
    for (const file of files) {
      const name = safeFileName(file.filename!);
      const storedName = `${randomUUID()}-${name}`;

      await writeFile(path.join(UPLOAD_DIR, storedName), file.data);
      savedFiles.push({
        name,
        size: file.data.byteLength,
        type: file.type ?? "",
      });
    }

    return {
      count: savedFiles.length,
      files: savedFiles,
    };
  } catch (error) {
    console.error(error);
    setResponseStatus(event, 500);
    return { error: "Error processing files" };
  }
});
```

The route returns the metadata shape expected by `useCourier`:

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

- Defines a `POST /api/upload` server route.
- Reads the request body with `readMultipartFormData`, which returns each form field with its `name`, `filename`, `type`, and `data`.
- Supports one or more files under the `file` field.
- Returns `400` when no file is provided.
- Stores files in a local `uploads` directory.
- Returns `500` when request processing fails.

## Deployment notes

`readMultipartFormData` reads the whole request into memory before your handler runs, so large files are a good reason to use the chunked route below, which keeps each request to one chunk.

Local filesystem storage is suitable for local development or a self-hosted Node server, but it is not persistent on most serverless platforms Nuxt can deploy to. For those, replace the filesystem calls with durable object storage such as S3 or Cloudflare R2; Nitro's `useStorage()` can target these through its storage drivers. Add authentication, authorization, file-type validation, and upload-size limits before using this route in production.

## Chunked uploads

Once the basic upload works, configure a separate route for files larger than your chosen threshold:

```ts
const { addFile } = useCourier({
  url: "/api/upload",
  fileChunking: {
    route: "/api/upload/chunk",
    threshold: 100 * 1024 * 1024,
    chunkSize: 10 * 1024 * 1024,
    maxChunkRetries: 2,
  },
});
```

Create `server/api/upload/chunk.post.ts`:

```ts
import {
  access,
  appendFile,
  mkdir,
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

export default defineEventHandler(async (event) => {
  try {
    const parts = (await readMultipartFormData(event)) ?? [];
    const field = (name: string) => parts.find((part) => part.name === name);
    const text = (name: string) => field(name)?.data.toString("utf8");

    const chunk = field("file");
    const uploadId = text("uploadId");
    const chunkIndex = text("chunkIndex");
    const totalChunks = text("totalChunks");

    if (!chunk?.filename || !uploadId || !chunkIndex || !totalChunks) {
      setResponseStatus(event, 400);
      return { error: "Malformed chunk upload request" };
    }

    if (!UUID_REGEX.test(uploadId)) {
      setResponseStatus(event, 400);
      return { error: "Invalid uploadId" };
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
      setResponseStatus(event, 400);
      return { error: "Invalid chunkIndex/totalChunks" };
    }

    const name = safeFileName(chunk.filename);
    const type = chunk.type ?? "";
    const finalPath = path.join(UPLOAD_DIR, `${uploadId}-${name}`);
    await mkdir(CHUNK_DIR, { recursive: true });

    // A retry after a lost final response can reuse the completed upload.
    try {
      const completedFile = await readFile(finalPath);
      return {
        count: 1,
        files: [{ name, size: completedFile.byteLength, type }],
      };
    } catch {
      // The upload has not been completed yet.
    }

    const chunkPath = path.join(CHUNK_DIR, `${uploadId}-${index}.part`);
    await writeFile(chunkPath, chunk.data);

    if (index !== total - 1) {
      return { chunkIndex: index, received: true };
    }

    const chunkPaths = Array.from({ length: total }, (_, chunkNumber) =>
      path.join(CHUNK_DIR, `${uploadId}-${chunkNumber}.part`),
    );

    try {
      await Promise.all(chunkPaths.map((filePath) => access(filePath)));
    } catch {
      setResponseStatus(event, 409);
      return { error: "Not all chunks have been received" };
    }

    await mkdir(UPLOAD_DIR, { recursive: true });
    await writeFile(finalPath, Buffer.alloc(0));

    for (const filePath of chunkPaths) {
      await appendFile(finalPath, await readFile(filePath));
      await unlink(filePath);
    }

    const file = await readFile(finalPath);
    return {
      count: 1,
      files: [{ name, size: file.byteLength, type }],
    };
  } catch (error) {
    console.error(error);
    setResponseStatus(event, 500);
    return { error: "Error processing chunk" };
  }
});
```

The route stores each chunk by `uploadId` and `chunkIndex`, so retrying a chunk replaces its previous copy instead of duplicating bytes. The client sends chunks sequentially, and the server reassembles them in index order when the final chunk arrives.

This example uses local filesystem storage. For a serverless deployment, replace the filesystem operations with durable object storage and add cleanup for abandoned chunks.

See [Large File Uploads](/large-files) for the full chunking flow.

See [Backend Integration](/backend-integration) for the shared upload contract.
