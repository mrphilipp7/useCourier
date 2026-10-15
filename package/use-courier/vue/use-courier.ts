import {
  computed,
  getCurrentScope,
  onScopeDispose,
  shallowRef,
  toValue,
  type ComputedRef,
  type MaybeRefOrGetter,
  type ShallowRef,
} from "vue";
import { createCourier } from "../create-courier.js";
import { getOverallUploadState } from "../overall.js";
import type {
  CourierOptions,
  OverallUploadState,
  UploadItem,
  UploadResult,
} from "../types.js";

export type UseCourierReturn<TUploadResponse> = {
  /** Every tracked file. Replaced (not mutated) on each change. */
  files: Readonly<ShallowRef<UploadItem[]>>;
  /** Aggregate status/progress across every tracked file. */
  overall: ComputedRef<OverallUploadState>;
  addFile: (file: File) => Promise<UploadResult<TUploadResponse>>;
  retryUpload: (id: string) => Promise<UploadResult<TUploadResponse>>;
  removeFile: (id: string) => void;
};

/**
 * #35: the Vue 3 composable — a thin adapter over the same createCourier
 * core the React hook uses, so behavior is identical.
 *
 * options can be a plain object, a ref, or a getter. It's resolved with
 * toValue() every time the core reads an option, so an upload always sees
 * the latest url, headers, and callbacks. It's the whole object that can be
 * reactive, not each field: several options are themselves functions
 * (headers, formFields, every callback), and toValue() on a field would
 * call them as if they were getters.
 *
 * Called inside a component's setup (or any effect scope), uploads still in
 * progress are cancelled when that scope is disposed — e.g. the component
 * unmounts. Outside a scope, nothing is cancelled automatically.
 */
export function useCourier<TUploadResponse = unknown>(
  options: MaybeRefOrGetter<CourierOptions<TUploadResponse>>,
): UseCourierReturn<TUploadResponse> {
  const courier = createCourier<TUploadResponse>(() => toValue(options));

  // shallowRef: the core replaces the array (and each changed item) rather
  // than mutating it, so a reference change is all Vue needs to see — and a
  // deep ref would wrap every File in a proxy.
  const files = shallowRef(courier.getFiles());
  const unsubscribe = courier.subscribe(() => {
    files.value = courier.getFiles();
  });

  const overall = computed(() => getOverallUploadState(files.value));

  if (getCurrentScope()) {
    onScopeDispose(() => {
      unsubscribe();
      courier.abortAll();
    });
  }

  return {
    files,
    overall,
    addFile: courier.addFile,
    retryUpload: courier.retryUpload,
    removeFile: courier.removeFile,
  };
}
