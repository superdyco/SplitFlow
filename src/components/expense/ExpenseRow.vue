<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import type { Expense } from "@/types/expense";
import { categoryMeta } from "@/types/expense";
import { formatAmount } from "@/utils/currency";
import { expenseDate } from "@/utils/expenseDate";

const props = defineProps<{
  expense: Expense;
  taskId: string;
  memberNames: Record<string, string>;
  baseCurrency: string;
  canManage: boolean;
}>();

const emit = defineEmits<{ (e: "repeat", expenseId: string): void }>();

/** 整列是連結，按鈕在裡面要擋掉導航，不然會跳去編輯頁。 */
function repeat(event: Event) {
  event.preventDefault();
  event.stopPropagation();
  emit("repeat", props.expense.id);
}

const meta = computed(() => categoryMeta(props.expense.category));
/** 只顯示月/日，年份在任務層級就知道了，列表裡每筆都印年份太吵。 */
const shownDate = computed(() => expenseDate(props.expense).slice(5).replace("-", "/"));
const paidByName = computed(() => props.memberNames[props.expense.paidBy] || "已離開的成員");
const splitCount = computed(() => Object.keys(props.expense.splits).length);
const splitLabel = computed(() =>
  props.expense.splitMode === "custom" ? `${splitCount.value} 人自訂` : `${splitCount.value} 人均分`
);
/** 外幣才需要顯示換算後金額，同幣別顯示原金額就夠了。 */
const converted = computed(() =>
  props.expense.currency !== props.baseCurrency && props.expense.baseAmount !== null
    ? formatAmount(props.expense.baseAmount, props.baseCurrency)
    : null
);
const missingRate = computed(
  () => props.expense.currency !== props.baseCurrency && props.expense.baseAmount === null
);
</script>

<template>
  <!--
    整張卡片可點是既有的操作方式，但 <a> 依規範不能包互動元素，
    所以用 stretched link：連結本身只放在標題上，再用 ::after 覆蓋整張卡，
    「再記一筆」則疊在它上面。這樣兩個動作都能點，HTML 也是合法的。
  -->
  <div v-if="canManage" class="card expense-row">
    <span class="icon" :aria-label="meta.label">{{ meta.icon }}</span>
    <div class="body">
      <strong>
        <RouterLink :to="`/tasks/${taskId}/expenses/${expense.id}/edit`" class="stretch">
          {{ expense.title }}
        </RouterLink>
      </strong>
      <p class="tiny">{{ shownDate }} · {{ meta.label }} · {{ paidByName }} 先付 · {{ splitLabel }}</p>
      <p v-if="expense.place" class="tiny place">📍 {{ expense.place.name }}</p>
      <!-- 只標示有沒有，不放縮圖：一天十筆就是十個網路請求，漫遊網路下會很難看。 -->
      <p v-if="expense.receipt" class="tiny">📎 有收據</p>
      <p v-if="expense.note" class="tiny note">📝 {{ expense.note }}</p>
      <button type="button" class="repeat tiny" @click="repeat">再記一筆</button>
    </div>
    <div class="amount">
      <strong>{{ formatAmount(expense.amount, expense.currency) }}</strong>
      <p class="tiny">
        {{ expense.currency }}
        <template v-if="converted"> · ≈ {{ baseCurrency }} {{ converted }}</template>
        <span v-else-if="missingRate" class="warn">未換算</span>
      </p>
    </div>
  </div>

  <div v-else class="card expense-row">
    <span class="icon" :aria-label="meta.label">{{ meta.icon }}</span>
    <div class="body">
      <strong>{{ expense.title }}</strong>
      <p class="tiny">{{ shownDate }} · {{ meta.label }} · {{ paidByName }} 先付 · {{ splitLabel }}</p>
      <p v-if="expense.place" class="tiny place">📍 {{ expense.place.name }}</p>
      <!-- 只標示有沒有，不放縮圖：一天十筆就是十個網路請求，漫遊網路下會很難看。 -->
      <p v-if="expense.receipt" class="tiny">📎 有收據</p>
      <p v-if="expense.note" class="tiny note">📝 {{ expense.note }}</p>
      <button type="button" class="repeat tiny" @click="repeat">再記一筆</button>
    </div>
    <div class="amount">
      <strong>{{ formatAmount(expense.amount, expense.currency) }}</strong>
      <p class="tiny">
        {{ expense.currency }}
        <template v-if="converted"> · ≈ {{ baseCurrency }} {{ converted }}</template>
        <span v-else-if="missingRate" class="warn">未換算</span>
      </p>
    </div>
  </div>
</template>

<style scoped>
.expense-row {
  /* stretch 的 ::after 要靠這個定位，少了它覆蓋層會跑去對齊 viewport。 */
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  box-shadow: none;
}

.icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 42px;
  height: 42px;
  border-radius: 14px;
  background: var(--color-primary-soft);
  font-size: 20px;
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

.body .tiny {
  margin: 0;
}

.place {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 備註可以到 500 字，列表一定要截成一行，不然一筆就佔滿整個畫面。 */
.note {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.repeat {
  /* 疊在 stretch 的覆蓋層之上，不然會點到編輯。 */
  position: relative;
  z-index: 1;
  margin-top: 6px;
  padding: 3px 10px;
  border: 1px solid var(--color-line-strong);
  border-radius: 999px;
  background: none;
  color: var(--color-muted);
  cursor: pointer;
}

.repeat:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.amount {
  flex: none;
  text-align: right;
}

.amount .tiny {
  margin: 0;
  white-space: nowrap;
}

.warn {
  color: var(--color-danger);
  font-weight: 700;
}
</style>
