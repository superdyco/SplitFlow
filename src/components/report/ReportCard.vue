<script setup lang="ts">
/**
 * 一份旅費報告在清單裡的樣子。探索頁與收藏頁共用。
 *
 * 兩邊的資料來源不同（一個是報告文件、一個是收藏的快照），所以這裡只收
 * 攤平後的顯示欄位，不收整份 report 物件 —— 收整份的話這個元件就得認得
 * 兩種形狀，而它們遲早會分岔。
 *
 * 動作按鈕走 slot：探索頁要「收藏／已收藏」，收藏頁要「移除」，
 * 塞成 props 會變成一堆互斥的旗標。
 */
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { formatAmount } from "@/utils/currency";

const props = defineProps<{
  taskName: string;
  currency: string;
  startDate: string | null;
  endDate: string | null;
  days: number | null;
  memberCount: number;
  total: number;
  /** 站內路徑，例如 /r/{taskId}/{reportId}。 */
  path: string;
}>();

const dateRange = computed(() => {
  if (!props.startDate || !props.endDate) return "";
  return `${props.startDate} – ${props.endDate}`;
});

/** 天數、人數這種一定有的先放，日期沒填就整段不出現，不要留一個空的分隔點。 */
const facts = computed(() => {
  const items = [`${props.memberCount} 人`];
  if (props.days) items.push(`${props.days} 天`);
  return items.join(" · ");
});
</script>

<template>
  <article class="card stack report-card">
    <div class="spread">
      <div class="grow">
        <RouterLink :to="path" class="name">{{ taskName }}</RouterLink>
        <p class="tiny">{{ facts }}</p>
        <p v-if="dateRange" class="tiny muted">{{ dateRange }}</p>
      </div>
      <div class="amount">
        <span class="tiny">{{ currency }}</span>
        <strong class="figure">{{ formatAmount(total, currency) }}</strong>
      </div>
    </div>

    <div class="row wrap actions">
      <RouterLink :to="path" class="btn btn-sm">看旅程</RouterLink>
      <slot name="actions" />
    </div>
  </article>
</template>

<style scoped>
.report-card {
  gap: var(--space-3);
}

.name {
  display: block;
  font-size: 16px;
  font-weight: 700;
  color: inherit;
  text-decoration: none;
}

.name:hover {
  text-decoration: underline;
}

.grow {
  min-width: 0;
}

.amount {
  display: flex;
  flex: none;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--space-text);
  text-align: right;
}

.figure {
  font-size: 18px;
  font-variant-numeric: tabular-nums;
}

.actions {
  gap: var(--space-2);
}
</style>
