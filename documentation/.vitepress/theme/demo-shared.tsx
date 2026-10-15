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
import { installDemoXHR } from "./demo-xhr";

/** Swaps the fake XHR onto globalThis for as long as the demo is mounted. */
export function useDemoXHR(shouldFail: () => boolean) {
  useEffect(
    () => installDemoXHR(shouldFail),
    // shouldFail is expected to read a ref, so installing once is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
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
