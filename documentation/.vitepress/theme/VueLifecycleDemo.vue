<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useData } from "vitepress";
import { Toaster, toast } from "vue-sonner";
import "vue-sonner/style.css";
import { useCourier } from "../../../package/use-courier/vue/index.js";
import { installDemoXHR } from "./demo-xhr";
import VueDemoFileList from "./VueDemoFileList.vue";

/**
 * The Vue twin of LifecycleDemo: the same simulated upload, with every
 * lifecycle callback wired to a toast so readers can watch the order they
 * fire in. Each toast's title is the callback's name and its description
 * says, in plain words, when that callback runs.
 */
const simulateFailure = ref(false);
const rejectInBeforeUpload = ref(false);

let restoreXHR: (() => void) | undefined;
onMounted(() => {
  restoreXHR = installDemoXHR(() => simulateFailure.value);
});
onBeforeUnmount(() => restoreXHR?.());

// Follow VitePress's light/dark toggle, like the React demo's Toaster.
const { isDark } = useData();

const { files, addFile, retryUpload, removeFile } = useCourier<{
  url: string;
}>({
  url: "/demo/uploads",
  beforeUpload: ({ item }) => {
    toast("beforeUpload", {
      description: `I ran before the upload of ${item.file.name}`,
    });
    if (rejectInBeforeUpload.value) {
      throw new Error("Rejected by beforeUpload");
    }
  },
  onUploadSuccess: ({ item, data }) => {
    toast.success("onUploadSuccess", {
      description: `I ran because ${item.file.name} uploaded successfully. The server says it's at ${data.url}`,
    });
  },
  onUploadError: ({ item, error }) => {
    toast.error("onUploadError", {
      description: `I ran because ${item.file.name} failed: ${error.message}`,
    });
  },
  onUploadFinish: ({ item }) => {
    toast("onUploadFinish", {
      description: `I ran after the upload of ${item.file.name}, success or failure`,
    });
  },
  onUploadRetry: ({ item }) => {
    toast.info("onUploadRetry", {
      description: `I ran before retrying ${item.file.name}`,
    });
  },
  onRemoveFile: ({ item }) => {
    toast("onRemoveFile", {
      description: `I ran because ${item.file.name} was removed`,
    });
  },
});

function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  Array.from(input.files ?? []).forEach((file) => addFile(file));
  input.value = "";
}
</script>

<template>
  <div class="courier-demo not-prose rounded-xl border bg-card p-4 text-sm">
    <p class="mb-3 text-muted-foreground">
      The Vue tab of the code above, running for real against a simulated upload
      (no files leave your browser). Each lifecycle callback shows a
      <a
        href="https://vue-sonner.vercel.app/"
        target="_blank"
        rel="noreferrer"
        class="underline"
        >vue-sonner</a
      >
      toast when it runs, so you can see the order they fire in.
    </p>

    <label class="mb-2 flex items-center gap-2">
      <input v-model="simulateFailure" type="checkbox" />
      Simulate a failed upload (then click Retry)
    </label>

    <label class="mb-3 flex items-center gap-2">
      <input v-model="rejectInBeforeUpload" type="checkbox" />
      Reject the file in <code>beforeUpload</code>
    </label>

    <input type="file" multiple @change="handleFileChange" />

    <VueDemoFileList
      :files="files"
      @retry="(id) => retryUpload(id)"
      @remove="removeFile"
    />

    <!-- Same settings as the React demo: one upload fires 3-4 callbacks
         over a couple of seconds, so show every toast expanded and keep them
         up long enough to read the whole sequence. -->
    <Toaster
      position="bottom-right"
      expand
      :visible-toasts="6"
      :duration="8000"
      :theme="isDark ? 'dark' : 'light'"
      class="toaster group courier-demo"
      :style="{
        '--normal-bg': 'var(--popover)',
        '--normal-text': 'var(--popover-foreground)',
        '--normal-border': 'var(--border)',
        '--border-radius': 'var(--radius)',
      }"
    />
  </div>
</template>
