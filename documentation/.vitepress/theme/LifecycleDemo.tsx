import { useRef, useState } from "react";
import { toast } from "sonner";
import { Toaster } from "./components/ui/sonner";
import { DemoFileList, useDemoXHR } from "./demo-shared";
import { useCourier } from "../../../package/use-courier/index.js";

/**
 * Same simulated upload as UploadDemo, with every lifecycle callback wired
 * to a toast so readers can watch the order they fire in. Each toast's
 * title is the callback's name and its description says, in plain words,
 * when that callback runs.
 */
export function LifecycleDemo() {
  const [simulateFailure, setSimulateFailure] = useState(false);
  const [rejectInBeforeUpload, setRejectInBeforeUpload] = useState(false);
  // The callbacks below read these through refs rather than state, so they
  // always see the latest checkbox value no matter which render they were
  // created in.
  const simulateFailureRef = useRef(simulateFailure);
  simulateFailureRef.current = simulateFailure;
  const rejectRef = useRef(rejectInBeforeUpload);
  rejectRef.current = rejectInBeforeUpload;

  useDemoXHR(() => simulateFailureRef.current);

  const { files, addFile, retryUpload, removeFile } = useCourier<{
    ok: boolean;
    fileName: string;
  }>({
    url: "/demo/uploads",
    beforeUpload: ({ item }) => {
      toast("beforeUpload", {
        description: `I ran before the upload of ${item.file.name}`,
      });
      if (rejectRef.current) {
        throw new Error("Rejected by beforeUpload");
      }
    },
    onUploadSuccess: ({ item }) => {
      toast.success("onUploadSuccess", {
        description: `I ran because ${item.file.name} uploaded successfully`,
      });
    },
    onUploadError: ({ item, error }) => {
      toast.error("onUploadError", {
        description: `I ran because ${item.file.name} failed: ${error.message}`,
      });
    },
    onUploadFinish: ({ item }) => {
      toast("onUploadFinish", {
        description: `I ran after the upload of ${item.file.name}, success or failure`,
      });
    },
    onUploadRetry: ({ item }) => {
      toast.info("onUploadRetry", {
        description: `I ran before retrying ${item.file.name}`,
      });
    },
    onRemoveFile: ({ item }) => {
      toast("onRemoveFile", {
        description: `I ran because ${item.file.name} was removed`,
      });
    },
  });

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    Array.from(event.target.files ?? []).forEach((file) => addFile(file));
    event.target.value = "";
  }

  return (
    <div className="courier-demo not-prose rounded-xl border bg-card p-4">
      <p className="mb-3 text-sm text-muted-foreground">
        The code above, running for real against a simulated upload (no files
        leave your browser). Each lifecycle callback shows a{" "}
        <a
          href="https://ui.shadcn.com/docs/components/radix/sonner"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          Shadcn Sonner
        </a>{" "}
        toast when it runs, so you can see the order they fire in.
      </p>

      <label className="mb-2 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={simulateFailure}
          onChange={(event) => setSimulateFailure(event.target.checked)}
        />
        Simulate a failed upload (then click Retry)
      </label>

      <label className="mb-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={rejectInBeforeUpload}
          onChange={(event) => setRejectInBeforeUpload(event.target.checked)}
        />
        Reject the file in <code>beforeUpload</code>
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

      {/* One upload fires 3-4 callbacks over a couple of seconds, so show
          every toast expanded and keep them up long enough to read the
          whole sequence instead of Sonner's default stack of 3. */}
      <Toaster
        position="bottom-right"
        expand
        visibleToasts={6}
        duration={8000}
      />
    </div>
  );
}
