/** A single file tracked by the hook, from selection through upload completion. */
export type UploadItem = {
  id: string;
  file: File;
  /** idle: not yet started · uploading: bytes in flight · processing: fully sent, awaiting server response · error/done: terminal states */
  status: "idle" | "uploading" | "processing" | "error" | "done";
  /** 0-100, updated from XHR upload progress events */
  uploadProgress: number;
};

export type FileChunking = {
  route: string;
  threshold: number;
  chunkSize?: number;
  /** Extra attempts for a single failed chunk before the upload fails. Defaults to 2. */
  maxChunkRetries?: number;
};

/** Outcome of an upload attempt, returned by addFile/retryUpload. */
export type UploadResult<TUploadResponse> =
  | { success: true; data: TUploadResponse }
  | { success: false; error: Error };

export type UseCourierProps = {
  url: string;
  /** Runs before the upload starts. Throw here to reject a file (e.g. failed validation) without aborting other files in the same batch. */
  beforeUpload?: ({ item }: { item: UploadItem }) => void;
  /** Runs on upload success. */
  onUploadSuccess?: ({ item }: { item: UploadItem }) => void;
  /** Runs on upload error. */
  onUploadError?: ({ item, error }: { item: UploadItem; error: Error }) => void;
  /** Runs after every upload attempt, success or failure. */
  onUploadFinish?: ({ item }: { item: UploadItem }) => void;
  /** Runs when retryUpload is called for a failed file. Throw here to reject the retry, same as beforeUpload. */
  onUploadRetry?: ({ item }: { item: UploadItem }) => void;
  /** Runs when a file is removed from the upload. */
  onRemoveFile?: ({ item }: { item: UploadItem }) => void;
  /** Works for users setting up file chunking when splitting up large files into smaller requests */
  fileChunking?: FileChunking;
};
