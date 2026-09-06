<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { fetchOverview, type AdminOverview, type AdminRange } from "@/services/adminService";
import LoadingState from "@/components/common/LoadingState.vue";
import ErrorState from "@/components/common/ErrorState.vue";

const RANGES: Array<{ value: AdminRange; label: string }> = [
  { value: "7d", label: "7 天" },
  { value: "30d", label: "30 天" },
  { value: "90d", label: "90 天" }
];

const range = ref<AdminRange>("30d");
const data = ref<AdminOverview | null>(null);
const error = ref<string | null>(null);
const loading = ref(true);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    data.value = await fetchOverview(range.value);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

watch(range, load, { immediate: true });

const number = (n: number) => n.toLocaleString("zh-TW");

/** 有幾天真的有彙總資料。0 代表排程還沒開始寫，那時候不要畫線。 */
const hasSeries = computed(() => (data.value?.coverage.present ?? 0) > 0);

const PLOT = { w: 640, h: 160 };

/**
 * 折線的各段。
 *
 * 缺的那天是 null，而 null 要讓線**斷開**，不是連過去也不是畫成 0 ——
 * 把缺漏畫成 0 會在圖上出現一個插到底的 V 型，看起來像一次事故。
 */
const segments = computed(() => {
  const points = data.value?.dau ?? [];
  if (points.length === 0) return [];

  const values = points.map(p => p.value).filter((v): v is number => v !== null);
  if (values.length === 0) return [];
  const max = Math.max(...values, 1);

  const x = (i: number) => (i / Math.max(points.length - 1, 1)) * PLOT.w;
  const y = (v: number) => PLOT.h - (v / max) * PLOT.h;

  const out: string[] = [];
  let run: string[] = [];
  points.forEach((point, i) => {
    if (point.value === null) {
      if (run.length > 1) out.push(run.join(" "));
      run = [];
      return;
    }
    run.push(`${x(i).toFixed(1)},${y(point.value).toFixed(1)}`);
  });
  if (run.length > 1) out.push(run.join(" "));
  return out;
});

const peak = computed(() => {
  const values = (data.value?.dau ?? []).map(p => p.value).filter((v): v is number => v !== null);
  return values.length ? Math.max(...values) : null;
});
</script>

<template>
  <main class="page">
    <section class="console">
      <header class="topbar">
        <div>
          <h1 class="title">總覽</h1>
          <p v-if="data" class="tiny">
            累計數字為此刻 · 每日資料至 {{ data.through }}
          </p>
        </div>
        <div class="seg" role="group" aria-label="時間區間">
          <button
            v-for="item in RANGES"
            :key="item.value"
            type="button"
            class="seg-item"
            :class="{ active: range === item.value }"
            @click="range = item.value"
          >
            {{ item.label }}
          </button>
        </div>
      </header>

      <LoadingState v-if="loading && !data" title="讀取中" message="正在統計" />
      <ErrorState v-else-if="error" :message="error" retryable :retrying="loading" @retry="load" />

      <template v-else-if="data">
        <div class="tiles">
          <div class="card tile">
            <div class="label">使用者總數</div>
            <div class="value">{{ number(data.totals.users) }}</div>
          </div>
          <div class="card tile">
            <div class="label">進行中任務</div>
            <div class="value">{{ number(data.totals.tasksActive) }}</div>
            <p class="tiny">另有 {{ number(data.totals.tasksArchived) }} 個已封存</p>
          </div>
          <div class="card tile">
            <div class="label">累計支出筆數</div>
            <div class="value">{{ number(data.totals.expenses) }}</div>
          </div>
          <div class="card tile">
            <div class="label">已刪除任務</div>
            <div class="value">{{ number(data.totals.tasksDeleted) }}</div>
            <p class="tiny">軟刪除，資料還在</p>
          </div>
        </div>

        <div class="card">
          <div class="spread">
            <h2 class="card-head">每日活躍使用者</h2>
            <p class="tiny">當天有開啟 app 的帳號數</p>
          </div>

          <!--
            排程還沒開始寫每日彙總的時候，這裡不畫線也不顯示 0。

            那兩種都是在說一件沒有發生的事：0 代表「那天沒有人來」，而實際上
            是「那天還沒有人在數」。這條線唯一的用途就是被拿來做決定。
          -->
          <div v-if="!hasSeries" class="empty accruing">
            <h3 class="section-title">累積中</h3>
            <p class="tiny">
              活躍人數從使用者開啟 app 的那一刻才開始記，沒辦法從既有資料回推。<br />
              這條線會從記錄開始的那天長出來。
            </p>
          </div>

          <svg
            v-else
            class="chart"
            :viewBox="`0 0 ${PLOT.w} ${PLOT.h + 24}`"
            role="img"
            :aria-label="`每日活躍使用者，最高 ${peak}`"
          >
            <line :x1="0" :y1="PLOT.h" :x2="PLOT.w" :y2="PLOT.h" class="axis" />
            <polyline v-for="(points, i) in segments" :key="i" :points="points" class="line" />
          </svg>

          <p v-if="hasSeries && data.coverage.present < data.coverage.expected" class="tiny gap">
            這段期間有
            {{ data.coverage.expected - data.coverage.present }}
            天沒有彙總資料，線在那裡是斷的。
          </p>
        </div>

        <div class="card">
          <h2 class="card-head">使用裝置</h2>
          <div v-if="!data.platforms" class="empty accruing">
            <p class="tiny">跟活躍人數同一個來源，也還在累積。</p>
          </div>
          <ul v-else class="platforms">
            <li><span>網頁版</span><strong>{{ number(data.platforms.web) }}</strong></li>
            <li><span>Android App</span><strong>{{ number(data.platforms.android) }}</strong></li>
            <li><span>iPhone／iPad</span><strong>{{ number(data.platforms.ios) }}</strong></li>
            <li><span>兩者都用</span><strong>{{ number(data.platforms.multi) }}</strong></li>
          </ul>
        </div>
      </template>
    </section>
  </main>
</template>

<style scoped>
/*
  後台不套 .shell 的 820px 上限 —— 那個寬度是為了手機優先的記帳畫面訂的，
  而這裡是只有桌機會開的表格與圖。
*/
.console {
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

/*
  只有一頁的時候不放側邊導覽。一個只有一個項目的選單不是導覽，是裝飾 ——
  等第二頁進來再加。
*/
.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--space-4);
}

.tile .value {
  margin-top: var(--space-text);
  font-size: var(--text-display);
  font-weight: 900;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

.accruing {
  margin-top: var(--space-4);
}

.chart {
  display: block;
  width: 100%;
  height: auto;
  margin-top: var(--space-4);
}

.axis {
  stroke: var(--color-line-strong);
  stroke-width: 1;
}

.line {
  fill: none;
  stroke: var(--color-primary-dark);
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.gap {
  margin-top: var(--space-3);
}

.platforms {
  list-style: none;
  margin: var(--space-4) 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.platforms li {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  font-weight: 700;
}

.platforms strong {
  font-variant-numeric: tabular-nums;
}
</style>
