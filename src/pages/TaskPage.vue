<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import AppLayout from "@/layouts/AppLayout.vue";
import EmptyState from "@/components/common/EmptyState.vue";
import ErrorState from "@/components/common/ErrorState.vue";
import LoadingState from "@/components/common/LoadingState.vue";
import MemberRow from "@/components/member/MemberRow.vue";
import { useAuthStore } from "@/stores/auth";
import { useTask } from "@/composables/useTask";
import { useTaskMembers } from "@/composables/useTaskMembers";
import { buildInviteUrl } from "@/utils/firestore";

type Tab = "expenses" | "members" | "settlement";

const route = useRoute();
const authStore = useAuthStore();
const taskId = computed(() => String(route.params.taskId || ""));
const activeTab = ref<Tab>("expenses");
const copied = ref(false);
const actionMessage = ref<string | null>(null);
const denied = computed(() => route.query.denied === "1");

const taskState = useTask(taskId.value, authStore.user!.uid);
const memberState = useTaskMembers(taskId.value);
const inviteUrl = computed(() => taskState.task.value ? buildInviteUrl(taskState.task.value.inviteCode) : "");

async function load() {
  await taskState.load();
  if (taskState.isMember.value) await memberState.load();
}

async function copyInvite() {
  await navigator.clipboard.writeText(inviteUrl.value);
  copied.value = true;
  window.setTimeout(() => (copied.value = false), 1500);
}

function todoExpense() {
  actionMessage.value = "此功能將於下一階段完成";
}

onMounted(load);
</script>

<template>
  <AppLayout>
    <div class="stack">
      <LoadingState v-if="taskState.loading.value" title="讀取任務中" message="正在檢查你的任務權限。" />

      <div v-else-if="denied || taskState.error.value" class="stack">
        <ErrorState :message="taskState.error.value || '你沒有權限查看這個分帳任務'" />
      </div>

      <template v-else-if="taskState.task.value">
        <div class="spread">
          <div>
            <h1 class="title">{{ taskState.task.value.name }}</h1>
            <p class="tiny">
              {{ taskState.task.value.defaultCurrency }} ·
              {{ taskState.task.value.memberCount }} 位成員 ·
              {{ taskState.task.value.expenseCount }} 筆支出
            </p>
          </div>
          <button v-if="taskState.isAdmin.value" class="btn btn-ghost" @click="copyInvite">
            {{ copied ? "已複製" : "邀請" }}
          </button>
        </div>

        <div v-if="taskState.isAdmin.value" class="card admin-card">
          <strong>{{ taskState.isOwner.value ? "Owner 管理區" : "Admin 管理區" }}</strong>
          <p class="tiny">第一版先顯示管理功能位置。成員移除與角色切換將於下一階段完成。</p>
        </div>

        <div class="tabs">
          <button class="tab" :class="{ active: activeTab === 'expenses' }" @click="activeTab = 'expenses'">支出</button>
          <button class="tab" :class="{ active: activeTab === 'members' }" @click="activeTab = 'members'">成員</button>
          <button class="tab" :class="{ active: activeTab === 'settlement' }" @click="activeTab = 'settlement'">結算</button>
        </div>

        <ErrorState :message="memberState.error.value || actionMessage" />

        <section v-if="activeTab === 'expenses'" class="stack">
          <EmptyState title="目前尚無支出" message="第一版先完成任務與成員協作，新增支出會在下一階段補上。">
            <button class="btn btn-primary" style="margin-top: 16px" @click="todoExpense">新增支出</button>
          </EmptyState>
        </section>

        <section v-if="activeTab === 'members'" class="stack">
          <LoadingState v-if="memberState.loading.value" title="讀取成員中" message="正在讀取 Firestore 成員資料。" />
          <MemberRow
            v-for="member in memberState.members.value"
            v-else
            :key="member.uid"
            :member="member"
            :current-uid="authStore.user!.uid"
          />
        </section>

        <section v-if="activeTab === 'settlement'">
          <EmptyState title="目前尚無支出，無法結算" message="即時匯率、付款確認與歷史結算版本列入後續階段。" />
        </section>
      </template>
    </div>
  </AppLayout>
</template>

<style scoped>
.admin-card {
  box-shadow: none;
  background: var(--color-primary-soft);
}
</style>
