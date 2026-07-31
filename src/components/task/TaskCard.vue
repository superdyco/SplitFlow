<script setup lang="ts">
import { RouterLink } from "vue-router";
import type { Task } from "@/types/task";
import type { TaskRole } from "@/types/member";
import { formatDate } from "@/utils/firestore";

defineProps<{
  task: Task;
  role: TaskRole;
}>();
</script>

<template>
  <RouterLink :to="`/tasks/${task.id}`" class="card task-card">
    <div class="spread">
      <div>
        <h2 class="section-title">{{ task.name }}</h2>
        <p class="tiny">{{ task.startDate || "未設定" }} - {{ task.endDate || "未設定" }}</p>
      </div>
      <span class="role-pill">{{ role }}</span>
    </div>
    <div class="task-meta">
      <span>{{ task.memberCount }} 位成員</span>
      <span>{{ task.expenseCount }} 筆支出</span>
      <span>{{ task.status }}</span>
    </div>
    <p class="tiny">建立日期 {{ formatDate(task.createdAt) || "剛剛" }}</p>
  </RouterLink>
</template>

<style scoped>
.task-card {
  display: block;
}

.task-meta {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin: 14px 0 8px;
}

.task-meta span,
.role-pill {
  border-radius: 999px;
  background: var(--color-primary-soft);
  color: var(--color-primary);
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 700;
}
</style>
