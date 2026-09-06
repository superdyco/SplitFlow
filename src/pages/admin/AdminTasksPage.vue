<script setup lang="ts">
import { ref, watch } from "vue";
import {
  archiveTask,
  fetchTask,
  fetchTasks,
  type AdminTaskDetail,
  type AdminTaskRow,
  type AdminTasksResult,
  type TaskFilter
} from "@/services/adminService";
import LoadingState from "@/components/common/LoadingState.vue";
import ErrorState from "@/components/common/ErrorState.vue";
import EmptyState from "@/components/common/EmptyState.vue";
import AdminActionDialog from "@/pages/admin/AdminActionDialog.vue";

const FILTERS: Array<{ value: TaskFilter; label: string }> = [
  { value: "active", label: "進行中" },
  { value: "archived", label: "已封存" },
  { value: "deleted", label: "已刪除" },
  { value: "all", label: "全部" }
];

const CATEGORY_LABELS: Record<string, string> = {
  food: "餐飲",
  transport: "交通",
  stay: "住宿",
  ticket: "門票",
  shopping: "購物",
  other: "其他"
};

/* 佔比條的三階橘加一階中性灰。跟 app 的分類圖同一組 token —— 不引入新色相。 */
const BAND_COLORS = [
  "var(--color-primary-b1)",
  "var(--color-primary-b2)",
  "var(--color-primary-b3)",
  "var(--color-line-strong)"
];

const ROLE_LABELS: Record<string, string> = {
  owner: "擁有者",
  admin: "管理員",
  member: "成員"
};

const STATUS_LABELS: Record<string, string> = {
  active: "進行中",
  archived: "已封存",
  deleted: "已刪除"
};

const filter = ref<TaskFilter>("active");
const search = ref("");
const submitted = ref("");

const list = ref<AdminTasksResult | null>(null);
const listError = ref<string | null>(null);
const listLoading = ref(true);

const trail = ref<Array<string | null>>([null]);
const page = ref(0);

const selected = ref<string | null>(null);
const detail = ref<AdminTaskDetail | null>(null);
const detailError = ref<string | null>(null);
const detailLoading = ref(false);

const dialogOpen = ref(false);
const acting = ref(false);
const actionError = ref<string | null>(null);

async function loadList() {
  listLoading.value = true;
  listError.value = null;
  try {
    list.value = await fetchTasks({
      query: submitted.value || undefined,
      filter: filter.value,
      cursor: trail.value[page.value]
    });
  } catch (err) {
    listError.value = err instanceof Error ? err.message : String(err);
  } finally {
    listLoading.value = false;
  }
}

function reset() {
  trail.value = [null];
  page.value = 0;
  selected.value = null;
  detail.value = null;
  void loadList();
}

/*
  `immediate: true` 讓初次載入跟換篩選走同一個入口。

  分成「watch 換篩選」加「另外呼叫一次」的話，忘了後者就是畫面永遠停在
  讀取中 —— 而那看起來像後端很慢，不像前端沒發車。這一頁就是這樣壞的。
*/
watch(filter, reset, { immediate: true });

function submitSearch() {
  submitted.value = search.value.trim();
  reset();
}

function clearSearch() {
  search.value = "";
  submitted.value = "";
  reset();
}

function next() {
  const cursor = list.value?.cursor;
  if (!cursor) return;
  trail.value = [...trail.value.slice(0, page.value + 1), cursor];
  page.value += 1;
  void loadList();
}

function prev() {
  if (page.value === 0) return;
  page.value -= 1;
  void loadList();
}

async function select(row: AdminTaskRow) {
  selected.value = row.id;
  detail.value = null;
  detailError.value = null;
  detailLoading.value = true;
  try {
    detail.value = await fetchTask(row.id);
  } catch (err) {
    detailError.value = err instanceof Error ? err.message : String(err);
  } finally {
    detailLoading.value = false;
  }
}

