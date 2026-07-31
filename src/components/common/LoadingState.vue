<template>
  <div class="card loading-card">
    <div class="spinner" aria-hidden="true"></div>
    <div>
      <strong>{{ title }}</strong>
      <p class="tiny">{{ message }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title?: string;
  message?: string;
}>();
</script>

<style scoped>
.loading-card {
  display: flex;
  align-items: center;
  gap: 14px;
}

.spinner {
  width: 28px;
  height: 28px;
  border: 3px solid var(--color-line);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
