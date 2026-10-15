# Getting Started

A React hook and Vue composable for tracking and managing file uploads.

## What is useCourier?

`useCourier` is a React hook, and a Vue 3 composable, for uploading files while tracking their progress, status, errors, and completion lifecycle.

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

It works with React 18 or 19, or Vue 3.3 and later. Install only the framework you use; the other isn't required.

## Basic usage

::: code-group

```tsx [React]
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

```vue [Vue]
<script setup lang="ts">
import { useCourier } from "use-courier/vue";

const { files, addFile } = useCourier({
  url: "/api/uploads",
});

function handleFileChange(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) addFile(file);
}
</script>

<template>
  <input type="file" @change="handleFileChange" />
  <p v-for="item in files" :key="item.id">
    {{ item.file.name }}: {{ item.status }} ({{ item.uploadProgress }}%)
  </p>
</template>
```

:::

The options and callbacks are identical in React and Vue. Throughout the docs, examples that look different in each framework have React and Vue tabs; see [Vue](/vue) for the few differences, like `files` being a ref.

### Try it

<FrameworkTabs>
<template #react><UploadDemo /></template>
<template #vue><VueUploadDemo /></template>
</FrameworkTabs>
