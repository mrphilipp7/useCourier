# Express

This example uses Express and Multer to handle the `multipart/form-data` requests sent by `useCourier`.

## Install dependencies

```bash
npm install express multer
npm install --save-dev @types/express @types/multer tsx typescript
```

This example uses a Node Express server. Multer parses the multipart request, while Node's filesystem APIs save the files.

## Basic file uploads

Start with a standard upload endpoint. It accepts one or more files under the `file` field.

### Client setup

```tsx
import { useCourier } from "use-courier";

const { addFile } = useCourier({
  url: "/upload",
});
```

### Server

Create `server.ts`:

```ts
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import multer from "multer";

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

const UPLOAD_DIR = path.resolve("./uploads");

function safeFileName(fileName: string) {
  return path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, "_");
}

app.post("/upload", upload.array("file"), async (req, res) => {
  const files = (req.files ?? []) as Express.Multer.File[];

  if (files.length === 0) {
    return res.status(400).json({ error: "At least one file is required" });
  }

  await fs.mkdir(UPLOAD_DIR, { recursive: true });

  const savedFiles = [];
  for (const file of files) {
    const name = safeFileName(file.originalname);
    const storedName = `${crypto.randomUUID()}-${name}`;
    await fs.writeFile(path.join(UPLOAD_DIR, storedName), file.buffer);
    savedFiles.push({
      name,
      size: file.size,
      type: file.mimetype,
    });
  }

  return res.json({ count: savedFiles.length, files: savedFiles });
});

app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: error.message });
  }
  return next(error);
});

app.listen(3000, () => {
  console.log("Upload server listening at http://localhost:3000");
});
```

Run the server with:

```bash
npx tsx server.ts
```

The standard route returns the response shape expected by `useCourier`:

```json
{
  "count": 1,
  "files": [
    { "name": "document.pdf", "size": 12345, "type": "application/pdf" }
  ]
}
```

## Chunked uploads

Once the basic upload works, add chunking for large files. Configure a separate route in the client:

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

Add this route to the same Express server before the error-handling middleware. It stores each chunk by index, so a retry replaces the previous copy instead of duplicating bytes:

```ts
import path from "node:path";

const CHUNK_DIR = path.resolve("./tmp/upload-chunks");
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

app.post("/upload/chunk", upload.single("file"), async (req, res) => {
  const chunk = req.file;
  const { uploadId, chunkIndex, totalChunks } = req.body;

  if (
    !chunk ||
    typeof uploadId !== "string" ||
    typeof chunkIndex !== "string" ||
    typeof totalChunks !== "string"
  ) {
    return res.status(400).json({ error: "Malformed chunk upload request" });
  }

  if (!UUID_REGEX.test(uploadId)) {
    return res.status(400).json({ error: "Invalid uploadId" });
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
    return res.status(400).json({ error: "Invalid chunkIndex/totalChunks" });
  }

  await fs.mkdir(CHUNK_DIR, { recursive: true });
  const chunkPath = path.join(CHUNK_DIR, `${uploadId}-${index}.part`);
  await fs.writeFile(chunkPath, chunk.buffer);

  if (index !== total - 1) {
    return res.json({ chunkIndex: index, received: true });
  }

  const chunkPaths = Array.from({ length: total }, (_, chunkNumber) =>
    path.join(CHUNK_DIR, `${uploadId}-${chunkNumber}.part`),
  );

  try {
    await Promise.all(chunkPaths.map((filePath) => fs.access(filePath)));
  } catch {
    return res.status(409).json({ error: "Not all chunks have been received" });
  }

  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const name = safeFileName(chunk.originalname);
  const finalPath = path.join(UPLOAD_DIR, `${uploadId}-${name}`);
  await fs.writeFile(finalPath, Buffer.alloc(0));

  for (const filePath of chunkPaths) {
    await fs.appendFile(finalPath, await fs.readFile(filePath));
    await fs.unlink(filePath);
  }

  const stats = await fs.stat(finalPath);
  return res.json({
    count: 1,
    files: [{ name, size: stats.size, type: chunk.mimetype }],
  });
});
```

This route expects the existing `app`, `upload`, and Express server from the basic example. For a complete production implementation, add cleanup for abandoned chunks, authentication, authorization, file validation, and deployment-specific request limits.

See [Large File Uploads](/large-files) for the full chunking flow.

## Notes

- This example writes to local disk. Use object storage or another durable storage system for production deployments.
- The client sends chunks sequentially, but the server reassembles them by index.
- See [Backend Integration](/backend-integration) for the shared request contract.
