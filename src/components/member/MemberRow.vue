<script setup lang="ts">
import { computed } from "vue";
import type { TaskMember } from "@/types/member";
import { ROLE_LABELS } from "@/types/member";

const props = defineProps<{
  member: TaskMember;
  currentUid: string;
  canManage: boolean;
  busy: boolean;
}>();

const emit = defineEmits<{
  (e: "promote", uid: string): void;
  (e: "demote", uid: string): void;
  (e: "remove", uid: string): void;
}>();

const isSelf = computed(() => props.member.uid === props.currentUid);
// owner 不能被降級或移除，自己也不能對自己動作。
const showActions = computed(() => props.canManage && !isSelf.value && props.member.role !== "owner");
</script>

<template>
  <div class="card member-row">
    <span class="avatar">{{ member.nickname.charAt(0).toUpperCase() }}</span>
    <div class="body">
      <strong>{{ member.nickname }}</strong>
      <p class="tiny">{{ ROLE_LABELS[member.role] }}<span v-if="isSelf"> · 你</span></p>
    </div>
    <div v-if="showActions" class="actions">
      <button
        v-if="member.role === 'member'"
        class="btn btn-ghost btn-sm"
        :disabled="busy"
        @click="emit('promote', member.uid)"
      >
        升為管理員
      </button>
      <button v-else class="btn btn-sm" :disabled="busy" @click="emit('demote', member.uid)">降為成員</button>
      <button
        v-if="member.role === 'member'"
        class="btn btn-danger btn-sm"
        :disabled="busy"
        @click="emit('remove', member.uid)"
      >
        移除
      </button>
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

.body {
  min-width: 0;
  flex: 1;
}

.body strong {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.actions {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}
</style>
