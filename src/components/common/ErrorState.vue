<script setup lang="ts">
defineProps<{
  message: string | null;
  /** 有給的話會顯示重試按鈕，用在讀取失敗這種可以重來的情況。 */
  retryable?: boolean;
  retrying?: boolean;
}>();

const emit = defineEmits<{ (e: "retry"): void }>();
</script>

<template>
  <div v-if="message" class="error">
    <span>{{ message }}</span>
    <button v-if="retryable" type="button" class="retry" :disabled="retrying" @click="emit('retry')">
      {{ retrying ? "重試中..." : "重試" }}
    </button>
  </div>
</template>

<style scoped>
.error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.retry {
  flex: none;
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid currentColor;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  font-size: var(--text-control-sm);
  font-weight: 700;
}

.retry:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
