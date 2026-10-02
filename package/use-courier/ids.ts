/** A unique id for a tracked file or a chunked upload's uploadId. */
export function createId(): string {
  return crypto.randomUUID();
}
