import { useRef, useState } from "react";
import { DemoFileList, useDemoXHR } from "./demo-shared";
import { useCourier } from "../../../package/use-courier/index.js";

export function UploadDemo() {
  const [simulateFailure, setSimulateFailure] = useState(false);
  const simulateFailureRef = useRef(simulateFailure);
  simulateFailureRef.current = simulateFailure;

  useDemoXHR(() => simulateFailureRef.current);

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

      <DemoFileList
        files={files}
        onRetry={(id) => void retryUpload(id)}
        onRemove={removeFile}
      />
    </div>
  );
}
