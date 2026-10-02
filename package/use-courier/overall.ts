import type { OverallUploadState, UploadItem } from "./types.js";

/**
 * Worst-status-wins across every tracked file. Doesn't special-case
 * "processing" vs "uploading" beyond ordering them below "error" — either
 * one means "still going," which is all that matters at this level.
 */
function getOverallStatus(items: UploadItem[]): UploadItem["status"] {
  if (items.length === 0) return "idle";
  if (items.some((item) => item.status === "error")) return "error";
  if (items.some((item) => item.status === "uploading")) return "uploading";
  if (items.some((item) => item.status === "processing")) return "processing";
  return "done";
}

/** Aggregate status/progress across every tracked file. */
export function getOverallUploadState(files: UploadItem[]): OverallUploadState {
  if (files.length === 0) {
    return { status: "idle", averageProgress: 0, weightedProgress: 0 };
  }

  // An errored file's frozen uploadProgress still counts here on purpose —
  // see the OverallUploadState doc comment in types.ts.
  const averageProgress = Math.round(
    files.reduce((sum, file) => sum + file.uploadProgress, 0) / files.length,
  );

  // Approximates bytes sent per file from its (already-rounded)
  // uploadProgress, since that's the only per-file number the hook
  // tracks — precise enough for an aggregate, at the same precision the
  // rest of the hook already uses.
  const totalBytes = files.reduce((sum, file) => sum + file.file.size, 0);
  const bytesSent = files.reduce(
    (sum, file) => sum + file.file.size * (file.uploadProgress / 100),
    0,
  );
  const weightedProgress =
    totalBytes === 0 ? 0 : Math.round((bytesSent / totalBytes) * 100);

  return {
    status: getOverallStatus(files),
    averageProgress,
    weightedProgress,
  };
}
