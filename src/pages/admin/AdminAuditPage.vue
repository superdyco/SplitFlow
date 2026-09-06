<script setup lang="ts">
import { ref, watch } from "vue";
import { fetchAudit, type AuditFilter, type AuditResult, type AuditRow } from "@/services/adminService";
import LoadingState from "@/components/common/LoadingState.vue";
import ErrorState from "@/components/common/ErrorState.vue";
import EmptyState from "@/components/common/EmptyState.vue";

const FILTERS: Array<{ value: AuditFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "act", label: "只看處置" },
  { value: "view", label: "只看檢視" }
];

const ACTION_LABELS: Record<string, string> = {
  "view.user": "檢視使用者",
  "view.task": "檢視任務",
  "view.report": "檢視報告",
  "export.stats": "讀取統計",
  "act.revokeReport": "撤下公開報告",
  "act.disableUser": "停用帳號",
  "act.archiveTask": "強制封存任務",
  "denied.access": "被擋下的存取"
};

const filter = ref<AuditFilter>("all");
const data = ref<AuditResult | null>(null);
const error = ref<string | null>(null);
const loading = ref(true);

/** Firestore 的游標是單向的，回上一頁只能靠自己記著來時路。 */
const trail = ref<Array<string | null>>([null]);
const page = ref(0);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    data.value = await fetchAudit({ filter: filter.value, cursor: trail.value[page.value] });
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

watch(filter, () => {
  trail.value = [null];
  page.value = 0;
  void load();
});

function next() {
  const cursor = data.value?.cursor;
  if (!cursor) return;
  trail.value = [...trail.value.slice(0, page.value + 1), cursor];
  page.value += 1;
  void load();
}

function prev() {
  if (page.value === 0) return;
  page.value -= 1;
  void load();
}

load();

function when(value: string | null): string {
  if (!value) return "—";
  // 只到分鐘。秒數在這張表上不解釋任何事情，卻讓每一列變寬。
  return value.slice(0, 16).replace("T", " ");
}

function label(row: AuditRow): string {
  return ACTION_LABELS[row.action] ?? row.action;
}
</script>

<template>
  <main class="page">
    <section class="console">
      <header class="topbar">
        <div>
          <h1 class="title">稽核日誌</h1>
          <p class="tiny">管理者在這個後台做過的每一件事，包含只是打開來看。</p>
        </div>
        <div class="seg" role="group" aria-label="篩選">
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
      </header>

      <div v-if="data" class="tiles">
        <div class="card tile">
          <div class="label">本月檢視</div>
          <div class="value">{{ data.monthly.views }}</div>
        </div>
        <div class="card tile">
          <div class="label">本月處置</div>
          <div class="value">{{ data.monthly.acts }}</div>
        </div>
        <div class="card tile">
          <div class="label">本月被擋下的存取</div>
          <div class="value">{{ data.monthly.denied }}</div>
        </div>
      </div>

      <div class="card">
        <LoadingState v-if="loading && !data" title="讀取中" message="正在查詢" />
        <ErrorState
          v-else-if="error"
          :message="error"
          retryable
          :retrying="loading"
          @retry="load"
        />
        <EmptyState
          v-else-if="data && data.rows.length === 0"
          title="這裡還沒有紀錄"
          message="打開任何一個人的詳情，就會在這裡留下一筆。"
        />

        <template v-else-if="data">
          <table class="tbl">
            <thead>
              <tr>
                <th>時間</th>
                <th>管理者</th>
                <th>動作</th>
                <th>對象</th>
                <th>理由</th>
                <th>來源</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in data.rows" :key="row.id" :class="{ act: row.kind !== 'view' }">
                <td class="tiny num">{{ when(row.at) }}</td>
                <td class="who">{{ row.adminEmail || row.adminUid || "—" }}</td>
                <td>
                  <span class="pill" :class="row.kind">{{ label(row) }}</span>
                </td>
                <td class="target">{{ row.targetLabel || row.targetId }}</td>
                <td class="tiny">{{ row.reason || "—" }}</td>
                <td class="tiny num">{{ row.ip || "—" }}</td>
              </tr>
            </tbody>
          </table>

          <div class="pager">
            <p class="tiny">第 {{ page + 1 }} 頁</p>
            <div class="pager-btns">
              <button type="button" class="btn btn-sm" :disabled="page === 0" @click="prev">
                上一頁
              </button>
              <button type="button" class="btn btn-sm" :disabled="!data.cursor" @click="next">
                下一頁
              </button>
            </div>
          </div>
        </template>
      </div>

      <!--
        這段是規格不是說明。這份日誌的意義建立在「沒有任何登入身分改得動它」
        之上 —— 那件事看不見，所以要寫出來。
      -->
      <div class="card note">
        <h2 class="card-head">為什麼連「只是看一下」也要記</h2>
        <p class="tiny">
          因為這個後台看得到全部使用者的資料，所以「有沒有動手」不是唯一該追的事，
          「看了誰」同樣是。這份日誌由後端寫入，管理者本人也不能修改或刪除 ——
          規則層對它是
          <span class="mono">allow read, write: if false</span>，只有 Admin SDK 寫得進去，
          而讀只能透過這一頁。保存 400 天後自動刪除。
        </p>
      </div>
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

.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--space-4);
}

.tile .value {
  margin-top: var(--space-text);
  font-size: var(--text-display);
  font-weight: 900;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

.tbl {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
}

.tbl th {
  text-align: left;
  padding: 0 var(--space-3) var(--space-2) 0;
  border-bottom: 1px solid var(--color-line);
  color: var(--color-muted);
  font-size: var(--text-tiny);
  font-weight: 700;
  white-space: nowrap;
}

.tbl td {
  padding: var(--space-3) var(--space-3) var(--space-3) 0;
  border-bottom: 1px solid var(--color-line);
  vertical-align: middle;
}

.tbl th:first-child,
.tbl td:first-child {
  padding-left: var(--space-2);
}

.tbl th:last-child,
.tbl td:last-child {
  padding-right: var(--space-2);
}

.tbl tbody tr:last-child td {
  border-bottom: 0;
}

/* 動到別人東西的那幾列要一眼看得出來 —— 一份全部長一樣的日誌等於沒有重點。 */
.tbl tbody tr.act td {
  background: var(--color-danger-soft);
}

.tbl tbody tr.act td:first-child {
  border-radius: var(--radius-sm) 0 0 var(--radius-sm);
}

.tbl tbody tr.act td:last-child {
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}

.who,
.target {
  font-weight: 700;
  font-size: var(--text-control-sm);
}

.num {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.pill {
  display: inline-block;
  border-radius: var(--radius-pill);
  padding: 4px 10px;
  background: var(--color-track);
  color: var(--color-muted);
  font-size: var(--text-tiny);
  font-weight: 700;
  white-space: nowrap;
}

.pill.act,
.pill.denied {
  background: var(--color-danger-soft);
  color: var(--color-danger);
}

.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-top: var(--space-4);
  padding-top: var(--space-4);
  border-top: 1px solid var(--color-line);
}

.pager-btns {
  display: flex;
  gap: var(--space-2);
}

.note .tiny {
  margin: var(--space-2) 0 0;
  max-width: 900px;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 700;
  color: var(--color-ink);
}
</style>
