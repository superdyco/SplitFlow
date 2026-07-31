<script setup lang="ts">
import type { TaskMember } from "@/types/member";

defineProps<{
  member: TaskMember;
  currentUid: string;
}>();
</script>

<template>
  <div class="card member-row">
    <span class="avatar">{{ member.nickname.charAt(0).toUpperCase() }}</span>
    <div>
      <strong>{{ member.nickname }}</strong>
      <p class="tiny">{{ member.role }} <span v-if="member.uid === currentUid">· 你</span></p>
    </div>
  </div>
</template>

<style scoped>
.member-row {
  display: flex;
  align-items: center;
  gap: 12px;
  box-shadow: none;
}
</style>
