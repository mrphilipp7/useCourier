import { useEffect } from "react";
import { FileIcon, RefreshCwIcon, XIcon } from "lucide-react";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "./components/ui/attachment";
import { Spinner } from "./components/ui/spinner";
import type { UploadItem } from "../../../package/use-courier/index.js";

/**
 * GitHub Pages is static, so there's no real endpoint for the demos to
 * upload to. This fake XMLHttpRequest implements just the surface the hook
 * touches (open/send/abort, upload progress events, load/error events) and
 * drives it off timers instead of a network — same idea as
 * tests/mock-xhr.ts, but animated so it reads as a real upload in the
 * browser rather than a scripted test.
 */
function createDemoXHR(shouldFail: () => boolean) {
  return class DemoXMLHttpRequest extends EventTarget {
    upload = new EventTarget();
    status = 0;
    responseText = "";
    private timer: ReturnType<typeof setInterval> | null = null;

    open() {}

    setRequestHeader() {}

    send(formData?: FormData) {
      const file = formData?.get("file");
      const fileName = file instanceof File ? file.name : "file";
      let loaded = 0;

      this.timer = setInterval(() => {
        loaded = Math.min(100, loaded + 8 + Math.random() * 12);
        this.upload.dispatchEvent(
          Object.assign(new Event("progress"), {
            lengthComputable: true,
            loaded,
            total: 100,
          }),
        );

        if (loaded >= 100) {
          if (this.timer) clearInterval(this.timer);
          setTimeout(() => {
            if (shouldFail()) {
              this.status = 0;
              this.dispatchEvent(new Event("error"));
            } else {
              this.status = 200;
              this.responseText = JSON.stringify({
                ok: true,
                fileName,
                url: `https://files.example.com/${encodeURIComponent(fileName)}`,
              });
              this.dispatchEvent(new Event("load"));
            }
          }, 350);
        }
      }, 150);
    }

    abort() {
      if (this.timer) clearInterval(this.timer);
      this.dispatchEvent(new Event("abort"));
    }
  };
}

/** Swaps the fake XHR onto globalThis for as long as the demo is mounted. */
export function useDemoXHR(shouldFail: () => boolean) {
  useEffect(() => {
    const original = globalThis.XMLHttpRequest;
    globalThis.XMLHttpRequest = createDemoXHR(
      shouldFail,
    ) as unknown as typeof XMLHttpRequest;
    return () => {
      globalThis.XMLHttpRequest = original;
    };
    // shouldFail is expected to read a ref, so installing once is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The Attachment-based file list both demos render. */
export function DemoFileList({
  files,
  onRetry,
  onRemove,
}: {
  files: UploadItem[];
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  if (files.length === 0) return null;

  return (
    <AttachmentGroup className="mt-4 flex flex-col gap-3">
      {files.map((item) => (
        <Attachment key={item.id} state={item.status} className="w-full">
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
                ? `Uploading - ${Math.round(item.uploadProgress)}%`
                : item.status === "error"
                  ? "Upload failed"
                  : `${item.file.type || "file"} - ${formatFileSize(item.file.size)}`}
            </AttachmentDescription>
          </AttachmentContent>
          <AttachmentActions>
            {item.status === "error" && (
              <AttachmentAction
                aria-label="Retry upload"
                onClick={() => onRetry(item.id)}
              >
                <RefreshCwIcon />
              </AttachmentAction>
            )}
            <AttachmentAction
              aria-label={`Remove ${item.file.name}`}
              onClick={() => onRemove(item.id)}
            >
              <XIcon />
            </AttachmentAction>
          </AttachmentActions>
        </Attachment>
      ))}
    </AttachmentGroup>
  );
}
