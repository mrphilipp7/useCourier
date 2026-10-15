<script lang="ts">
import { ref } from "vue";

type Framework = "react" | "vue";
const STORAGE_KEY = "use-courier:framework";

// Shared by every FrameworkTabs instance, so choosing Vue in one demo
// switches them all, and remembered across pages and visits.
const framework = ref<Framework>("react");
let restored = false;
</script>

<script setup lang="ts">
import { onMounted } from "vue";

/**
 * React/Vue tabs for live demos. Only the selected demo is mounted: each
 * demo swaps the fake upload server onto globalThis.XMLHttpRequest, so two
 * mounted at once would step on each other.
 */
onMounted(() => {
  if (restored) return;
  restored = true;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "react" || saved === "vue") framework.value = saved;
  } catch {
    // Storage can be unavailable (private mode, blocked); React is the default.
  }
});

function select(next: Framework) {
  framework.value = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Not remembering the choice is fine.
  }
}
</script>

<template>
  <div class="framework-tabs">
    <div class="tabs" role="tablist" aria-label="Framework">
      <button
        v-for="option in ['react', 'vue'] as const"
        :key="option"
        type="button"
        role="tab"
        :aria-selected="framework === option"
        :class="{ active: framework === option }"
        @click="select(option)"
      >
        {{ option === "react" ? "React" : "Vue" }}
      </button>
    </div>
    <div role="tabpanel">
      <slot v-if="framework === 'react'" name="react" />
      <slot v-else name="vue" />
    </div>
  </div>
</template>

<style scoped>
.framework-tabs {
  margin: 16px 0;
}

.tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--vp-c-divider);
  margin-bottom: 12px;
}

.tabs button {
  padding: 6px 12px;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  font-size: 14px;
  font-weight: 500;
  color: var(--vp-c-text-2);
  transition: color 0.2s;
}

.tabs button:hover {
  color: var(--vp-c-text-1);
}

.tabs button.active {
  color: var(--vp-c-text-1);
  border-bottom-color: var(--vp-c-brand-1);
}
</style>
