# Getting Started

A React hook for tracking and managing file uploads.

## What is useCourier?

`useCourier` is a React hook for uploading files while tracking their progress, status, errors, and completion lifecycle.

## Features

`useCourier` provides utilities for:

- Track upload progress for each file
- Retry failed uploads
- Abort in-progress uploads
- Upload large files in configurable chunks
- Respond to upload lifecycle events

## Installation

Choose your preferred package manager:

::: code-group

```bash [npm]
npm install use-courier
```

```bash [yarn]
yarn add use-courier
```

```bash [pnpm]
pnpm add use-courier
```

```bash [bun]
bun add use-courier
```

:::

## Basic usage

```tsx
import { useCourier } from "use-courier";

export function UploadForm() {
  const { files, addFile } = useCourier({
    url: "/api/uploads",
  });

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) addFile(file);
  }

  return (
    <>
      <input type="file" onChange={handleFileChange} />
      {files.map((item) => (
        <p key={item.id}>
          {item.file.name}: {item.status} ({item.uploadProgress}%)
        </p>
      ))}
    </>
  );
}
```