async function confirmArchive(reason: string) {
  const task = detail.value?.task;
  if (!task) return;
  acting.value = true;
  actionError.value = null;
  try {
    await archiveTask(task.id, reason);
    dialogOpen.value = false;
    // 重讀兩邊：狀態變了，列表的篩選結果與詳情的狀態標籤都得跟著換。
    await Promise.all([loadList(), select(task)]);
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : String(err);
  } finally {
    acting.value = false;
  }
}

const money = (amount: number, currency: string) =>
  `${currency} ${(amount / 100).toLocaleString("zh-TW", { maximumFractionDigits: 2 })}`;

const day = (value: string | null) => (value ? value.slice(0, 10) : "—");
</script>

<template>
  <main class="page">
    <section class="console">
      <header class="topbar">
        <div>
          <h1 class="title">任務</h1>
          <p class="tiny">點一列看詳情。看詳情會在稽核日誌留下一筆。</p>
        </div>
      </header>

      <div class="toolbar">
        <form class="search" @submit.prevent="submitSearch">
          <input
            v-model="search"
            class="input"
            type="search"
            placeholder="任務名稱開頭或完整 ID"
            aria-label="搜尋任務"
          />
          <button type="submit" class="btn btn-sm">搜尋</button>
          <button v-if="submitted" type="button" class="btn btn-sm" @click="clearSearch">
            清除
          </button>
        </form>

        <div class="seg" role="group" aria-label="篩選">
          <button
            v-for="item in FILTERS"
            :key="item.value"
            type="button"
            class="seg-item"
            :class="{ active: filter === item.value }"
            :disabled="!!submitted"
            @click="filter = item.value"
          >
            {{ item.label }}
          </button>
        </div>
      </div>

      <p v-if="submitted" class="tiny note">
        搜尋是<strong>前綴</strong>比對：搜「曼谷」找得到「曼谷五日」，搜「五日」找不到。
      </p>

      <div class="split">
        <div class="card list">
          <LoadingState v-if="listLoading && !list" title="讀取中" message="正在查詢" />
          <ErrorState
            v-else-if="listError"
            :message="listError"
            retryable
            :retrying="listLoading"
            @retry="loadList"
          />
          <EmptyState
            v-else-if="list && list.rows.length === 0"
            title="沒有符合的任務"
            :message="submitted ? '換一個開頭試試。' : '這個篩選目前沒有任務。'"
          />

          <template v-else-if="list">
            <table class="tbl">
              <thead>
                <tr>
                  <th>任務</th>
                  <th>擁有者</th>
                  <th class="r">成員</th>
                  <th class="r">支出</th>
                  <th class="r">最後活動</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in list.rows"
                  :key="row.id"
                  :class="{ sel: selected === row.id, dim: row.status !== 'active' }"
                  tabindex="0"
                  @click="select(row)"
                  @keydown.enter="select(row)"
                >
                  <td>
                    <div class="name">{{ row.name || "（沒有名稱）" }}</div>
                    <div class="tiny">
                      {{ row.startDate || "未設定" }} – {{ row.endDate || "未設定" }}
                      <template v-if="row.status !== 'active'">
                        · {{ STATUS_LABELS[row.status] ?? row.status }}
                      </template>
                    </div>
                  </td>
                  <td class="tiny">{{ list.owners[row.ownerId] || "—" }}</td>
                  <td class="tiny r num">{{ row.memberCount }}</td>
                  <td class="tiny r num">{{ row.expenseCount }}</td>
                  <td class="tiny r num">{{ day(row.updatedAt) }}</td>
                </tr>
              </tbody>
            </table>

            <div v-if="!list.searched" class="pager">
              <p class="tiny">第 {{ page + 1 }} 頁</p>
              <div class="pager-btns">
                <button type="button" class="btn btn-sm" :disabled="page === 0" @click="prev">
                  上一頁
                </button>
                <button type="button" class="btn btn-sm" :disabled="!list.cursor" @click="next">
                  下一頁
                </button>
              </div>
            </div>
          </template>
        </div>

        <div class="card detail">
          <EmptyState
            v-if="!selected"
            title="選一個任務"
            message="左邊點一列，這裡會顯示金額統計與成員。"
          />
          <LoadingState v-else-if="detailLoading" title="讀取中" message="正在加總" />
          <ErrorState v-else-if="detailError" :message="detailError" />

          <template v-else-if="detail">
            <div>
              <div class="spread">
                <h2 class="section-title">{{ detail.task.name || "（沒有名稱）" }}</h2>
                <span class="pill" :class="detail.task.status">
                  {{ STATUS_LABELS[detail.task.status] ?? detail.task.status }}
                </span>
              </div>
              <p class="tiny">
                {{ detail.ownerName || detail.task.ownerId }} 建立於
                {{ day(detail.task.createdAt) }}
              </p>
            </div>

            <dl class="stats">
              <div>
                <dt>支出筆數</dt>
                <dd class="num">{{ detail.task.expenseCount }}</dd>
              </div>
              <div>
                <dt>總額</dt>
                <dd class="num">{{ money(detail.money.total, detail.money.currency) }}</dd>
              </div>
              <div>
                <dt>每人平均</dt>
                <dd class="num">
                  {{
                    detail.money.perMember === null
                      ? "—"
                      : money(detail.money.perMember, detail.money.currency)
                  }}
                </dd>
              </div>
              <div>
                <dt>成員</dt>
                <dd class="num">{{ detail.task.memberCount }}</dd>
              </div>
            </dl>

            <!--
              舊資料沒有 baseAmount，而 sum 聚合會直接跳過非數值 —— 總額會少算，
              而且不會有任何症狀。說出來才不會有人拿這個數字去對帳。
            -->
            <p v-if="detail.money.unconverted > 0" class="tiny warnline">
              總額不含 {{ detail.money.unconverted }} 筆沒有換算過的舊支出。
            </p>

            <div v-if="detail.money.categories.length">
              <h3 class="card-head">花在哪裡</h3>
              <div class="bar">
                <span
                  v-for="(slice, i) in detail.money.categories"
                  :key="slice.category"
                  :style="{
                    width: `${slice.percent}%`,
                    background: BAND_COLORS[Math.min(i, BAND_COLORS.length - 1)]
                  }"
                ></span>
              </div>
              <ul class="legend">
                <li v-for="(slice, i) in detail.money.categories" :key="slice.category">
                  <span
                    class="dot"
                    :style="{ background: BAND_COLORS[Math.min(i, BAND_COLORS.length - 1)] }"
                  ></span>
                  {{ CATEGORY_LABELS[slice.category] ?? slice.category }}
                  {{ slice.percent }}%
                </li>
              </ul>
            </div>

            <div>
              <h3 class="card-head">成員 {{ detail.task.memberCount }} 人</h3>
              <ul class="members">
                <li v-for="member in detail.members" :key="member.uid">
                  <span class="mname" :class="{ off: !member.active }">
                    {{ member.nickname || member.uid }}
                  </span>
                  <span v-if="member.virtual" class="pill sm">虛擬成員</span>
                  <span v-else-if="member.role !== 'member'" class="pill sm">
                    {{ ROLE_LABELS[member.role] ?? member.role }}
                  </span>
                  <span v-if="!member.active" class="tiny">已離開</span>
                </li>
              </ul>
            </div>

            <div class="masked">
              <strong>{{ detail.task.expenseCount }} 筆支出的內容不開放</strong>
              <p class="tiny">
                上面的金額是後端算好的加總。單筆支出的名稱、地點、備註，以及這個任務裡的
                {{ detail.receiptCount }} 張收據照片，管理後台一律讀不到。
              </p>
            </div>

            <div v-if="detail.task.status === 'active'" class="danger">
              <button type="button" class="btn btn-danger" @click="dialogOpen = true">
                強制封存這個任務
              </button>
              <p class="tiny">
                封存後成員仍查得到帳，但不能再新增或修改。擁有者可以自己解除。會寫進稽核日誌。
              </p>
            </div>
          </template>
        </div>
      </div>
    </section>

    <AdminActionDialog
      :open="dialogOpen"
      :title="`封存「${detail?.task.name ?? ''}」`"
      message="成員仍查得到帳，但不能再新增或修改支出。擁有者可以自己解除封存 —— 這不是永久的。"
      confirm-label="確認封存"
      :busy="acting"
      :error="actionError"
      @cancel="dialogOpen = false"
      @confirm="confirmArchive"
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

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
}

