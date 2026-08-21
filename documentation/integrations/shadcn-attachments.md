# Shadcn Attachments

`useCourier` is headless, so it can provide upload behavior for a Shadcn attachment interface without taking a dependency on Shadcn or dictating how attachments look.

This integration separates responsibilities:

- `useCourier` manages uploads, progress, status, retries, and cancellation.
- Your attachment component manages previews, layout, buttons, and styling.

## Connect the upload state

The core wiring uses the values returned by `useCourier`:

```tsx
const { files, addFile, retryUpload, removeFile } = useCourier({
  url: "/api/uploads",
});
```

Connect the attachment component's file-selection event to `addFile`:

```tsx
function handleFilesSelected(selectedFiles: File[]) {
  selectedFiles.forEach((file) => {
    void addFile(file);
  });
}
```

Render each attachment from the corresponding `UploadItem`:

| Attachment UI           | `useCourier` value     |
| ----------------------- | ---------------------- |
| File name and preview   | `item.file`            |
| Progress indicator      | `item.uploadProgress`  |
| Upload state            | `item.status`          |
| Retry action            | `retryUpload(item.id)` |
| Remove or cancel action | `removeFile(item.id)`  |

## Display upload states

Use `item.status` to choose the appropriate attachment state:

```tsx
function getAttachmentState(status: UploadItem["status"]) {
  switch (status) {
    case "uploading":
      return "Uploading";
    case "processing":
      return "Processing";
    case "done":
      return "Uploaded";
    case "error":
      return "Upload failed";
    default:
      return "Ready";
  }
}
```

For an error state, show a retry action using the file's tracked ID. For an active upload, `removeFile` aborts the request before removing the attachment from the tracked list.

## Complete example

The following component connects `useCourier` to Shadcn's attachment components. The attachment components and `formatFileSize` helper belong to the consuming application.

```tsx
import React from "react";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import { Spinner } from "@/components/ui/spinner";
import { FileIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { useCourier } from "use-courier";
import { formatFileSize } from "@/lib/utils";

export function FileUpload() {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const { addFile, files, removeFile, retryUpload } = useCourier({
    url: "http://localhost:3000/upload",
    fileChunking: {
      route: "http://localhost:3000/upload/chunk",
      threshold: 100 * 1024 * 1024,
      chunkSize: 10 * 1024 * 1024,
    },
    onUploadError({ error }) {
      console.error(error.message);
    },
  });

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files ?? []);
    selectedFiles.forEach((file) => void addFile(file));
  }

  function handleRemove(id: string) {
    removeFile(id);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <main>
      <p>File Upload</p>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileChange}
      />

      <AttachmentGroup className="flex flex-col gap-4">
        {files.map((item) => (
          <Attachment
            key={item.id}
            state={item.status}
            className="w-full max-w-xs"
          >
            <AttachmentMedia>
              {item.status === "uploading" || item.status === "processing" ? (
                <Spinner />
              ) : (
                <FileIcon />
              )}
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>{item.file.name}</AttachmentTitle>
              <AttachmentDescription>
                {item.status === "uploading"
                  ? `Uploading - ${item.uploadProgress}%`
                  : `${item.file.type} - ${formatFileSize(item.file.size)}`}
              </AttachmentDescription>
            </AttachmentContent>
            <AttachmentActions>
              {item.status === "error" && (
                <AttachmentAction
                  aria-label="Retry upload"
                  onClick={() => void retryUpload(item.id)}
                >
                  <RefreshCwIcon />
                </AttachmentAction>
              )}
              <AttachmentAction
                aria-label={`Remove ${item.file.name}`}
                onClick={() => handleRemove(item.id)}
              >
                <XIcon />
              </AttachmentAction>
            </AttachmentActions>
          </Attachment>
        ))}
      </AttachmentGroup>
    </main>
  );
}
```

## Keep the integration optional

This recipe does not require Shadcn at the package level. You can use the same mapping with another attachment component or a custom upload interface. The important boundary is that the UI reads from `files` and sends user actions back through `addFile`, `retryUpload`, and `removeFile`.
