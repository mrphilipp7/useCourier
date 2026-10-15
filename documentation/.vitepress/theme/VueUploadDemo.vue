<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useCourier } from "../../../package/use-courier/vue/index.js";
import { installDemoXHR } from "./demo-xhr";
import VueDemoFileList from "./VueDemoFileList.vue";

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

    <VueDemoFileList
      :files="files"
      @retry="(id) => retryUpload(id)"
      @remove="removeFile"
    />
    <p v-if="files.length" class="mt-3 text-muted-foreground">
      Overall: {{ overall.status }} · {{ overall.weightedProgress }}%
    </p>
  </div>
</template>
