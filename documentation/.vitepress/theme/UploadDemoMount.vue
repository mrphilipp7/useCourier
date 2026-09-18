<template>
  <div ref="container" />
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from "vue";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import { UploadDemo } from "./UploadDemo.js";

const container = ref<HTMLDivElement | null>(null);
let root: Root | null = null;

onMounted(() => {
  if (!container.value) return;
  root = createRoot(container.value);
  root.render(createElement(UploadDemo));
});

onBeforeUnmount(() => {
  root?.unmount();
});
</script>
