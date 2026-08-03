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
  <RouterLink
    v-if="canManage"
    :to="`/tasks/${taskId}/expenses/${expense.id}/edit`"
    class="card expense-row"
  >
    <span class="icon" :aria-label="meta.label">{{ meta.icon }}</span>
    <div class="body">
      <strong>{{ expense.title }}</strong>
      <p class="tiny">{{ shownDate }} · {{ meta.label }} · {{ paidByName }} 先付 · {{ splitLabel }}</p>
      <p v-if="expense.place" class="tiny place">📍 {{ expense.place.name }}</p>
    </div>
    <div class="amount">
      <strong>{{ formatAmount(expense.amount, expense.currency) }}</strong>
      <p class="tiny">
        {{ expense.currency }}
        <template v-if="converted"> · ≈ {{ baseCurrency }} {{ converted }}</template>
        <span v-else-if="missingRate" class="warn">未換算</span>
      </p>
    </div>
  </RouterLink>

  <div v-else class="card expense-row">
    <span class="icon" :aria-label="meta.label">{{ meta.icon }}</span>
    <div class="body">
      <strong>{{ expense.title }}</strong>
      <p class="tiny">{{ shownDate }} · {{ meta.label }} · {{ paidByName }} 先付 · {{ splitLabel }}</p>
      <p v-if="expense.place" class="tiny place">📍 {{ expense.place.name }}</p>
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
