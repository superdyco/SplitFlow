<template>
  <div v-if="message" class="error">{{ message }}</div>
</template>

<script setup lang="ts">
defineProps<{
  message: string | null;
}>();
</script>
