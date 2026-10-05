import type { UploadHeaders, UploadItem, UseCourierProps } from "./types.js";

/** #20: the options that shape every upload request, as given to useCourier. */
export type RequestOptions = Pick<
  UseCourierProps,
  "method" | "headers" | "withCredentials" | "fieldName" | "formFields"
>;

/**
 * Headers for one request: the static object, or whatever the function
 * returns for this file — which may be a promise (e.g. an async token
 * lookup). Called once per request so each chunk and retry gets fresh ones.
 */
export function resolveHeaders(
  request: RequestOptions,
  item: UploadItem,
): UploadHeaders | Promise<UploadHeaders> {
  const { headers } = request;
  return typeof headers === "function" ? headers({ item }) : (headers ?? {});
}

/**
 * Builds one request's multipart body: formFields first, then the file (or
 * chunk) under fieldName, then any fields the hook itself adds (the chunk
 * metadata). Custom fields go before the file so streaming multipart
 * parsers like busboy/Multer have them by the time the file arrives.
 */
export function buildFormData(
  request: RequestOptions,
  item: UploadItem,
  body: Blob,
  hookFields: Record<string, string> = {},
): FormData {
  const formData = new FormData();

  const { formFields } = request;
  const customFields =
    typeof formFields === "function" ? formFields({ item }) : formFields;
  for (const [name, value] of Object.entries(customFields ?? {})) {
    formData.append(name, value);
  }

  formData.append(request.fieldName ?? "file", body, item.file.name);

  for (const [name, value] of Object.entries(hookFields)) {
    formData.append(name, value);
  }

  return formData;
}
