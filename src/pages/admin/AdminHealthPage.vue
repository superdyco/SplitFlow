<script setup lang="ts">
import { ref } from "vue";
import { fetchHealth, type AdminHealth } from "@/services/adminService";
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

const data = ref<AdminHealth | null>(null);
const error = ref<string | null>(null);
const loading = ref(true);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    data.value = await fetchHealth();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

load();

const seconds = (ms: number) => `${(ms / 1000).toFixed(2)} 秒`;
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
      </header>

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

.missing ul {
  list-style: disc;
  margin: var(--space-3) 0 0;
  padding-left: var(--space-6);
}

.missing li {
  margin-bottom: var(--space-2);
}
</style>
