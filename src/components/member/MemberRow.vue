<script setup lang="ts">
import { computed } from "vue";
import type { TaskMember } from "@/types/member";
import { ROLE_LABELS } from "@/types/member";
import { memberDisplayName } from "@/utils/memberName";

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
  (e: "rename", uid: string): void;
}>();

const isSelf = computed(() => props.member.uid === props.currentUid);
const isVirtual = computed(() => props.member.virtual === true);
// owner 不能被降級或移除，自己也不能對自己動作。
const showActions = computed(() => props.canManage && !isSelf.value && props.member.role !== "owner");
</script>

<template>
  <div class="card flat member-row">
    <span class="avatar">{{ member.nickname.charAt(0).toUpperCase() }}</span>
    <div class="body">
      <strong>{{ memberDisplayName(member) }}</strong>
      <p class="tiny">
        {{ ROLE_LABELS[member.role] }}<span v-if="isSelf"> · 你</span><span v-if="isVirtual"> · 無帳號</span>
      </p>
    </div>
    <div v-if="showActions" class="actions">
      <!-- 虛擬成員沒有帳號，升成 admin 不會讓任何人拿到權限，規則也擋著。
           這裡收起來只是不要讓人按了才失敗。 -->
      <button
        v-if="member.role === 'member' && !isVirtual"
        class="btn btn-ghost btn-sm"
        :disabled="busy"
        @click="emit('promote', member.uid)"
      >
        升為管理員
      </button>
      <button v-else-if="!isVirtual" class="btn btn-sm" :disabled="busy" @click="emit('demote', member.uid)">
        降為成員
      </button>
      <!-- 真實成員的暱稱來自個人資料、他自己改；虛擬成員的名字是別人替他打的，
           打錯就沒有其他管道能修，所以這顆只給虛擬成員。 -->
      <button
        v-if="isVirtual"
        class="btn btn-ghost btn-sm"
        :disabled="busy"
        @click="emit('rename', member.uid)"
      >
        改名
      </button>
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
  gap: var(--space-3);
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
  gap: var(--space-2);
}
</style>
