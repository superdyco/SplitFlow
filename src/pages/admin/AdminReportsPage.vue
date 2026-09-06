<script setup lang="ts">
import { ref, watch } from "vue";
import {
  fetchReports,
  revokeReport,
  type AdminReportRow,
  type AdminReportsResult,
  type ReportFilter
} from "@/services/adminService";
import LoadingState from "@/components/common/LoadingState.vue";
import ErrorState from "@/components/common/ErrorState.vue";
import EmptyState from "@/components/common/EmptyState.vue";
import AdminActionDialog from "@/pages/admin/AdminActionDialog.vue";

const FILTERS: Array<{ value: ReportFilter; label: string }> = [
  { value: "listed", label: "探索頁上的" },
  { value: "linked", label: "只給連結" },
  { value: "revoked", label: "已撤下" },
  { value: "all", label: "全部" }
];

const filter = ref<ReportFilter>("listed");
const data = ref<AdminReportsResult | null>(null);
const error = ref<string | null>(null);
const loading = ref(true);

const trail = ref<Array<string | null>>([null]);
const page = ref(0);

const target = ref<AdminReportRow | null>(null);
const acting = ref(false);
const actionError = ref<string | null>(null);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    data.value = await fetchReports({ filter: filter.value, cursor: trail.value[page.value] });
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

function reset() {
  trail.value = [null];
  page.value = 0;
  void load();
}

// immediate: true —— 初次載入跟換篩選走同一個入口，不會有「忘了發車」的版本。
watch(filter, reset, { immediate: true });

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

async function confirmRevoke(reason: string) {
  const row = target.value;
  if (!row) return;
  acting.value = true;
  actionError.value = null;
  try {
    await revokeReport(row.taskId, row.reportId, reason);
    target.value = null;
    await load();
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : String(err);
  } finally {
    acting.value = false;
  }
}

const money = (amount: number, currency: string) =>
  `${currency} ${(amount / 100).toLocaleString("zh-TW", { maximumFractionDigits: 0 })}`;

const day = (value: string | null) => (value ? value.slice(0, 10) : "—");
</script>

<template>
  <main class="page">
    <section class="console">
      <header class="topbar">
        <div>
          <h1 class="title">公開報告</h1>
          <p class="tiny">使用者自己按下分享才會出現在這裡。</p>
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

      <!--
        這一條不是說明，是在講一個設計稿承諾過但不存在的東西。設計稿上有
        「被檢舉」的分頁與檢舉理由 —— app 裡沒有任何地方讓使用者檢舉報告。
        不寫的話，下一個看設計稿的人會以為這個分頁被漏掉了。
      -->
      <p class="tiny note">
        沒有「被檢舉」這一項：目前 app 裡沒有任何地方讓使用者檢舉報告。要有那個分頁，
        得先做面向使用者的檢舉功能（按鈕、理由、寫進哪裡、誰看得到）。
      </p>

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
          title="這個分頁沒有報告"
          message="換一個分頁看看。"
        />

        <template v-else-if="data">
          <table class="tbl">
            <thead>
              <tr>
                <th>報告</th>
                <th>發布者</th>
                <th class="r">天數</th>
                <th class="r">支出</th>
                <th class="r">總額</th>
                <th class="r">最後更新</th>
                <th class="r">狀態</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in data.rows" :key="`${row.taskId}/${row.reportId}`">
                <td>
                  <div class="name">{{ row.taskName || "（沒有名稱）" }}</div>
                  <div class="tiny">{{ row.memberCount }} 人 · 建立於 {{ day(row.createdAt) }}</div>
                </td>
                <td class="tiny">{{ data.owners[row.taskId] || "—" }}</td>
                <td class="tiny r num">{{ row.days ?? "—" }}</td>
                <td class="tiny r num">{{ row.expenseCount }}</td>
                <td class="tiny r num">{{ money(row.total, row.currency) }}</td>
                <td class="tiny r num">{{ day(row.updatedAt) }}</td>
                <td class="r">
                  <span v-if="!row.active" class="pill off">已撤下</span>
                  <span v-else-if="row.listed" class="pill on">探索頁</span>
                  <span v-else class="pill">只給連結</span>
                </td>
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

      <div v-if="data && data.rows.length" class="card">
        <h2 class="card-head">要撤下哪一份</h2>
        <p class="tiny">
          撤下後連結立刻失效、從探索頁移除。任務本身、支出與分攤完全不動，成員照常使用。
          發布者收得到通知，也可以修正後自己重新分享 —— 這不是永久封鎖。
        </p>
        <ul class="picks">
          <li v-for="row in data.rows.filter(r => r.active)" :key="`${row.taskId}/${row.reportId}`">
            <span class="name">{{ row.taskName || "（沒有名稱）" }}</span>
            <a
              class="open"
              :href="`/r/${row.taskId}/${row.reportId}`"
              target="_blank"
              rel="noopener"
            >
              開啟報告
            </a>
            <button type="button" class="btn btn-sm btn-danger" @click="target = row">
              撤下分享
            </button>
          </li>
        </ul>
      </div>
    </section>

    <AdminActionDialog
      :open="!!target"
      :title="`撤下「${target?.taskName ?? ''}」的旅費報告`"
      message="連結會立刻失效，也會從探索頁移除。任務本身、支出與分攤都不動，成員照常使用。發布者可以修正後自己重新分享。"
      confirm-label="確認撤下"
      :busy="acting"
      :error="actionError"
      @cancel="target = null"
      @confirm="confirmRevoke"
    />
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

.note {
  margin: 0;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  border: 1px solid var(--color-line);
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

.tbl .r {
  text-align: right;
}

.tbl tbody tr:last-child td {
  border-bottom: 0;
}

.name {
  font-weight: 800;
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

.pill.on {
  background: var(--color-success-soft);
  color: var(--color-success);
}

.pill.off {
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

.picks {
  list-style: none;
  margin: var(--space-4) 0 0;
  padding: 0;
}

.picks li {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--color-line);
}

.picks li:last-child {
  border-bottom: 0;
}

.picks .name {
  flex-grow: 1;
  font-size: var(--text-control-sm);
}

.open {
  font-size: var(--text-control-sm);
  font-weight: 700;
}
</style>
