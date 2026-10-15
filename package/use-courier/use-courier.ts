import React from "react";
import { createCourier } from "./create-courier.js";
import { getOverallUploadState } from "./overall.js";
import type { OverallUploadState, UseCourierProps } from "./types.js";
import { useLatest } from "./use-latest.js";

/**
 * Generic file-upload hook: tracks files, uploads them via XHR (for progress
 * events), and exposes lifecycle callbacks so consumers can layer their own
 * validation/side effects on top without forking the hook.
 *
 * #34: a thin React adapter over createCourier (create-courier.ts), which
 * holds all of the upload logic. This file only connects it to React:
 * re-rendering when files change, supplying the latest props, and
 * cancelling uploads on unmount.
 */
export function useCourier<TUploadResponse>(
  props: UseCourierProps<TUploadResponse>,
) {
  /**
   * #29: the courier reads every option and callback through this, never
   * from a render's props, because an upload outlives the render it came
   * from.
   */
  const optionsRef = useLatest(props);

  // One courier per component instance, kept for its lifetime. createCourier
  // only stores the getter; it reads optionsRef later, during uploads, never
  // during render — which this rule can't see from here.
  // eslint-disable-next-line react-hooks/refs
  const [courier] = React.useState(() =>
    createCourier<TUploadResponse>(() => optionsRef.current),
  );

  const files = React.useSyncExternalStore(
    courier.subscribe,
    courier.getFiles,
    courier.getFiles,
  );

  // Cancel any uploads still in progress when the consumer unmounts.
  React.useEffect(() => courier.abortAll, [courier]);

  const overall: OverallUploadState = React.useMemo(
    () => getOverallUploadState(files),
    [files],
  );

  return {
    files,
    addFile: courier.addFile,
    retryUpload: courier.retryUpload,
    removeFile: courier.removeFile,
    overall,
  };
}