.search {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.search .input {
  width: 280px;
  min-height: 40px;
}

.note {
  margin: 0;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  border: 1px solid var(--color-line);
}

.split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 380px;
  gap: var(--space-4);
  align-items: start;
}

@media (max-width: 980px) {
  .split {
    grid-template-columns: minmax(0, 1fr);
  }
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

.tbl tbody tr {
  cursor: pointer;
}

.tbl tbody tr:hover td {
  background: var(--color-surface);
}

.tbl tbody tr.sel td {
  background: var(--color-primary-soft);
}

.tbl tbody tr.sel td:first-child {
  border-radius: var(--radius-sm) 0 0 var(--radius-sm);
}

.tbl tbody tr.sel td:last-child {
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}

/* 不在進行中的任務要一眼看得出來，跟 TaskCard 的封存樣式同一個道理。 */
.tbl tbody tr.dim .name {
  color: var(--color-muted);
}

.tbl tbody tr:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: -2px;
}

.name {
  font-weight: 800;
}

.num {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
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

.detail {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.pill {
  flex: none;
  border-radius: var(--radius-pill);
  padding: 4px 10px;
  background: var(--color-track);
  color: var(--color-muted);
  font-size: var(--text-tiny);
  font-weight: 700;
  white-space: nowrap;
}

.pill.active {
  background: var(--color-success-soft);
  color: var(--color-success);
}

.pill.sm {
  padding: 3px 8px;
}

.stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
  margin: 0;
  padding: var(--space-4) 0;
  border-top: 1px solid var(--color-line);
  border-bottom: 1px solid var(--color-line);
}

.stats dt {
  color: var(--color-muted);
  font-size: var(--text-tiny);
  font-weight: 700;
}

.stats dd {
  margin: var(--space-text) 0 0;
  font-size: var(--text-card);
  font-weight: 900;
}

.warnline {
  margin: 0;
  color: var(--color-danger);
}

.bar {
  display: flex;
  gap: 2px;
  height: 12px;
  border-radius: var(--radius-pill);
  overflow: hidden;
  background: var(--color-track);
  margin-top: var(--space-3);
}

.bar > span {
  display: block;
  height: 100%;
}

.legend {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
  margin: var(--space-3) 0 0;
  padding: 0;
  font-size: var(--text-tiny);
  font-weight: 700;
}

.legend li {
  display: flex;
  align-items: center;
  gap: 6px;
}

.dot {
  width: 9px;
  height: 9px;
  border-radius: 2px;
}

.members {
  list-style: none;
  margin: var(--space-2) 0 0;
  padding: 0;
}

.members li {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--color-line);
  font-size: var(--text-control-sm);
}

.members li:last-child {
  border-bottom: 0;
}

.mname {
  font-weight: 700;
}

.mname.off {
  color: var(--color-muted);
}

.masked {
  border: 1px dashed var(--color-line-strong);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  padding: var(--space-4);
}

.masked strong {
  font-size: var(--text-control-sm);
}

.masked p {
  margin: var(--space-2) 0 0;
}

.danger {
  border-top: 1px solid var(--color-line);
  padding-top: var(--space-4);
}

.danger .tiny {
  margin: var(--space-2) 0 0;
}
</style>
