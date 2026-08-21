# use-courier

A React hook for tracking and managing file uploads with progress, retries, cancellation, and optional chunking for large files.

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

For full usage instructions, API reference, and guides, please visit the documentation:

[useFiles Documentation](https://mrphilipp7.github.io/useCourier/)
