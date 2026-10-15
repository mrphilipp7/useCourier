<script setup lang="ts">
import type { UploadItem } from "../../../package/use-courier/vue/index.js";

/** The file list both Vue demos render: progress bar, Retry, Remove. */
defineProps<{ files: UploadItem[] }>();
defineEmits<{ retry: [id: string]; remove: [id: string] }>();
</script>

<template>
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
          @click="$emit('retry', item.id)"
        >
          Retry
        </button>
        <button
          type="button"
          class="rounded-md border px-2 py-1"
          @click="$emit('remove', item.id)"
        >
          Remove
        </button>
      </div>
    </div>
  </div>
</template>
