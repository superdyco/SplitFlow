<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import type { Chart } from "chart.js";
import type { Expense } from "@/types/expense";
import { categoryMeta } from "@/types/expense";
import { formatAmount } from "@/utils/currency";
import { categoryTotals } from "@/utils/categoryTotals";

const props = defineProps<{
  expenses: Expense[];
  currency: string;
}>();

const canvas = ref<HTMLCanvasElement | null>(null);
/** shallowRef：Chart 實例不需要深層響應，包進 reactive 反而會拖慢重繪。 */
const chart = shallowRef<Chart | null>(null);
const failed = ref(false);

const rows = computed(() => categoryTotals(props.expenses, props.currency));

const labels = computed(() => rows.value.map(row => categoryMeta(row.category).label));
const values = computed(() => rows.value.map(row => row.total));

/** 讀螢幕的人拿不到 canvas 裡的內容，用一句話把前幾名講完。 */
const summary = computed(() => {
  if (!rows.value.length) return "沒有可以統計的支出";
  const parts = rows.value.map(
    row =>
      `${categoryMeta(row.category).label} ${props.currency} ${formatAmount(row.total, props.currency)}，佔 ${Math.round(row.share)}%`
  );
  return `各分類支出：${parts.join("；")}`;
});

async function render() {
  if (!canvas.value || !rows.value.length) return;

  let ChartJS: typeof Chart;
  try {
    // 動態載入：沒點開結算頁的人不用下載圖表程式碼。
    // 走 chartLoader 而不是直接 import("chart.js")，後者拿到的是整個
    // namespace，Rollup 搖不掉沒用到的 controller。
    ({ Chart: ChartJS } = await import("@/services/chartLoader"));
  } catch {
    failed.value = true;
    return;
  }

  chart.value?.destroy();
  chart.value = new (ChartJS as any)(canvas.value, {
    type: "bar",
    data: {
      labels: labels.value,
      datasets: [
        {
          data: values.value,
          // 分類沒有天然順序，所以每條同色。越大越深會把長度已經表達的
          // 資訊重複編碼一次，而且會佔掉唯一一個還沒用到的視覺通道。
          backgroundColor: "#e8590c",
          borderRadius: 4,
          // 只有資料端要圓角，貼著基準線的那端保持方角才「錨定」得住。
          // borderSkipped: false 會四個角全圓，看起來像漂浮的膠囊。
          borderSkipped: "start",
          barPercentage: 0.72,
          categoryPercentage: 0.82
        }
      ]
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 220 },
      layout: { padding: { right: 4 } },
      plugins: {
        legend: { display: false }, // 只有一組資料，標題已經說明它是什麼
        tooltip: {
          backgroundColor: "#1a1613",
          padding: 10,
          displayColors: false,
          callbacks: {
            label: (item: any) => {
              const row = rows.value[item.dataIndex];
              const amount = `${props.currency} ${formatAmount(row.total, props.currency)}`;
              return `${amount} · ${Math.round(row.share)}%`;
            }
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          border: { display: false },
          grid: { color: "#ede7e0", drawTicks: false },
          ticks: {
            color: "#8a8078",
            font: { size: 11 },
            padding: 6,
            callback: (value: any) => formatAmount(Number(value), props.currency)
          }
        },
        y: {
          border: { display: false },
          grid: { display: false },
          ticks: { color: "#1a1613", font: { size: 12 }, padding: 4 }
        }
      }
    }
  });
}

watch([rows, canvas], render, { flush: "post" });
onBeforeUnmount(() => chart.value?.destroy());
</script>

<template>
  <section v-if="rows.length" class="card stack">
    <div class="spread">
      <strong class="section-title">各分類支出</strong>
      <span class="tiny">{{ currency }}</span>
    </div>

    <p v-if="failed" class="tiny warn">圖表載入失敗，下面的金額仍然正確。</p>

    <div v-else class="plot" :style="{ height: `${rows.length * 38 + 44}px` }">
      <canvas ref="canvas" role="img" :aria-label="summary"></canvas>
    </div>

    <ul class="legend tiny">
      <li v-for="row in rows" :key="row.category">
        <span>{{ categoryMeta(row.category).icon }} {{ categoryMeta(row.category).label }}</span>
        <span class="figure">
          {{ formatAmount(row.total, currency) }}
          <span class="muted-share">{{ Math.round(row.share) }}%</span>
        </span>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.plot {
  position: relative;
  width: 100%;
}

.legend {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.legend li {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  padding-top: 6px;
  border-top: 1px solid var(--color-line);
}

.legend li:first-child {
  border-top: 0;
}

.figure {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.muted-share {
  color: var(--color-muted);
  margin-left: 6px;
}

.warn {
  color: var(--color-danger);
}
</style>
