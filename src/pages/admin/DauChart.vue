<script setup lang="ts">
/**
 * 每日活躍使用者的折線圖。
 *
 * 原本是手刻的 SVG polyline：沒有軸、沒有數值、滑過去什麼都不會發生，看得出
 * 形狀但讀不出任何一個數字。改用結算頁已經在用的 chart.js（同一個動態載入的
 * chunk，後台不多付體積）。
 *
 * 規格照 dataviz 的標準：2px 線、只在 hover 時出現的 10px 端點帶 2px 底色環、
 * 實線的淡格線、十字線對齊日期、提示框裡數字是主角。只有一條線，所以沒有
 * 圖例 —— 卡片標題已經說了它是什麼。
 */
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import type { Chart, Plugin } from "chart.js";
import { dauSummary, shortDate, type DauPoint } from "@/utils/dauChart";

const props = defineProps<{
  points: DauPoint[];
  /** 換區間重新讀取時，舊圖先淡掉而不是閃成空白。 */
  dimmed?: boolean;
}>();

const canvas = ref<HTMLCanvasElement | null>(null);
/** shallowRef：Chart 實例不需要深層響應，包進 reactive 反而會拖慢重繪。 */
const chart = shallowRef<Chart | null>(null);
const failed = ref(false);

const summary = computed(() => dauSummary(props.points));
/** 表格由新到舊：打開來最想看的是最近幾天。 */
const rows = computed(() => [...props.points].reverse());

/**
 * 顏色從 CSS token 讀，不在這裡再寫一次色碼 —— 兩處各寫一份，改版時一定
 * 有一份會被漏掉。讀不到才用後面的預設值。
 */
function token(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/**
 * 十字線：一條垂直的細線對齊到滑鼠最近的那一天。
 *
 * 讀的人瞄準的是日期，不是一條 2px 的線 —— 畫在資料線後面，免得蓋住它。
 */
function crosshair(color: string): Plugin<"line"> {
  return {
    id: "dauCrosshair",
    beforeDatasetsDraw(instance) {
      const active = instance.tooltip?.getActiveElements() ?? [];
      if (!active.length) return;
      const x = active[0].element.x;
      const { top, bottom } = instance.chartArea;
      const ctx = instance.ctx;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.lineWidth = 1;
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.restore();
    }
  };
}

async function render() {
  if (!canvas.value) return;

  let ChartJS: typeof Chart;
  try {
    ({ Chart: ChartJS } = await import("@/services/chartLoader"));
  } catch {
    failed.value = true;
    return;
  }

  const line = token("--color-primary-dark", "#c2410c");
  const surface = token("--color-card", "#ffffff");
  const grid = token("--color-line", "#ede7e0");
  const rule = token("--color-line-strong", "#e2dcd4");
  const muted = token("--color-muted", "#6f665e");
  const ink = token("--color-ink", "#1a1613");

  const dates = props.points.map(point => point.date);

  chart.value?.destroy();
  chart.value = new (ChartJS as any)(canvas.value, {
    type: "line",
    data: {
      labels: dates,
      datasets: [
        {
          // null 就是 null：chart.js 預設 spanGaps: false，線在沒有資料的日子斷開。
          // 把缺漏畫成 0 會出現一個插到底的 V 型，看起來像一次事故。
          data: props.points.map(point => point.value),
          borderColor: line,
          borderWidth: 2,
          borderJoinStyle: "round",
          borderCapStyle: "round",
          tension: 0,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: line,
          pointHoverBorderColor: surface,
          pointHoverBorderWidth: 2,
          pointHitRadius: 12
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 220 },
      // 不必對準那條線：滑鼠在哪個日期上，就讀那一天。
      interaction: { mode: "index", intersect: false },
      layout: { padding: { top: 4, right: 8 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: ink,
          padding: 10,
          displayColors: false,
          titleFont: { size: 14, weight: "bold" },
          bodyFont: { size: 12 },
          callbacks: {
            // 數字在前、日期在後：讀的人已經知道是哪條線，他要的是那個數。
            title: (items: any[]) => `${items[0].parsed.y.toLocaleString("zh-TW")} 人`,
            label: (item: any) => dates[item.dataIndex]
          }
        }
      },
      scales: {
        x: {
          border: { color: rule },
          grid: { display: false },
          ticks: {
            color: muted,
            font: { size: 11 },
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 7,
            callback: (_value: unknown, index: number) => shortDate(dates[index])
          }
        },
        y: {
          beginAtZero: true,
          border: { display: false },
          grid: { color: grid, drawTicks: false },
          ticks: {
            color: muted,
            font: { size: 11 },
            padding: 8,
            precision: 0,
            maxTicksLimit: 5,
            callback: (value: unknown) => Number(value).toLocaleString("zh-TW")
          }
        }
      }
    },
    plugins: [crosshair(rule)]
  });
}

watch([() => props.points, canvas], render, { flush: "post" });
onBeforeUnmount(() => chart.value?.destroy());
</script>

<template>
  <div class="dau" :class="{ dimmed }">
    <p class="tiny">{{ summary }}</p>

    <p v-if="failed" class="tiny warn">圖表載入失敗，下面的數字仍然正確。</p>

    <!-- 高度包含 x 軸那一條：canvas 自己畫軸，容器夠高就不會被裁掉或長出捲軸。 -->
    <div v-else class="plot">
      <canvas ref="canvas" role="img" :aria-label="`每日活躍使用者。${summary}`"></canvas>
    </div>

    <!-- 提示框只是加分：每一天的數字不用滑鼠也讀得到。 -->
    <details class="table-view">
      <summary class="tiny">看每天的數字</summary>
      <table class="days">
        <thead>
          <tr><th>日期</th><th class="r">活躍人數</th></tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.date">
            <td class="tiny num">{{ row.date }}</td>
            <td class="tiny num r">{{ row.value === null ? "沒有資料" : row.value.toLocaleString("zh-TW") }}</td>
          </tr>
        </tbody>
      </table>
    </details>
  </div>
</template>

<style scoped>
.dau {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin-top: var(--space-3);
  transition: opacity 0.2s;
}

.dau.dimmed {
  opacity: 0.5;
}

.dau p {
  margin: 0;
}

.plot {
  position: relative;
  width: 100%;
  height: 220px;
}

.warn {
  color: var(--color-danger);
}

.table-view summary {
  cursor: pointer;
  width: fit-content;
}

.days {
  width: 100%;
  max-width: 320px;
  margin-top: var(--space-2);
  border-collapse: collapse;
}

.days th {
  text-align: left;
  padding: 0 0 var(--space-2);
  border-bottom: 1px solid var(--color-line);
  color: var(--color-muted);
  font-size: var(--text-tiny);
  font-weight: 700;
}

.days td {
  padding: 6px 0;
  border-bottom: 1px solid var(--color-line);
}

.r {
  text-align: right;
}

.num {
  font-variant-numeric: tabular-nums;
}
</style>
