<script setup lang="ts">
/**
 * AI 設定：金鑰、模型、測試、用量、跨使用者的點數紀錄。
 *
 * 金鑰只看得到末四碼 —— 完整的值只有雲端函式讀得到，連這一頁也拿不到。
 */
import { computed, onMounted, ref, watch } from "vue";
import {
  fetchAiConfig,
  fetchAiUsage,
  setAiConfig,
  testAiConfig,
  type AdminAiConfig,
  type AdminAiUsage,
  type AdminRange,
  type AiLedgerFilter,
  type AiTestResult
} from "@/services/adminService";
import LoadingState from "@/components/common/LoadingState.vue";
import ErrorState from "@/components/common/ErrorState.vue";
import EmptyState from "@/components/common/EmptyState.vue";
import { ledgerResultLabel, ledgerTypeLabel } from "@/utils/aiLedger";

const RANGES: Array<{ value: AdminRange; label: string }> = [
  { value: "7d", label: "7 天" },
  { value: "30d", label: "30 天" },
  { value: "90d", label: "90 天" }
];

const FILTERS: Array<{ value: AiLedgerFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "use", label: "辨識" },
  { value: "adjust", label: "調整" },
  { value: "free", label: "免費" }
];

const config = ref<AdminAiConfig | null>(null);
const configError = ref<string | null>(null);

const model = ref("");
const apiKey = ref("");
const reason = ref("");
const saving = ref(false);
const saveError = ref<string | null>(null);
const saved = ref(false);

const testing = ref(false);
const testResult = ref<AiTestResult | null>(null);
const testError = ref<string | null>(null);

const range = ref<AdminRange>("30d");
const filter = ref<AiLedgerFilter>("all");
const usage = ref<AdminAiUsage | null>(null);
const usageError = ref<string | null>(null);
const usageLoading = ref(true);
/** Firestore 的游標是單向的，回上一頁只能靠自己記著來時路。 */
const trail = ref<Array<string | null>>([null]);
const page = ref(0);

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function loadConfig() {
  configError.value = null;
  try {
    config.value = await fetchAiConfig();
    model.value = config.value.model;
  } catch (err) {
    configError.value = message(err);
  }
}

async function loadUsage() {
  usageLoading.value = true;
  usageError.value = null;
  try {
    usage.value = await fetchAiUsage({ range: range.value, type: filter.value, cursor: trail.value[page.value] });
  } catch (err) {
    usageError.value = message(err);
  } finally {
    usageLoading.value = false;
  }
}

function resetUsage() {
  trail.value = [null];
  page.value = 0;
  void loadUsage();
}

onMounted(loadConfig);
watch([range, filter], resetUsage, { immediate: true });

function next() {
  const cursor = usage.value?.cursor;
  if (!cursor) return;
  trail.value = [...trail.value.slice(0, page.value + 1), cursor];
  page.value += 1;
  void loadUsage();
}

function prev() {
  if (page.value === 0) return;
  page.value -= 1;
  void loadUsage();
}

/** 沒設定過時一定要貼金鑰；設定過的話金鑰留空代表只換模型。 */
const canSave = computed(() => {
  if (saving.value || !reason.value.trim() || !model.value) return false;
  const typed = apiKey.value.trim() !== "";
  if (!config.value?.configured) return typed;
  return typed || model.value !== config.value.model;
});

async function save() {
  saving.value = true;
  saveError.value = null;
  saved.value = false;
  try {
    await setAiConfig({ apiKey: apiKey.value.trim() || undefined, model: model.value, reason: reason.value.trim() });
    apiKey.value = "";
    reason.value = "";
    saved.value = true;
    await loadConfig();
  } catch (err) {
    saveError.value = message(err);
  } finally {
    saving.value = false;
  }
}

async function runTest() {
  testing.value = true;
  testError.value = null;
  testResult.value = null;
  try {
    testResult.value = await testAiConfig();
  } catch (err) {
    testError.value = message(err);
  } finally {
    testing.value = false;
  }
}

const now = new Date();
const day = (value: string | null) => (value ? value.slice(0, 16).replace("T", " ") : "—");
const num = (value: number) => value.toLocaleString("zh-TW");
</script>

