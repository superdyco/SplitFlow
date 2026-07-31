<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { useUserStore } from "@/stores/user";

const userStore = useUserStore();
const initial = computed(() => userStore.profile?.nickname?.charAt(0).toUpperCase() || "?");
</script>

<template>
  <main class="page">
    <section class="shell">
      <header class="topbar">
        <RouterLink to="/tasks" class="brand">
          <span class="brand-mark">分</span>
          <span>SplitFlow</span>
        </RouterLink>
        <RouterLink v-if="userStore.profile" to="/profile" class="avatar" aria-label="個人設定">
          {{ initial }}
        </RouterLink>
      </header>
      <slot />
    </section>
  </main>
</template>
