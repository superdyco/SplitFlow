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
  <div class="card task-card" :class="isArchived ? 'flat archived' : ''">
    <div class="spread">
      <div>
        <h2 class="section-title">
          <RouterLink :to="`/tasks/${task.id}`" class="stretch">{{ task.name }}</RouterLink>
        </h2>
        <p class="tiny">{{ task.startDate || "未設定" }} - {{ task.endDate || "未設定" }}</p>
      </div>
      <!-- 進行中不掛標籤 —— 沒消息就是好消息，每張卡貼一個「進行中」只是噪音。 -->
      <span v-if="isArchived" class="archived-pill">{{ STATUS_LABELS.archived }}</span>
    </div>

    <!--
      角色、成員數、支出數是屬性不是狀態，所以是文字不是藥丸。
      三顆橘色藥丸並排會稀釋掉橘色「這個可以按」的意思，然後右下角
      真正可按的兩顆反而是灰的。
    -->
    <p class="tiny meta">
      {{ ROLE_LABELS[role] }} · {{ task.memberCount }} 位成員 · {{ task.expenseCount }} 筆支出
    </p>

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
        class="btn-quiet"
        @click.prevent.stop="emit('unarchive', task)"
      >
        解除封存
      </button>
      <button v-else type="button" class="btn-quiet" @click.prevent.stop="emit('archive', task)">
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
        class="btn-quiet danger"
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
  transition:
    transform var(--dur-lift) var(--ease),
    box-shadow var(--dur-lift) var(--ease),
    border-color var(--dur-lift) var(--ease);
}

/* 整張卡都可點，所以整張卡都該有被指到的回饋。 */
.task-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-raise);
  border-color: var(--color-line-strong);
}

/*
  封存的卡片一眼要看得出「沒在用」。退回頁面底色並且不浮起 ——
  浮起代表正在進行，平貼下去就是已經收起來的東西。
*/
.task-card.archived {
  background: var(--color-bg);
  border-color: var(--color-line-strong);
}

.task-card.archived:hover {
  transform: none;
  box-shadow: var(--shadow-flat);
}

.task-card.archived .section-title,
.task-card.archived .my-cost strong {
  color: var(--color-muted);
}

.meta {
  margin: var(--space-3) 0 var(--space-2);
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
  gap: var(--space-4);
  margin-top: var(--space-3);
}

/* 狀態才配藥丸，而且一張卡最多一顆。 */
.archived-pill {
  flex: none;
  border-radius: var(--radius-pill);
  padding: 6px 10px;
  background: var(--color-line-strong);
  color: var(--color-ink);
  font-size: var(--text-tiny);
  font-weight: 700;
}

.my-cost {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  margin: 0 0 6px;
  padding-top: var(--space-2);
  border-top: 1px solid var(--color-line);
}

.my-cost strong {
  font-size: var(--text-card);
  font-variant-numeric: tabular-nums;
}
</style>