<template>
  <main class="page">
    <section class="console">
      <header class="topbar">
        <h1 class="title">AI 設定</h1>
      </header>

      <ErrorState v-if="configError" :message="configError" />

      <div v-if="config" class="grid">
        <div class="card stack">
          <h2 class="card-head">金鑰與模型</h2>
          <p v-if="!config.configured" class="tiny warn">
            尚未設定。設定之前，所有人按「用 AI 讀收據」都會看到「AI 辨識還沒有設定好」。
          </p>
          <p v-else class="tiny">
            末四碼 ••••{{ config.keyTail || "????" }}，最後由 {{ config.updatedBy || "—" }} 於
            {{ day(config.updatedAt) }} 更新。
          </p>

          <label class="field">
            <span class="label">模型</span>
            <select v-model="model" class="select">
              <option v-for="item in config.models" :key="item.id" :value="item.id">
                {{ item.label }} —— {{ item.note }}
              </option>
            </select>
          </label>

          <label class="field">
            <span class="label">{{ config.configured ? "新的 API 金鑰（只換模型就留空）" : "OpenAI API 金鑰" }}</span>
            <input v-model="apiKey" class="input" type="password" autocomplete="off" placeholder="sk-..." />
          </label>

          <label class="field">
            <span class="label">理由（必填，會寫進稽核日誌）</span>
            <textarea v-model="reason" class="input" rows="2" maxlength="500"></textarea>
          </label>

          <!-- 存之前後端會用新設定向 OpenAI 驗一次，驗不過就不存。 -->
          <button type="button" class="btn btn-primary" :disabled="!canSave" @click="save">
            {{ saving ? "驗證中..." : "驗證並儲存" }}
          </button>
          <p v-if="saveError" class="tiny warn">{{ saveError }}</p>
          <p v-else-if="saved" class="tiny">已儲存。其他伺服器最慢一分鐘後換成新設定。</p>
        </div>

        <div class="card stack">
          <h2 class="card-head">測試目前的設定</h2>
          <p class="tiny">
            用一段內建的收據文字實際跑一次。只有真的呼叫才看得出帳戶沒錢、金鑰被撤銷。
            每按一次花一點點錢，不扣任何人的點數。
          </p>
          <button type="button" class="btn" :disabled="testing || !config.configured" @click="runTest">
            {{ testing ? "測試中..." : "測試" }}
          </button>
          <p v-if="testError" class="tiny warn">{{ testError }}</p>
          <template v-else-if="testResult">
            <p v-if="!testResult.ok" class="tiny warn">
              失敗（{{ testResult.model }}，{{ testResult.ms }} ms）：{{ testResult.error }}
            </p>
            <div v-else class="tiny">
              <p>
                成功：{{ testResult.model }}，{{ testResult.ms }} ms，token {{ testResult.inputTokens ?? "—" }} /
                {{ testResult.outputTokens ?? "—" }}
              </p>
              <pre class="mono">{{ JSON.stringify(testResult.fields, null, 2) }}</pre>
            </div>
          </template>
        </div>
      </div>

      <div class="card stack">
        <div class="spread">
          <h2 class="card-head">用量</h2>
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
        </div>

        <template v-if="usage">
          <p v-if="usage.recordedDays === 0" class="tiny">
            這段期間還沒有任何紀錄 —— 可能是還沒有人用，也可能是統計剛開始記。
          </p>
          <div class="counts">
            <div><span class="label">辨識</span><strong>{{ num(usage.totals.calls) }}</strong></div>
            <div><span class="label">讀出</span><strong>{{ num(usage.totals.reads) }}</strong></div>
            <div><span class="label">失敗</span><strong>{{ num(usage.totals.failures) }}</strong></div>
            <div>
              <span class="label">token（輸入／輸出）</span>
              <strong>{{ num(usage.totals.inputTokens) }} / {{ num(usage.totals.outputTokens) }}</strong>
            </div>
          </div>
          <p class="tiny">{{ usage.days.from }} 至 {{ usage.days.to }}（算到今天）</p>
        </template>
      </div>

      <div class="card stack">
        <div class="spread">
          <h2 class="card-head">使用報告</h2>
          <div class="seg" role="group" aria-label="類型">
            <button
              v-for="item in FILTERS"
              :key="item.value"
              type="button"
              class="seg-item"
              :class="{ active: filter === item.value }"
              @click="filter = item.value"
            >
              {{ item.label }}
            </button>
          </div>
        </div>

        <LoadingState v-if="usageLoading" title="讀取中" message="正在整理點數紀錄" />
        <ErrorState v-else-if="usageError" :message="usageError" />
        <EmptyState v-else-if="!usage?.rows.length" title="沒有紀錄" message="還沒有人用過 AI 辨識。" />
        <div v-else class="table-wrap">
          <table class="ledger">
            <thead>
              <tr>
                <th>時間</th>
                <th>使用者</th>
                <th>類型</th>
                <th>變動</th>
                <th>餘額</th>
                <th>結果</th>
                <th>token</th>
                <th>理由</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in usage.rows" :key="`${row.uid}/${row.id}`">
                <td class="num">{{ day(row.at) }}</td>
                <td>{{ row.nickname || row.uid }}</td>
                <td>{{ ledgerTypeLabel(row.type) }}</td>
                <td class="num">{{ row.delta > 0 ? `+${row.delta}` : row.delta }}</td>
                <td class="num">{{ row.balanceAfter }}</td>
                <td>{{ ledgerResultLabel(row, now) }}</td>
                <td class="num">
                  {{ row.inputTokens !== null ? `${row.inputTokens} / ${row.outputTokens ?? "—"}` : "" }}
                </td>
                <td>{{ row.reason ?? "" }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="pager">
          <button type="button" class="btn btn-sm" :disabled="page === 0 || usageLoading" @click="prev">上一頁</button>
          <button type="button" class="btn btn-sm" :disabled="!usage?.cursor || usageLoading" @click="next">
            下一頁
          </button>
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: var(--space-4);
}

.counts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-6);
}

.counts div {
  display: flex;
  flex-direction: column;
}

.table-wrap {
  overflow-x: auto;
}

.ledger {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-tiny);
}

.ledger th,
.ledger td {
  padding: var(--space-2);
  border-bottom: 1px solid var(--color-line);
  text-align: left;
  white-space: nowrap;
}

.pager {
  display: flex;
  gap: var(--space-2);
  justify-content: flex-end;
}

.mono {
  white-space: pre-wrap;
  font-size: var(--text-tiny);
}

.warn {
  color: var(--color-danger);
}
</style>
