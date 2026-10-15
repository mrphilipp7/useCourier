<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useCourier } from "../../../package/use-courier/vue/index.js";
import { installDemoXHR } from "./demo-xhr";

const simulateFailure = ref(false);

// Swap in the fake upload server only in the browser, while mounted.
let restoreXHR: (() => void) | undefined;
onMounted(() => {
  restoreXHR = installDemoXHR(() => simulateFailure.value);
});
onBeforeUnmount(() => restoreXHR?.());

const { files, overall, addFile, retryUpload, removeFile } = useCourier<{
  url: string;
}>({ url: "/demo/uploads" });

function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  Array.from(input.files ?? []).forEach((file) => addFile(file));
  input.value = "";
}
</script>

<template>
  <div class="courier-demo not-prose rounded-xl border bg-card p-4 text-sm">
    <p class="mb-3 text-muted-foreground">
      This is the actual <code>use-courier/vue</code> composable, running
      natively in this page (the docs site is itself a Vue app), against a
      simulated upload, so no files leave your browser.
    </p>

    <label class="mb-3 flex items-center gap-2">
      <input v-model="simulateFailure" type="checkbox" />
      Simulate a failed upload (then click Retry)
    </label>

    <input type="file" multiple @change="handleFileChange" />

    <div v-if="files.length" class="mt-4 flex flex-col gap-3">
      <div v-for="item in files" :key="item.id" class="rounded-lg border p-3">
        <div class="flex items-center justify-between gap-2">
          <span class="font-medium">{{ item.file.name }}</span>
          <span class="text-muted-foreground">
            {{ item.status }} · {{ item.uploadProgress }}%
          </span>
        </div>
        <div class="mt-2 h-1.5 overflow-hidden rounded bg-muted">
          <div
            class="h-full bg-primary transition-all"
            :style="{ width: `${item.uploadProgress}%` }"
          />
        </div>
        <div class="mt-2 flex gap-2">
          <button
            v-if="item.status === 'error'"
            type="button"
            class="rounded-md border px-2 py-1"
            @click="retryUpload(item.id)"
          >
            Retry
          </button>
          <button
            type="button"
            class="rounded-md border px-2 py-1"
            @click="removeFile(item.id)"
          >
            Remove
          </button>
        </div>
      </div>
      <p class="text-muted-foreground">
        Overall: {{ overall.status }} · {{ overall.weightedProgress }}%
      </p>
    </div>
  </div>
</template>
