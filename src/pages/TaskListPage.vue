<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import AppLayout from "@/layouts/AppLayout.vue";
import EmptyState from "@/components/common/EmptyState.vue";
import ErrorState from "@/components/common/ErrorState.vue";
import LoadingState from "@/components/common/LoadingState.vue";
import TaskCard from "@/components/task/TaskCard.vue";
import type { Task } from "@/types/task";
import type { TaskRole } from "@/types/member";
import { useAuthStore } from "@/stores/auth";
import { listUserTasks } from "@/services/taskService";
import { getTaskMember } from "@/services/memberService";
import { firebaseErrorMessage } from "@/utils/firestore";

const authStore = useAuthStore();
const loading = ref(true);
const error = ref<string | null>(null);
const rows = ref<Array<{ task: Task; role: TaskRole }>>([]);

async function load() {
  if (!authStore.user) return;
  loading.value = true;
  error.value = null;
  try {
    const tasks = await listUserTasks(authStore.user.uid);
    const withRoles = await Promise.all(tasks.map(async task => {
      const member = await getTaskMember(task.id, authStore.user!.uid);
      return { task, role: member?.role || "member" as TaskRole };
    }));
    rows.value = withRoles;
  } catch (err) {
    error.value = firebaseErrorMessage(err);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <AppLayout>
    <div class="stack">
      <div class="spread">
        <div>
          <p class="tiny">哈囉</p>
          <h1 class="title">我的分帳</h1>
        </div>
        <RouterLink to="/tasks/new" class="btn btn-primary">＋ 建立</RouterLink>
      </div>

      <LoadingState v-if="loading" title="讀取任務中" message="正在從 Firestore 取得你的任務。" />
      <ErrorState v-else :message="error" />

      <EmptyState
        v-if="!loading && !error && rows.length === 0"
        title="目前沒有進行中的分帳"
        message="建立一個新任務，或從別人傳來的邀請連結加入。"
      >
        <RouterLink to="/tasks/new" class="btn btn-primary" style="margin-top: 16px">建立分帳任務</RouterLink>
      </EmptyState>

      <div v-if="!loading && rows.length" class="stack">
        <TaskCard v-for="row in rows" :key="row.task.id" :task="row.task" :role="row.role" />
      </div>
    </div>
  </AppLayout>
</template>
