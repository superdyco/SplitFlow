<script setup lang="ts">
import { computed } from "vue";
import type { ExpenseGroup } from "@/utils/expenseGroups";
import { formatAmount } from "@/utils/currency";

const props = defineProps<{
  group: ExpenseGroup;
  currency: string;
  open: boolean;
}>();

defineEmits<{ (e: "toggle", date: string): void }>();

/** 標題只給月/日與星期，年份在任務層級就知道了。 */
const label = computed(() => {
  const [year, month, day] = props.group.date.split("-").map(Number);
  if (!year || !month || !day) return props.group.date || "沒有日期";
  const weekday = "日一二三四五六"[new Date(year, month - 1, day).getDay()];
  return `${month}/${day}（${weekday}）`;
});
</script>

<template>
  <div class="group">
    <button type="button" class="head" :aria-expanded="open" @click="$emit('toggle', group.date)">
      <span class="chevron" aria-hidden="true">{{ open ? "▾" : "▸" }}</span>
      <strong>{{ label }}</strong>
      <span class="meta tiny">
        {{ group.count }} 筆 · {{ formatAmount(group.total, currency) }}
        <span v-if="group.hasUnconverted" class="warn">·未換算</span>
      </span>
    </button>

    <div v-if="open" class="items">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.group {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  padding: 4px 2px;
  border: 0;
  background: none;
  color: var(--color-ink);
  text-align: left;
  cursor: pointer;
}

.chevron {
  color: var(--color-soft);
  flex: none;
}

.meta {
  margin-left: auto;
  flex: none;
  color: var(--color-muted);
  font-variant-numeric: tabular-nums;
}

.warn {
  color: var(--color-danger);
  margin-left: 4px;
}

.items {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
</style>
