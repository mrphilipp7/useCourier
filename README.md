# use-courier

[![npm version](https://img.shields.io/npm/v/use-courier.svg)](https://www.npmjs.com/package/use-courier)
[![license](https://img.shields.io/npm/l/use-courier.svg)](https://github.com/mrphilipp7/useCourier/blob/main/LICENSE)

A headless React hook for file uploads with real progress tracking, retries, cancellation, and chunked uploads for large files.

## Why useCourier?

`fetch` can't report upload progress — there's no way to know how many bytes of a file have actually been sent, only when the whole request finishes. `useCourier` uses `XMLHttpRequest` under the hood specifically to expose real 0-100% upload progress, wrapped in a small, typed, headless hook you build your own upload UI on top of.

- **Real upload progress** — accurate 0-100% progress per file as bytes are actually sent, not a spinner
- **Retries** — re-run a failed upload without asking the user to re-select the file
- **Cancellation** — abort an in-flight upload, or every upload in flight on unmount
- **Chunked uploads** — automatically splits large files into sequential requests, retrying failed chunks independently
- **Lifecycle callbacks** — `beforeUpload`, `onUploadSuccess`, `onUploadError`, `onUploadFinish`, `onUploadRetry`, `onRemoveFile`
- **Headless** — no UI, no styling opinions; works with any component library
- **Typed** — full TypeScript support, generic over your API's response shape

## Installation

```bash
npm install use-courier
```

`use-courier` supports React 18 and React 19.

## Basic usage

```tsx
import type { ChangeEvent } from "react";
import { useCourier } from "use-courier";

export function FileUpload() {
  const { files, addFile } = useCourier({
    url: "/api/uploads",
  });

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    Array.from(event.target.files ?? []).forEach((file) => {
      void addFile(file);
    });
  }

  return (
    <>
      <input type="file" multiple onChange={handleFileChange} />
      {files.map((item) => (
        <p key={item.id}>
          {item.file.name}: {item.status} ({item.uploadProgress}%)
        </p>
      ))}
    </>
  );
}
```

## Documentation

Full API reference, backend integration guides for Express, Next.js, TanStack Start, and Hono, large-file chunking details, and a Shadcn attachments integration:

[useCourier Documentation](https://mrphilipp7.github.io/useCourier/)

The docs also publish an [`llms.txt`](https://mrphilipp7.github.io/useCourier/llms.txt) and [`llms-full.txt`](https://mrphilipp7.github.io/useCourier/llms-full.txt) for LLM tooling.

## License

MIT © [Zach Philipp](https://github.com/mrphilipp7)
