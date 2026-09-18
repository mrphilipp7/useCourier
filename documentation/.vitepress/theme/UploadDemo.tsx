import { useEffect, useRef, useState } from "react";
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
import { useCourier } from "../../../package/use-courier/index.js";

/**
 * GitHub Pages is static, so there's no real endpoint for this demo to
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
              this.responseText = JSON.stringify({ ok: true, fileName });
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

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UploadDemo() {
  const [simulateFailure, setSimulateFailure] = useState(false);
  const simulateFailureRef = useRef(simulateFailure);
  simulateFailureRef.current = simulateFailure;

  useEffect(() => {
    const original = globalThis.XMLHttpRequest;
    globalThis.XMLHttpRequest = createDemoXHR(
      () => simulateFailureRef.current,
    ) as unknown as typeof XMLHttpRequest;
    return () => {
      globalThis.XMLHttpRequest = original;
    };
  }, []);

  const { files, addFile, retryUpload, removeFile } = useCourier<{
    ok: boolean;
    fileName: string;
  }>({
    url: "/demo/uploads",
  });

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    Array.from(event.target.files ?? []).forEach((file) => addFile(file));
    event.target.value = "";
  }

  return (
    <div className="courier-demo not-prose rounded-xl border bg-card p-4">
      <p className="mb-3 text-sm text-muted-foreground">
        This is the actual <code>useCourier</code> hook, rendering Shadcn's{" "}
        <a
          href="https://ui.shadcn.com/docs/components/base/attachment"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          <code>Attachment</code>
        </a>{" "}
        component, against a simulated upload (no files leave your browser) so
        you can see progress, retry, and cancellation in action.
      </p>

      <label className="mb-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={simulateFailure}
          onChange={(event) => setSimulateFailure(event.target.checked)}
        />
        Simulate a failed upload (then click Retry)
      </label>

      <input
        type="file"
        multiple
        onChange={handleFileChange}
        className="text-sm"
      />

      {files.length > 0 && (
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
                    onClick={() => void retryUpload(item.id)}
                  >
                    <RefreshCwIcon />
                  </AttachmentAction>
                )}
                <AttachmentAction
                  aria-label={`Remove ${item.file.name}`}
                  onClick={() => removeFile(item.id)}
                >
                  <XIcon />
                </AttachmentAction>
              </AttachmentActions>
            </Attachment>
          ))}
        </AttachmentGroup>
      )}
    </div>
  );
}
