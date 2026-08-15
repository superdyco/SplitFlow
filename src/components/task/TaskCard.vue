<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import type { Task } from "@/types/task";
import { ROLE_LABELS, type TaskRole } from "@/types/member";
import { STATUS_LABELS } from "@/utils/taskStatus";
import { formatDate } from "@/utils/firestore";
import { formatAmount } from "@/utils/currency";

const props = defineProps<{
  task: Task;
  role: TaskRole;
  /** 我在這趟旅程分攤的金額。null 代表還沒計算（列表預設不算）。 */
  myCost: number | null;
}>();

const emit = defineEmits<{
  (e: "archive", task: Task): void;
  (e: "unarchive", task: Task): void;
  (e: "delete", task: Task): void;
}>();

/** 只有 owner 能封存與刪除。firestore.rules 也擋著，這裡只是不要讓人按了才失敗。 */
const isOwner = computed(() => props.role === "owner");
const isArchived = computed(() => props.task.status === "archived");
</script>

<template>
  <!--
    整張卡片可點是既有的操作方式，但 <a> 依規範不能包互動元素，
    所以用 stretched link：連結本身只放在標題上，再用 ::after 覆蓋整張卡，
    動作按鈕則疊在它上面。這樣兩個動作都能點，HTML 也是合法的。
  -->
  <div class="card task-card" :class="{ archived: isArchived }">
    <div class="spread">
      <div>
        <h2 class="section-title">
          <RouterLink :to="`/tasks/${task.id}`" class="stretch">{{ task.name }}</RouterLink>
        </h2>
        <p class="tiny">{{ task.startDate || "未設定" }} - {{ task.endDate || "未設定" }}</p>
      </div>
      <span class="role-pill">{{ ROLE_LABELS[role] }}</span>
    </div>

    <div class="task-meta">
      <span>{{ task.memberCount }} 位成員</span>
      <span>{{ task.expenseCount }} 筆支出</span>
      <!-- 進行中不掛標籤 —— 沒消息就是好消息，每張卡貼一個「進行中」只是噪音。 -->
      <span v-if="isArchived" class="archived-pill">{{ STATUS_LABELS.archived }}</span>
    </div>

    <p v-if="myCost !== null" class="my-cost">
      <span class="tiny">我的花費</span>
      <strong>{{ task.defaultCurrency }} {{ formatAmount(myCost, task.defaultCurrency) }}</strong>
    </p>

    <p class="tiny">建立日期 {{ formatDate(task.createdAt) || "剛剛" }}</p>

    <!--
      .prevent.stop 是必要的：按鈕疊在 stretched link 的覆蓋層上，
      不擋掉的話點按鈕會連帶導航到任務頁。
    -->
    <div v-if="isOwner" class="actions">
      <button
        v-if="isArchived"
        type="button"
        class="action"
        @click.prevent.stop="emit('unarchive', task)"
      >
        解除封存
      </button>
      <button v-else type="button" class="action" @click.prevent.stop="emit('archive', task)">
        封存
      </button>
      <!--
        封存的卡片不給刪除鈕。封存代表「收起來了、之後可能還要查」，
        而刪除不可逆 —— 把兩顆按鈕並排放在一張已經不常看的卡上，最容易按錯的
        就是這一顆。要刪就先解除封存，讓它回到眼前再刪。
      -->
      <button
        v-if="!isArchived"
        type="button"
        class="action danger"
        @click.prevent.stop="emit('delete', task)"
      >
        刪除
      </button>
    </div>
  </div>
</template>

<style scoped>
.task-card {
  /* stretch 的 ::after 要靠這個定位，少了它覆蓋層會跑去對齊 viewport。 */
  position: relative;
}

/*
  封存的卡片要一眼就看得出「沒在用」。做法是讓它退回頁面底色並拿掉陰影 ——
  陰影代表浮起來、正在進行，平貼下去就是已經收起來的東西。
*/
.task-card.archived {
  background: var(--color-bg);
  border-color: var(--color-line-strong);
  box-shadow: none;
}

.task-card.archived .section-title,
.task-card.archived .my-cost strong {
  color: var(--color-muted);
}

/* 進行中的橘色標籤在封存卡片上會太搶眼，但「已封存」那顆要留著看得見。 */
.task-card.archived .task-meta span:not(.archived-pill),
.task-card.archived .role-pill {
  background: var(--color-line);
  color: var(--color-soft);
}

/* 連結只包標題，但 ::after 撐滿整張卡片，所以整張卡都可點。 */
.stretch {
  color: inherit;
  text-decoration: none;
}

.stretch::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
}

.actions {
  /* 疊在 stretch 的覆蓋層之上，不然會點到任務頁。 */
  position: relative;
  z-index: 1;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}

.action {
  padding: 5px 12px;
  border: 1px solid var(--color-line-strong);
  border-radius: 999px;
  background: none;
  color: var(--color-muted);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.action:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.action.danger:hover {
  border-color: var(--color-danger);
  color: var(--color-danger);
}

.archived-pill {
  background: var(--color-line-strong);
  color: var(--color-ink);
}

.task-meta {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin: 14px 0 8px;
}

.my-cost {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin: 0 0 6px;
  padding-top: 8px;
  border-top: 1px solid var(--color-line);
}

.my-cost strong {
  font-variant-numeric: tabular-nums;
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
