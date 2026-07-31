<template>
  <div class="empty">
    <h2 class="section-title">{{ title }}</h2>
    <p class="tiny">{{ message }}</p>
    <slot />
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title: string;
  message: string;
}>();
</script>
