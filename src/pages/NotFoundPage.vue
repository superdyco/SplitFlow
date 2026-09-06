<script setup lang="ts">
import { RouterLink } from "vue-router";
import AppLayout from "@/layouts/AppLayout.vue";
import EmptyState from "@/components/common/EmptyState.vue";
</script>

<template>
  <AppLayout>
    <EmptyState title="找不到這個頁面" message="網址可能打錯了，或這個頁面已經不在了。">
      <RouterLink to="/tasks" class="btn btn-primary back">回到我的任務</RouterLink>
    </EmptyState>
  </AppLayout>
</template>

<style scoped>
.back {
  margin-top: var(--space-4);
}
</style>
