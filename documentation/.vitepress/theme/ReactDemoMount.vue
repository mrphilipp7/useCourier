<template>
  <div ref="container" />
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from "vue";
import { createRoot, type Root } from "react-dom/client";
import { createElement, type ComponentType } from "react";

/** Mounts a React demo component inside a VitePress (Vue) page. */
const props = defineProps<{ component: ComponentType }>();

const container = ref<HTMLDivElement | null>(null);
let root: Root | null = null;

onMounted(() => {
  if (!container.value) return;
  root = createRoot(container.value);
  root.render(createElement(props.component));
});

onBeforeUnmount(() => {
  root?.unmount();
});
</script>
