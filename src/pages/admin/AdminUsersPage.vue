<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  adjustCredits,
  disableUser,
  fetchUser,
  fetchUsers,
  type AdminUserDetail,
  type AdminUserRow,
  type AdminUsersResult,
  type UserFilter
} from "@/services/adminService";
import LoadingState from "@/components/common/LoadingState.vue";
import ErrorState from "@/components/common/ErrorState.vue";
import EmptyState from "@/components/common/EmptyState.vue";
import AdminActionDialog from "@/pages/admin/AdminActionDialog.vue";
import { providerLabel } from "@/utils/authError";
import { GUEST_PROVIDER_ID } from "@/utils/guest";
import { ledgerResultLabel, ledgerTypeLabel } from "@/utils/aiLedger";

const FILTERS: Array<{ value: UserFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "active7", label: "近 7 日活躍" },
  { value: "idle30", label: "30 天沒來" }
];

const filter = ref<UserFilter>("all");
const search = ref("");
/** 已經送出去的那個搜尋字串。輸入中的字不該每打一個字就查一次。 */
const submitted = ref("");

const list = ref<AdminUsersResult | null>(null);
const listError = ref<string | null>(null);
const listLoading = ref(true);

/**
 * 翻過的每一頁的游標。
 *
 * Firestore 的游標是單向的，回上一頁只能靠自己記著來時路。這個堆疊就是
 * 那條路 —— 換篩選或換搜尋時要清掉，不然「上一頁」會回到另一個查詢的位置。
 */
const trail = ref<Array<string | null>>([null]);
const page = ref(0);

const selected = ref<string | null>(null);
const detail = ref<AdminUserDetail | null>(null);
const detailError = ref<string | null>(null);
const detailLoading = ref(false);

