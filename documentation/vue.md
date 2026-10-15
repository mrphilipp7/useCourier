# Vue

`use-courier` includes a Vue 3 composable with the same API and behavior as the React hook: progress, retries, cancellation, chunked uploads, request options, and every lifecycle callback. Import it from `use-courier/vue`. It needs Vue 3.3 or later, and React isn't required.

## Basic usage

```vue
<script setup lang="ts">
import { useCourier } from "use-courier/vue";

const { files, addFile } = useCourier({
  url: "/api/uploads",
});

function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  Array.from(input.files ?? []).forEach((file) => addFile(file));
}
</script>

<template>
  <input type="file" multiple @change="handleFileChange" />
  <p v-for="item in files" :key="item.id">
    {{ item.file.name }}: {{ item.status }} ({{ item.uploadProgress }}%)
  </p>
</template>
```

### Try it

<VueUploadDemo />

## How it differs from React

Options, callbacks, `addFile`, `retryUpload`, `removeFile`, and the error classes are identical, so the examples on every other page apply to Vue too; they're written for React. Only these differ:

|                         | React (`use-courier`)                              | Vue (`use-courier/vue`)                                                                           |
| ----------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `files`                 | An array                                           | A ref: `files.value` in `<script>`, just `files` in the template                                  |
| `overall`               | An object                                          | A computed ref                                                                                    |
| Options                 | A plain object; the latest render's props are used | A plain object, a ref, or a getter; re-read every time an option is needed                        |
| Cancelled automatically | When the component unmounts                        | When the component unmounts (more precisely, when the effect scope it was created in is disposed) |

## Reactive options

When options depend on reactive state, pass a getter. It's called each time the composable needs an option, so a change applies to the next request:

```ts
import { ref } from "vue";
import { useCourier } from "use-courier/vue";
import { getAccessToken } from "./auth";

const folderId = ref("inbox");

const { files, addFile } = useCourier(() => ({
  url: "/api/uploads",
  headers: async () => ({
    Authorization: `Bearer ${await getAccessToken()}`,
  }),
  formFields: { folderId: folderId.value },
}));
```

The whole options object is what can be reactive, not each field. Options like `headers` and the callbacks are functions themselves, so a getter per field would be ambiguous. Read refs inside the getter, as `folderId.value` is above, rather than passing a ref as a field's value.

## Outside components

`useCourier` works anywhere, including a Pinia store or a plain module. Uploads are cancelled automatically only when it's called inside a component's `setup` (or any `effectScope`), at the moment that scope ends. Anywhere else, uploads keep running until they finish or you call `removeFile`.

## TypeScript

Pass your upload API's response type the same way as in React, and `data` in `onUploadSuccess` and the result of `addFile` are typed with it:

```ts
const { files, addFile } = useCourier<{ url: string }>({
  url: "/api/uploads",
  onUploadSuccess: ({ item, data }) => {
    console.log(`${item.file.name} is at ${data.url}`);
  },
});
```

`use-courier/vue` also exports `CourierOptions` (the options type) and `UseCourierReturn` (what the composable returns).
