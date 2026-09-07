<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { fetchHealth, type AdminHealth, type AdminRange } from "@/services/adminService";
import LoadingState from "@/components/common/LoadingState.vue";
import ErrorState from "@/components/common/ErrorState.vue";
import EmptyState from "@/components/common/EmptyState.vue";

const PAGE_LABELS: Record<string, string> = {
  tasks: "任務列表 /tasks",
  task: "單一任務 /tasks/:id"
};

const PHASE_LABELS: Record<string, string> = {
  auth: "還原登入狀態",
  profile: "讀個人檔案",
  chunk: "下載頁面程式碼",
  query: "查詢資料",
  render: "畫面渲染"
};

const RANGES: Array<{ value: AdminRange; label: string }> = [
  { value: "7d", label: "7 天" },
  { value: "30d", label: "30 天" },
  { value: "90d", label: "90 天" }
];

/*
  預設 7 天而不是跟總覽一樣的 30 天。這一頁回答的是「現在有沒有變慢」，
  而那個問題的答案會被三個月的資料稀釋掉 —— 上週開始變慢的頁面，在 90 天的
  p95 裡幾乎看不出來。
*/
const range = ref<AdminRange>("7d");
const data = ref<AdminHealth | null>(null);
const error = ref<string | null>(null);
const loading = ref(true);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    data.value = await fetchHealth(range.value);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

watch(range, load, { immediate: true });

const seconds = (ms: number) => `${(ms / 1000).toFixed(2)} 秒`;

/*
  缺三天以內就把日期唸出來，再多只講幾天 —— 一行列出二十個日期沒有人讀得完，
  而讀不完的警告等於沒有警告。
*/
const gap = computed(() => {
  const days = data.value?.missingDays ?? [];
  if (days.length === 0) return null;
  const which = days.length <= 3 ? days.join("、") : `${days[0]} 等 ${days.length} 天`;
  return `${which}的彙總沒有跑成，下面的數字不含那幾天。`;
});
</script>

<template>
  <main class="page">
    <section class="console">
      <header class="topbar">
        <div>
          <h1 class="title">系統健康</h1>
          <p v-if="data" class="tiny">
            {{ data.days.from }} 至 {{ data.days.to }} · {{ data.total.toLocaleString("zh-TW") }} 筆樣本
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

      <!--
        排程沒跑成的那幾天。少一天的結果是一個看起來完全正常、只是不是你
        以為的那個區間的數字 —— 那種錯誤沒有症狀，只能靠講出來。
      -->
      <p v-if="gap" class="tiny gap">{{ gap }}</p>

      <LoadingState v-if="loading && !data" title="讀取中" message="正在統計" />
      <ErrorState v-else-if="error" :message="error" retryable :retrying="loading" @retry="load" />

      <template v-else-if="data">
        <EmptyState
          v-if="data.pages.length === 0"
          title="這段期間沒有樣本"
          message="效能樣本只在正式站產生，而且只追任務列表與單一任務兩頁。"
        />

        <div v-for="summary in data.pages" :key="summary.page" class="card">
          <div class="spread">
            <h2 class="card-head">{{ PAGE_LABELS[summary.page] ?? summary.page }}</h2>
            <p class="tiny">{{ summary.count.toLocaleString("zh-TW") }} 筆</p>
          </div>

          <dl class="stats">
            <div><dt>p50</dt><dd>{{ seconds(summary.p50) }}</dd></div>
            <div><dt>p75</dt><dd>{{ seconds(summary.p75) }}</dd></div>
            <div><dt>p95</dt><dd>{{ seconds(summary.p95) }}</dd></div>
          </dl>

          <div class="cold">
            <div>
              <span class="label">冷啟動 p50</span>
              <!--
                樣本不足時後端回 null。顯示「樣本不足」而不是一個數字 ——
                三筆算出來的中位數不是統計是巧合，而畫面上的數字看起來一樣確定。
              -->
              <strong>{{ summary.coldP50 === null ? "樣本不足" : seconds(summary.coldP50) }}</strong>
              <span class="tiny">{{ summary.coldCount }} 筆</span>
            </div>
            <div>
              <span class="label">熱啟動 p50</span>
              <strong>{{ summary.warmP50 === null ? "樣本不足" : seconds(summary.warmP50) }}</strong>
              <span class="tiny">{{ summary.count - summary.coldCount }} 筆</span>
            </div>
          </div>

          <div v-if="summary.slowest.length" class="slowest">
            <h3 class="label">最慢的那一段，各出現幾次</h3>
            <ul>
              <li v-for="item in summary.slowest" :key="item.phase">
                <span class="phase">{{ PHASE_LABELS[item.phase] ?? item.phase }}</span>
                <span class="track">
                  <span
                    class="fill"
                    :style="{ width: `${Math.round((item.count / summary.count) * 100)}%` }"
                  ></span>
                </span>
                <span class="tiny num">{{ item.count }}</span>
              </li>
            </ul>
          </div>
        </div>

        <!--
          這一頁少了什麼由後端說。前端寫死的話，等它做好了那句話會留在畫面上
          沒人記得拿掉。
        -->
        <!--
          數字是從每日直方圖算出來的，不是從原始樣本。講出誤差不是免責聲明 ——
          兩位小數的秒數看起來精確到 10 毫秒，而它不是，那個精確度會被當真。
        -->
        <p v-if="data.pages.length" class="tiny bucket">
          百分位數由每日彙總的 {{ data.bucketMs }} 毫秒分桶算出，最多高估
          {{ data.bucketMs }} 毫秒。誤差的方向固定 —— 寧可看起來比實際慢。
        </p>

        <div class="card missing">
          <h2 class="card-head">這一頁還沒有的東西</h2>
          <ul>
            <li v-for="(item, i) in data.missing" :key="i" class="tiny">{{ item }}</li>
          </ul>
        </div>
      </template>
    </section>
  </main>
</template>

<style scoped>
.console {
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-4);
  margin: var(--space-4) 0 0;
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--color-line);
}

.stats dt {
  color: var(--color-muted);
  font-size: var(--text-tiny);
  font-weight: 700;
}

.stats dd {
  margin: var(--space-text) 0 0;
  font-size: var(--text-section);
  font-weight: 900;
  font-variant-numeric: tabular-nums;
}

.cold {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
  padding: var(--space-4) 0;
  border-bottom: 1px solid var(--color-line);
}

.cold strong {
  display: block;
  margin-top: var(--space-text);
  font-size: var(--text-card);
  font-variant-numeric: tabular-nums;
}

.slowest {
  margin-top: var(--space-4);
}

.slowest ul {
  list-style: none;
  margin: var(--space-3) 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.slowest li {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.phase {
  width: 130px;
  flex: none;
  font-size: var(--text-control-sm);
  font-weight: 700;
}

.track {
  flex-grow: 1;
  height: 10px;
  border-radius: var(--radius-pill);
  background: var(--color-track);
  overflow: hidden;
}

.fill {
  display: block;
  height: 100%;
  border-radius: var(--radius-pill);
  background: var(--color-primary-b1);
}

.num {
  width: 48px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.gap {
  margin: 0;
  border-radius: var(--radius-md);
  background: var(--color-danger-soft);
  border: 1px solid var(--color-danger-line);
  padding: var(--space-3) var(--space-4);
  color: var(--color-ink);
}

.bucket {
  margin: 0;
  padding: 0 var(--space-1);
}

.missing ul {
  list-style: disc;
  margin: var(--space-3) 0 0;
  padding-left: var(--space-6);
}

.missing li {
  margin-bottom: var(--space-2);
}
</style>