async function loadList() {
  listLoading.value = true;
  listError.value = null;
  try {
    list.value = await fetchUsers({
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

async function select(row: AdminUserRow) {
  selected.value = row.uid;
  detail.value = null;
  detailError.value = null;
  // 上一個人打到一半的點數與理由不能留給下一個人 —— 理由會原字寫進稽核日誌。
  adjustAmount.value = null;
  adjustReason.value = "";
  adjustError.value = null;
  detailLoading.value = true;
  try {
    detail.value = await fetchUser(row.uid);
  } catch (err) {
    detailError.value = err instanceof Error ? err.message : String(err);
  } finally {
    detailLoading.value = false;
  }
}

const dialogOpen = ref(false);
const acting = ref(false);
const actionError = ref<string | null>(null);
/** 停用之後真正生效的時間。後端算的 —— 畫面不該自己去加一小時。 */
const effectiveAt = ref<string | null>(null);

async function confirmDisable(reason: string) {
  const uid = detail.value?.profile.uid;
  if (!uid) return;
  acting.value = true;
  actionError.value = null;
  try {
    const result = await disableUser(uid, reason);
    effectiveAt.value = result.effectiveAt;
    dialogOpen.value = false;
    // 重讀詳情：停用狀態來自 Firebase Auth，不重讀的話標籤不會變。
    await fetchUser(uid).then(next => (detail.value = next));
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : String(err);
  } finally {
    acting.value = false;
  }
}

const adjustAmount = ref<number | null>(null);
const adjustReason = ref("");
const adjusting = ref(false);
const adjustError = ref<string | null>(null);

const canAdjust = computed(() => {
  const value = adjustAmount.value;
  return (
    !adjusting.value &&
    !!adjustReason.value.trim() &&
    typeof value === "number" &&
    Number.isInteger(value) &&
    value !== 0 &&
    Math.abs(value) <= 100
  );
});

/** 調整點數。申訴的補償就是走這裡；後端寫稽核日誌與點數紀錄。 */
async function confirmAdjust() {
  const uid = detail.value?.profile.uid;
  if (!uid || adjustAmount.value === null) return;
  adjusting.value = true;
  adjustError.value = null;
  try {
    await adjustCredits(uid, adjustAmount.value, adjustReason.value.trim());
    adjustAmount.value = null;
    adjustReason.value = "";
    await fetchUser(uid).then(next => (detail.value = next));
  } catch (err) {
    adjustError.value = err instanceof Error ? err.message : String(err);
  } finally {
    adjusting.value = false;
  }
}

const now = new Date();

const ROLE_LABELS: Record<string, string> = {
  owner: "擁有者",
  admin: "管理員",
  member: "成員"
};

const PLATFORM_LABELS: Record<string, string> = {
  web: "網頁版",
  android: "Android",
  ios: "iPhone"
};

function day(value: string | null): string {
  return value ? value.slice(0, 10) : "—";
}

function whenSeen(row: AdminUserRow): string {
  if (!row.lastSeenAt) return "沒有紀錄";
  const platform = row.lastPlatform ? PLATFORM_LABELS[row.lastPlatform] ?? row.lastPlatform : null;
  return platform ? `${day(row.lastSeenAt)} · ${platform}` : day(row.lastSeenAt);
}
</script>

<template>
  <main class="page">
    <section class="console">
      <header class="topbar">
        <div>
          <h1 class="title">使用者</h1>
          <p class="tiny">點一列看詳情。看詳情會在稽核日誌留下一筆。</p>
        </div>
      </header>

      <div class="toolbar">
        <form class="search" @submit.prevent="submitSearch">
          <input
            v-model="search"
            class="input"
            type="search"
            placeholder="暱稱開頭、完整 Email 或 UID"
            aria-label="搜尋使用者"
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

      <!--
        Firestore 沒有全文搜尋。不講的話，搜「小美」找不到「陳小美」會被
        當成「這個人不存在」，而那是一個會讓人做出錯誤結論的沉默失敗。
      -->
      <p v-if="submitted" class="tiny note">
        搜尋是<strong>前綴</strong>比對：搜「陳」找得到「陳小美」，搜「小美」找不到。
        Email 與 UID 要完整。
      </p>
      <p v-else-if="list?.blindSpot" class="tiny note">{{ list.blindSpot }}</p>

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
            title="沒有符合的帳號"
            :message="submitted ? '換一個開頭或用完整的 Email 試試。' : '這個篩選目前沒有人。'"
          />

          <template v-else-if="list">
            <table class="tbl">
              <thead>
                <tr>
                  <th>使用者</th>
                  <th>登入方式</th>
                  <th>註冊日</th>
                  <th>最後開啟</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in list.rows"
                  :key="row.uid"
                  :class="{ sel: selected === row.uid }"
                  tabindex="0"
                  @click="select(row)"
                  @keydown.enter="select(row)"
                >
                  <td>
                    <div class="who">
                      <span class="avatar sm">{{ (row.nickname || "?").charAt(0) }}</span>
                      <div>
                        <div class="name">{{ row.nickname || "（沒有暱稱）" }}</div>
                        <div class="tiny">{{ row.email || "—" }}</div>
                      </div>
                    </div>
                  </td>
                  <td class="tiny">
                    <!--
                      訪客給一個標籤而不是一行字：列表一頁二十幾列，要一眼掃得出來。
                      訪客沒有 email，名字底下那格也會是「—」，兩個訊號對得上。
                    -->
                    <span v-if="row.provider === GUEST_PROVIDER_ID" class="pill sm">訪客</span>
                    <template v-else>{{ providerLabel(row.provider) }}</template>
                  </td>
                  <td class="tiny num">{{ day(row.createdAt) }}</td>
                  <td class="tiny num">{{ whenSeen(row) }}</td>
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
            title="選一個人"
            message="左邊點一列，這裡會顯示他的統計與參與的任務。"
          />
          <LoadingState v-else-if="detailLoading" title="讀取中" message="正在整理" />
          <ErrorState v-else-if="detailError" :message="detailError" />

          <template v-else-if="detail">
            <div class="who big">
              <span class="avatar">{{ (detail.profile.nickname || "?").charAt(0) }}</span>
              <div>
                <div class="section-title">{{ detail.profile.nickname || "（沒有暱稱）" }}</div>
                <div class="tiny">{{ detail.profile.email || "—" }}</div>
              </div>
              <span v-if="detail.profile.provider === GUEST_PROVIDER_ID" class="pill sm">訪客</span>
              <span v-if="detail.disabled" class="pill danger">已停用</span>
            </div>

            <dl class="meta">
              <div><dt>UID</dt><dd class="mono">{{ detail.profile.uid }}</dd></div>
              <div><dt>登入方式</dt><dd>{{ providerLabel(detail.profile.provider) }}</dd></div>
              <div><dt>註冊日</dt><dd class="num">{{ day(detail.profile.createdAt) }}</dd></div>
              <div><dt>最後開啟</dt><dd class="num">{{ whenSeen(detail.profile) }}</dd></div>
            </dl>

            <div class="counts">
              <div><span class="label">參與任務</span><strong>{{ detail.counts.tasks }}</strong></div>
              <div><span class="label">其中他建立</span><strong>{{ detail.counts.owned }}</strong></div>
              <div><span class="label">記過的支出</span><strong>{{ detail.counts.expenses }}</strong></div>
            </div>

            <div v-if="detail.ai" class="tasks">
              <h3 class="card-head">AI 辨識</h3>
              <p class="tiny">
                <template v-if="detail.ai.balance === null">還沒用過（第一次辨識時會送 3 點）。</template>
                <template v-else>剩 {{ detail.ai.balance }} 點。</template>
                辨識 {{ detail.ai.calls }} 次，失敗 {{ detail.ai.calls - detail.ai.reads }} 次。
              </p>

              <div v-if="detail.profile.provider !== GUEST_PROVIDER_ID" class="adjust">
                <input
                  v-model.number="adjustAmount"
                  class="input"
                  type="number"
                  min="-100"
                  max="100"
                  step="1"
                  placeholder="例如 3 或 -1"
                />
                <input
                  v-model="adjustReason"
                  class="input grow"
                  maxlength="500"
                  placeholder="理由（必填，會寫進稽核日誌）"
                />
                <button type="button" class="btn btn-sm" :disabled="!canAdjust" @click="confirmAdjust">
                  {{ adjusting ? "調整中..." : "調整點數" }}
                </button>
              </div>
              <p v-else class="tiny">訪客不能用 AI 辨識，也不能調整點數。</p>
              <p v-if="adjustError" class="tiny ai-error">{{ adjustError }}</p>

              <ul v-if="detail.ai.ledger.length">
                <li v-for="row in detail.ai.ledger" :key="row.id">
                  <span class="tiny num">{{ row.at ? row.at.slice(0, 16).replace("T", " ") : "—" }}</span>
                  <span class="pill">{{ ledgerTypeLabel(row.type) }}</span>
                  <span class="num">{{ row.delta > 0 ? `+${row.delta}` : row.delta }}</span>
                  <span class="tiny">{{ ledgerResultLabel(row, now) || row.reason || "" }}</span>
                </li>
              </ul>
            </div>

            <div v-if="detail.tasks.length" class="tasks">
              <h3 class="card-head">參與的任務</h3>
              <ul>
                <li v-for="task in detail.tasks" :key="task.id">
                  <span class="name">{{ task.name }}</span>
                  <span class="pill">{{ ROLE_LABELS[task.role] ?? task.role }}</span>
                  <span class="tiny num">{{ task.expenseCount }} 筆</span>
                </li>
              </ul>
              <p v-if="detail.counts.tasks > detail.tasks.length" class="tiny">
                只列最近 10 個，他總共參與 {{ detail.counts.tasks }} 個。
              </p>
            </div>

            <!--
              這一塊是這個後台的規格，不是提醒。看得到錢的總量、看不到單筆的
              內容 —— 而那條線只有寫出來才存在。
            -->
            <div class="masked">
              <strong>看不到的部分</strong>
              <p class="tiny">
                支出的名稱、地點、備註與收據照片不對管理者開放，這裡只到「筆數」為止。
                要看內容得由任務擁有者自己匯出。
              </p>
            </div>

            <p v-if="effectiveAt" class="tiny done">
              已停用。他手上那張憑證要到 {{ effectiveAt.slice(0, 16).replace("T", " ") }} 才會失效。
            </p>

            <div v-else-if="!detail.disabled" class="danger">
              <button type="button" class="btn btn-danger" @click="dialogOpen = true">
                停用這個帳號
              </button>
              <!--
                按下去之前唯一看得到的地方。完整的說明在對話框裡，但那句
                「最長 1 小時」在這裡就要出現 —— 不然按下去才知道就晚了。
              -->
              <p class="tiny">
                停用只擋住登入，不刪資料，他已記的支出與分攤都留在任務裡。
                <strong class="lag">最長 1 小時後才會真的擋住。</strong>
              </p>
            </div>
          </template>
        </div>
      </div>
    </section>

    <AdminActionDialog
      :open="dialogOpen"
      :title="`停用「${detail?.profile.nickname || detail?.profile.email || ''}」的帳號`"
      message="他將無法再登入。已經記過的支出、分攤與付款全部留在任務裡，其他成員的帳不受影響。"
      :warning="{
        title: '不是立刻生效，最長還有 1 小時',
        body: '停用擋的是換發新憑證。他手上那張最長還能用 1 小時，這段時間仍然讀得到、也寫得進他已加入的任務。這是 Firebase 換發 token 的機制，關不掉。真的緊急就先撤下他的公開報告、封存出問題的任務。'
      }"
      confirm-label="確認停用"
      :busy="acting"
      :error="actionError"
      @cancel="dialogOpen = false"
      @confirm="confirmDisable"
    />
  </main>
</template>

<style scoped>
/* AI 點數的調整列。放在獨立的 style 區塊，不去動上面那一大段既有樣式。 */
.adjust {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
}

.adjust .input[type="number"] {
  width: 120px;
}

.ai-error {
  color: var(--color-danger);
}
</style>

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
  width: 300px;
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

/*
  卡片自己捲。清單旁邊固定放 380px 的詳情，視窗窄一點（約 980–1250px）
  剩給表格的寬度就會小於它的 min-content —— 表格不會再縮，只會整片穿出
  卡片的圓角邊。捲軸至少讓它留在框裡。
*/
.list {
  overflow-x: auto;
}

.tbl {
  width: 100%;
  /* separate 而不是 collapse：選中那一列要收圓角，而 collapse 會讓
     td 的 border-radius 完全失效，底色就變成一個方角色塊。 */
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

.tbl tbody tr:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: -2px;
}

.who {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.who.big {
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}

.avatar.sm {
  width: 30px;
  height: 30px;
  font-size: var(--text-tiny);
  background: var(--color-primary-soft);
  color: var(--color-primary-dark);
}

.name {
  font-weight: 800;
}

.num {
  font-variant-numeric: tabular-nums;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--text-tiny);
  word-break: break-all;
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
  color: var(--color-ink);
  font-size: var(--text-tiny);
  font-weight: 700;
}

/* 跟任務頁「虛擬成員」那個標籤同一個尺寸。 */
.pill.sm {
  padding: 3px 8px;
}

.pill.danger {
  margin-left: auto;
  background: var(--color-danger-soft);
  color: var(--color-danger);
}

.meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
  margin: 0;
}

.meta dt {
  color: var(--color-muted);
  font-size: var(--text-tiny);
  font-weight: 700;
}

.meta dd {
  margin: var(--space-text) 0 0;
  font-size: var(--text-control-sm);
  font-weight: 700;
}

.counts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-3);
  padding: var(--space-4) 0;
  border-top: 1px solid var(--color-line);
  border-bottom: 1px solid var(--color-line);
}

.counts strong {
  display: block;
  margin-top: var(--space-text);
  font-size: var(--text-section);
  font-variant-numeric: tabular-nums;
}

.tasks ul {
  list-style: none;
  margin: var(--space-2) 0 0;
  padding: 0;
}

.tasks li {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--color-line);
}

.tasks li:last-child {
  border-bottom: 0;
}

.tasks li .name {
  font-size: var(--text-control-sm);
}

.tasks li .num {
  margin-left: auto;
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

.lag {
  color: var(--color-danger);
  font-weight: 700;
}

.done {
  margin: 0;
  border-radius: var(--radius-md);
  background: var(--color-danger-soft);
  border: 1px solid var(--color-danger-line);
  padding: var(--space-3) var(--space-4);
  color: var(--color-ink);
}
</style>
