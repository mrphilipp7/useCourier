# Recipes

Copy-paste solutions for common upload needs. Each recipe is a complete component built on the [basic usage](/get-started#basic-usage) example, so you can drop it into a project and adapt it.

## Upload to an authenticated API

Send a token with every request using `headers`. Passing a function means it's called for each request, so a long chunked upload keeps sending a fresh token instead of failing when the first one expires:

```tsx
import { useCourier, XhrResponseError } from "use-courier";
import { getAccessToken } from "./auth"; // your auth library's token getter

export function AuthenticatedUpload() {
  const { files, addFile } = useCourier({
    url: "https://api.example.com/uploads",
    headers: async () => ({
      Authorization: `Bearer ${await getAccessToken()}`,
    }),
    onUploadError: ({ error }) => {
      if (error instanceof XhrResponseError && error.status === 401) {
        window.location.assign("/login");
      }
    },
  });

  return (
    <>
      <input
        type="file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) addFile(file);
        }}
      />
      {files.map((item) => (
        <p key={item.id}>
          {item.file.name}: {item.status} ({item.uploadProgress}%)
        </p>
      ))}
    </>
  );
}
```

For a cookie-based session on another origin, use `withCredentials: true` instead of `headers`. Either way, a server on a different origin has to allow it with CORS; see [Authentication](/backend-integration#authentication). This recipe needs version 0.7.0 or later.

## Validate file size and type

Throw from `beforeUpload` to reject a file before any request is made. The rejection comes back as the result of `addFile`, so you can show the reason:

```tsx
import { useState } from "react";
import { useCourier } from "use-courier";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = ["image/png", "image/jpeg", "application/pdf"];

export function ValidatedUpload() {
  const [message, setMessage] = useState("");
  const { files, addFile } = useCourier({
    url: "/api/uploads",
    beforeUpload: ({ item }) => {
      if (!ALLOWED_TYPES.includes(item.file.type)) {
        throw new Error("Only PNG, JPEG, and PDF files are allowed.");
      }
      if (item.file.size > MAX_BYTES) {
        throw new Error("Files must be 10 MB or smaller.");
      }
    },
  });

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const result = await addFile(file);
    setMessage(result.success ? "" : result.error.message);
  }

  return (
    <>
      <input
        type="file"
        accept={ALLOWED_TYPES.join(",")}
        onChange={handleFileChange}
      />
      {message && <p role="alert">{message}</p>}
      {files.map((item) => (
        <p key={item.id}>
          {item.file.name}: {item.status}
        </p>
      ))}
    </>
  );
}
```

The `accept` attribute only filters the file picker. Users can still drag files in or choose "All files", so `beforeUpload` is what actually enforces the rule. It also runs again on every `retryUpload`, so a rejected file can't be uploaded by retrying it.

## Drag-and-drop upload area

Call `addFile` for each dropped file. `preventDefault` in `onDragOver` is what tells the browser the area accepts drops:

```tsx
import { useState } from "react";
import { useCourier } from "use-courier";

export function DropZone() {
  const [isDragging, setIsDragging] = useState(false);
  const { files, addFile } = useCourier({ url: "/api/uploads" });

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    Array.from(event.dataTransfer.files).forEach((file) => addFile(file));
  }

  return (
    <>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        style={{
          padding: 32,
          border: "2px dashed",
          borderColor: isDragging ? "royalblue" : "gray",
          textAlign: "center",
        }}
      >
        {isDragging ? "Drop to upload" : "Drag files here"}
      </div>
      {files.map((item) => (
        <p key={item.id}>
          {item.file.name}: {item.status} ({item.uploadProgress}%)
        </p>
      ))}
    </>
  );
}
```

## Image previews

Show a thumbnail as soon as a file is added, before it finishes uploading. `URL.createObjectURL` makes a temporary URL for the local file; revoke it when the preview goes away so the browser can free the memory:

```tsx
import { useEffect, useState } from "react";
import { useCourier } from "use-courier";

function ImagePreview({ file }: { file: File }) {
  const [src, setSrc] = useState<string>();

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  if (!src) return null;
  return (
    <img
      src={src}
      alt={file.name}
      width={64}
      height={64}
      style={{ objectFit: "cover" }}
    />
  );
}

export function ImageUpload() {
  const { files, addFile } = useCourier({ url: "/api/uploads" });

  return (
    <>
      <input
        type="file"
        accept="image/*"
        multiple
        onChange={(event) =>
          Array.from(event.target.files ?? []).forEach((file) => addFile(file))
        }
      />
      {files.map((item) => (
        <div key={item.id} style={{ display: "flex", gap: 8 }}>
          {item.file.type.startsWith("image/") && (
            <ImagePreview file={item.file} />
          )}
          <span>
            {item.file.name}: {item.uploadProgress}%
          </span>
        </div>
      ))}
    </>
  );
}
```

## Retry automatically with backoff

Call `retryUpload` from `onUploadError`, waiting longer after each failure: 1 second, then 2, then 4. Only network errors and server errors (`5xx`) are retried; a cancellation, a `beforeUpload` rejection, or a client error like `401` is left alone:

```tsx
import { useEffect, useRef } from "react";
import { useCourier, XhrRequestError, XhrResponseError } from "use-courier";

const MAX_RETRIES = 3;

export function AutoRetryUpload() {
  const attempts = useRef(new Map<string, number>());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  // Don't start a retry after the component is gone.
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const courier = useCourier({
    url: "/api/uploads",
    onUploadError: ({ item, error }) => {
      const retryable =
        error instanceof XhrRequestError ||
        (error instanceof XhrResponseError && error.status >= 500);
      const attempt = attempts.current.get(item.id) ?? 0;
      if (!retryable || attempt >= MAX_RETRIES) return;

      attempts.current.set(item.id, attempt + 1);
      const timer = setTimeout(
        () => {
          timers.current.delete(timer);
          void courier.retryUpload(item.id);
        },
        1000 * 2 ** attempt,
      );
      timers.current.add(timer);
    },
    onUploadSuccess: ({ item }) => attempts.current.delete(item.id),
    onRemoveFile: ({ item }) => attempts.current.delete(item.id),
  });

  return (
    <>
      <input
        type="file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) courier.addFile(file);
        }}
      />
      {courier.files.map((item) => (
        <p key={item.id}>
          {item.file.name}: {item.status}
        </p>
      ))}
    </>
  );
}
```

Client errors like `401 Unauthorized` or `413 Payload Too Large` aren't retried, since they'd fail the same way again. For chunked uploads, each chunk is already retried on its own (`fileChunking.maxChunkRetries`) before the upload fails, and `retryUpload` resumes from the failed chunk. This recipe needs version 0.7.0 or later.

## Disable submit until uploads finish

Use `overall` to keep a form's submit button disabled until every file is done, and collect each server response in `onUploadSuccess`:

```tsx
import { useState } from "react";
import { useCourier } from "use-courier";

type UploadResponse = { url: string };

export function UploadForm() {
  const [urls, setUrls] = useState(() => new Map<string, string>());
  const { files, addFile, overall } = useCourier<UploadResponse>({
    url: "/api/uploads",
    onUploadSuccess: ({ item, data }) => {
      setUrls((prev) => new Map(prev).set(item.id, data.url));
    },
  });

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    Array.from(event.target.files ?? []).forEach((file) => addFile(file));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const attachments = files.flatMap((item) => urls.get(item.id) ?? []);
    console.log("Submitting with", attachments);
  }

  const busy =
    overall.status === "uploading" || overall.status === "processing";

  return (
    <form onSubmit={handleSubmit}>
      <input type="file" multiple onChange={handleFileChange} />
      {files.map((item) => (
        <p key={item.id}>
          {item.file.name}: {item.status}
        </p>
      ))}
      <button type="submit" disabled={overall.status !== "done"}>
        {busy ? `Uploading… ${overall.weightedProgress}%` : "Submit"}
      </button>
      {overall.status === "error" && (
        <p role="alert">Remove or retry the failed files to continue.</p>
      )}
    </form>
  );
}
```

`overall.status` is only `"done"` when every tracked file is done, so the button stays disabled while anything is uploading or has failed. `weightedProgress` weights each file by its size, so one large file doesn't make the bar jump. Reading `data` in `onUploadSuccess` needs version 0.7.0 or later; on older versions, use the result `addFile` resolves with.

## Warn before leaving mid-upload

Closing or reloading the page cancels every upload in progress. Ask the browser to confirm first while any file is still sending:

```tsx
import { useEffect } from "react";
import { useCourier } from "use-courier";

export function UploadWithLeaveWarning() {
  const { files, addFile } = useCourier({ url: "/api/uploads" });
  const isUploading = files.some(
    (item) => item.status === "uploading" || item.status === "processing",
  );

  useEffect(() => {
    if (!isUploading) return;

    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = ""; // older browsers need this as well
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isUploading]);

  return (
    <>
      <input
        type="file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) addFile(file);
        }}
      />
      {files.map((item) => (
        <p key={item.id}>
          {item.file.name}: {item.status} ({item.uploadProgress}%)
        </p>
      ))}
    </>
  );
}
```

This checks the files directly rather than `overall.status`, because `overall.status` reports `"error"` as soon as any file fails, even while others are still uploading. Browsers show their own generic message; the text can't be customized. Navigating within a single-page app doesn't trigger `beforeunload`, but unmounting the component still cancels its uploads, so use your router's navigation guard for that case.
