# Next.js

This example uses a Next.js App Router Route Handler to receive the `multipart/form-data` requests sent by `useCourier`. It covers a basic upload first, then adds chunking as a separate advanced route.

## Client setup

Point `useCourier` at the Route Handler:

```tsx
import { useCourier } from "use-courier";

const { addFile } = useCourier({
  url: "/api/upload",
});
```

The hook sends each file in the `file` field of a `multipart/form-data` request.

## Route Handler

Create `app/api/upload/route.ts` in a Next.js application:

```ts
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const UPLOAD_DIR = path.resolve("./uploads");

function safeFileName(fileName: string) {
  return path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files = formData
      .getAll("file")
      .filter((value): value is File => value instanceof File);

    if (files.length === 0) {
      return NextResponse.json(
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

    return NextResponse.json({
      count: savedFiles.length,
      files: savedFiles,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Error processing files" },
      { status: 500 },
    );
  }
}
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

- Defines a `POST /api/upload` App Router Route Handler.
- Reads the request body with `request.formData()`.
- Supports one or more files under the `file` field.
- Returns `400` when no file is provided.
- Stores files in a local `uploads` directory.
- Returns `500` when request processing fails.

## Deployment notes

This example uses `node:fs` and explicitly selects the Node.js runtime. Local filesystem storage is suitable for local development or a self-hosted Node server, but it is not persistent on most serverless platforms.

For deployments such as Vercel, replace the filesystem calls with durable object storage such as Vercel Blob, S3, or Cloudflare R2. Add authentication, authorization, file-type validation, and upload-size limits before using this route in production.

## Chunked uploads

Once the basic upload works, configure a separate route for files larger than your chosen threshold:

```tsx
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

Create `app/api/upload/chunk/route.ts`:

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
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const CHUNK_DIR = path.resolve("./tmp/upload-chunks");
const UPLOAD_DIR = path.resolve("./uploads");
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeFileName(fileName: string) {
  return path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function POST(request: Request) {
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
      return NextResponse.json(
        { error: "Malformed chunk upload request" },
        { status: 400 },
      );
    }

    if (!UUID_REGEX.test(uploadId)) {
      return NextResponse.json({ error: "Invalid uploadId" }, { status: 400 });
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
      return NextResponse.json(
        { error: "Invalid chunkIndex/totalChunks" },
        { status: 400 },
      );
    }

    const name = safeFileName(chunk.name);
    const finalPath = path.join(UPLOAD_DIR, `${uploadId}-${name}`);
    await mkdir(CHUNK_DIR, { recursive: true });

    // A retry after a lost final response can reuse the completed upload.
    try {
      const completedFile = await readFile(finalPath);
      return NextResponse.json({
        count: 1,
        files: [{ name, size: completedFile.byteLength, type: chunk.type }],
      });
    } catch {
      // The upload has not been completed yet.
    }

    const chunkPath = path.join(CHUNK_DIR, `${uploadId}-${index}.part`);
    await writeFile(chunkPath, Buffer.from(await chunk.arrayBuffer()));

    if (index !== total - 1) {
      return NextResponse.json({ chunkIndex: index, received: true });
    }

    const chunkPaths = Array.from({ length: total }, (_, chunkNumber) =>
      path.join(CHUNK_DIR, `${uploadId}-${chunkNumber}.part`),
    );

    try {
      await Promise.all(chunkPaths.map((filePath) => access(filePath)));
    } catch {
      return NextResponse.json(
        { error: "Not all chunks have been received" },
        { status: 409 },
      );
    }

    await mkdir(UPLOAD_DIR, { recursive: true });
    await writeFile(finalPath, Buffer.alloc(0));

    for (const filePath of chunkPaths) {
      await appendFile(finalPath, await readFile(filePath));
      await unlink(filePath);
    }

    const file = await readFile(finalPath);
    return NextResponse.json({
      count: 1,
      files: [{ name, size: file.byteLength, type: chunk.type }],
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Error processing chunk" },
      { status: 500 },
    );
  }
}
```

The route stores each chunk by `uploadId` and `chunkIndex`, so retrying a chunk replaces its previous copy instead of duplicating bytes. The client sends chunks sequentially, and the server reassembles them in index order when the final chunk arrives.

This example uses local filesystem storage and the Node.js runtime. For Vercel or another serverless deployment, replace the filesystem operations with durable object storage and add cleanup for abandoned chunks.

See [Large File Uploads](/large-files) for the full chunking flow.

See [Backend Integration](/backend-integration) for the shared upload contract.
