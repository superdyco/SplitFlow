<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import AppLayout from "@/layouts/AppLayout.vue";
import { memberDisplayName } from "@/utils/memberName";
import AccessDenied from "@/components/common/AccessDenied.vue";
import EmptyState from "@/components/common/EmptyState.vue";
import ErrorState from "@/components/common/ErrorState.vue";
import LoadingState from "@/components/common/LoadingState.vue";
import ExpenseRow from "@/components/expense/ExpenseRow.vue";
import ExpenseDayGroup from "@/components/expense/ExpenseDayGroup.vue";
import MemberRow from "@/components/member/MemberRow.vue";
import SettlementPanel from "@/components/settlement/SettlementPanel.vue";
import SettlementHistory from "@/components/settlement/SettlementHistory.vue";
import PlaceMap from "@/components/map/PlaceMap.vue";
import { mapsEnabled } from "@/services/mapsLoader";
import { useSettlements } from "@/composables/useSettlements";
import { createSettlement, deleteSettlement } from "@/services/settlementService";
import { settleExpenses, toSnapshotInput } from "@/utils/settlement";
import { groupExpensesByDate } from "@/utils/expenseGroups";
import type { Expense } from "@/types/expense";
import type { AssignableRole } from "@/types/member";
import { useAuthStore } from "@/stores/auth";
import { readWithRecovery } from "@/utils/stallGuard";
import { recoverConnection } from "@/services/networkRecovery";
import { reportTrace } from "@/services/perfService";
import { finishTrace, markPhase } from "@/utils/perfTrace";
import { useExpenses } from "@/composables/useExpenses";
import { usePayments } from "@/composables/usePayments";
import { useTask } from "@/composables/useTask";
import { useTaskMembers } from "@/composables/useTaskMembers";
import { useTripReport } from "@/composables/useTripReport";
import {
  createVirtualMember,
  hardDeleteMember,
  removeMember,
  renameMember,
  setMemberRole
} from "@/services/memberService";
import { confirmPayment, createPayment, deletePayment } from "@/services/paymentService";
import { buildInviteUrl, firebaseErrorMessage } from "@/utils/firestore";
import { removeMemberPrompt, type RemoveMemberPrompt } from "@/utils/memberRemoval";
import { memberFootprint, type MemberFootprint } from "@/utils/memberFootprint";
import RemoveMemberDialog from "@/components/member/RemoveMemberDialog.vue";
import ConfirmDialog from "@/components/common/ConfirmDialog.vue";
import PromptDialog from "@/components/common/PromptDialog.vue";
import { isInstalledApp } from "@/utils/platform";

type Tab = "expenses" | "members" | "settlement";

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const uid = authStore.user!.uid;
const taskId = computed(() => String(route.params.taskId || ""));
const activeTab = ref<Tab>("expenses");
const copied = ref(false);
const denied = computed(() => route.query.denied === "1");
const actionError = ref<string | null>(null);
const busyUid = ref<string | null>(null);

const taskState = useTask(taskId.value, uid);
const memberState = useTaskMembers(taskId.value);
const expenseState = useExpenses(taskId.value);
const paymentState = usePayments(taskId.value);
const settlementState = useSettlements(taskId.value);
const paymentBusy = ref(false);
const settlementBusy = ref(false);
const inviteUrl = computed(() => taskState.task.value ? buildInviteUrl(taskState.task.value.inviteCode) : "");

/** 封存的任務唯讀。firestore.rules 已經擋死，這裡只是不要讓人按了才失敗。 */
const isArchived = computed(() => taskState.task.value?.status === "archived");
/** 軟刪除只是一個欄位，規則仍允許成員讀取，所以要自己擋掉這個幽靈任務。 */
const isDeleted = computed(() => taskState.task.value?.status === "deleted");
/** 有管理權而且任務還能寫。所有寫入入口都看這個，不要各自拼條件。 */
const canWrite = computed(() => taskState.isAdmin.value && !isArchived.value);

const reportState = useTripReport(taskId.value);
const reportCopied = ref(false);

/** 沒有支出就沒有東西可報告。 */
const canGenerateReport = computed(
  () => isArchived.value && taskState.isOwner.value && expenseState.expenses.value.length > 0
);

/**
 * 裝成 App 之後沒有分頁列也沒有上一頁 —— 用 `_blank` 開出來的報告頁是一條
 * 死路，使用者按不回任務頁。所以只有真的有瀏覽器介面時才開新分頁；
 * 裝起來的話走站內導航，讓報告頁自己給一顆返回（它會看 history 有沒有上一頁）。
 *
 * `undefined` 而不是 `_self`：vue-router 的 RouterLink 看到 `target="_blank"`
 * 就整個放手交給瀏覽器，其餘值才走站內導航 —— 站內導航才會留下 history 記錄。
 */
const newTabTarget = computed(() => (isInstalledApp() ? undefined : "_blank"));

async function copyShareUrl() {
  await navigator.clipboard.writeText(reportState.shareUrl.value);
  reportCopied.value = true;
  window.setTimeout(() => (reportCopied.value = false), 1500);
}

function generateReport() {
  const task = taskState.task.value;
  if (!task) return;
  return reportState.generate(task, expenseState.expenses.value);
}

const memberNames = computed(() =>
  Object.fromEntries(memberState.members.value.map(member => [member.uid, memberDisplayName(member)]))
);

const expenseGroups = computed(() =>
  groupExpensesByDate(
    expenseState.expenses.value,
    taskState.task.value?.defaultCurrency || "TWD"
  )
);

/**
 * 記「收合了哪幾天」而不是「展開了哪幾天」，這樣預設全展開，
 * 新的一天出現時也會是展開的，不用另外處理。
 */
const collapsedDays = ref(new Set<string>());

function toggleDay(date: string) {
  if (collapsedDays.value.has(date)) collapsedDays.value.delete(date);
  else collapsedDays.value.add(date);
}

/** 再記一筆：把來源帶到新增頁，金額、日期與匯率重來。 */
function repeatExpense(expenseId: string) {
  return router.push(`/tasks/${taskId.value}/expenses/new?from=${expenseId}`);
}

/** 結算結果算一次，結算面板與結算紀錄共用同一份，不會有兩邊算出不同數字的問題。 */
const settlement = computed(() =>
  settleExpenses(
    expenseState.expenses.value,
    paymentState.payments.value,
    memberState.members.value.map(member => member.uid),
    taskState.task.value?.defaultCurrency || "TWD"
  )
);

/**
 * 四個區塊各自獨立讀取，任何一個失敗都只會顯示一句共用的錯誤。
 * 標明來源才看得出是哪一種資料讀不到 —— 例如規則沒部署到某個子集合時，
 * 其他區塊都正常，只有那一個會壞。
 */
const loadError = computed(() => {
  if (actionError.value) return actionError.value;
  if (memberState.error.value) return `讀取成員失敗：${memberState.error.value}`;
  if (expenseState.error.value) return `讀取支出失敗：${expenseState.error.value}`;
  if (paymentState.error.value) return `讀取付款紀錄失敗：${paymentState.error.value}`;
  if (settlementState.error.value) return `讀取結算紀錄失敗：${settlementState.error.value}`;
  return null;
});

const expenseView = ref<"list" | "map">("list");
const mapAvailable = mapsEnabled();

/** 只有帶座標的支出畫得上地圖，純文字地點與沒填地點的不算。 */
const expenseMarkers = computed(() =>
  expenseState.expenses.value
    .filter(expense => expense.place?.lat != null && expense.place?.lng != null)
    .map(expense => ({
      id: expense.id,
      lat: expense.place!.lat as number,
      lng: expense.place!.lng as number,
      title: `${expense.title} · ${expense.place!.name}`
    }))
);

// 一般成員只能動自己建立或自己先付的支出，owner/admin 可以動全部。
// 封存之後誰都不能動 —— 這也是規則的行為，前端跟著收起編輯連結與「再記一筆」。
function canManage(expense: Expense) {
  if (isArchived.value) return false;
  return taskState.isAdmin.value || expense.createdBy === uid || expense.paidBy === uid;
}

/**
 * 兩段都包上守衛。任務列表那邊裝了之後，卡住的抱怨就跑到這一頁來了 ——
 * 同一個病：連線死了但 SDK 不報錯，於是壓著本機快取不發、等一個不會來的回應。
 * 這裡比列表更容易中，因為一次要發六趟讀取，任何一趟卡住整頁就停在骨架上。
 *
 * 分兩段是因為它們本來就是先後關係（要先知道是不是成員才讀得下去），
 * 而守衛的計時只認得一個 promise。兩段各自算，第一段慢不會吃掉第二段的額度。
 *
 * `recoverConnection` 自己有防重入，所以兩段都觸發也只會真的切一次連線。
 */
async function load() {
  await readWithRecovery(() => taskState.load(), recoverConnection);
  markPhase("task");
  if (!taskState.isMember.value) return;
  await readWithRecovery(
    () =>
      Promise.all([
        memberState.load(),
        expenseState.load(),
        paymentState.load(),
        settlementState.load(),
        reportState.load()
      ]),
    recoverConnection
  );
  markPhase("rest");
}

async function runSettlementAction(action: () => Promise<unknown>) {
  settlementBusy.value = true;
  actionError.value = null;
  try {
    await action();
    await settlementState.load();
  } catch (err) {
    actionError.value = firebaseErrorMessage(err);
  } finally {
    settlementBusy.value = false;
  }
}

function saveSettlement(note: string) {
  const input = toSnapshotInput(settlement.value, memberNames.value, note);
  return runSettlementAction(() => createSettlement(taskId.value, input, uid));
}

/*
  刪除的確認一律走 ConfirmDialog，不用 window.confirm —— 後者在手機上是系統
  對話框，按鈕位置不受控，「確定」常常就落在拇指下面。

  存的是 id 而不是布林值：對話框要知道刪的是哪一筆，而列表上每一列都可能觸發它。
*/
const removingSettlement = ref<string | null>(null);

function removeSettlement() {
  const settlementId = removingSettlement.value;
  if (!settlementId) return;
  removingSettlement.value = null;
  return runSettlementAction(() => deleteSettlement(taskId.value, settlementId));
}

async function runPaymentAction(action: () => Promise<unknown>) {
  paymentBusy.value = true;
  actionError.value = null;
  try {
    await action();
    await paymentState.load();
  } catch (err) {
    actionError.value = firebaseErrorMessage(err);
  } finally {
    paymentBusy.value = false;
  }
}

function recordPayment(value: { from: string; to: string; amount: number }) {
  const currency = taskState.task.value?.defaultCurrency || "TWD";
  // 收款人自己記的話直接算確認，本來就只有他能證明錢收到了。
  const status = value.to === uid ? "confirmed" : "pending";
  return runPaymentAction(() => createPayment(taskId.value, { ...value, currency, status }, uid));
}

function acceptPayment(paymentId: string) {
  return runPaymentAction(() => confirmPayment(taskId.value, paymentId));
}

const removingPayment = ref<string | null>(null);

function removePayment() {
  const paymentId = removingPayment.value;
  if (!paymentId) return;
  removingPayment.value = null;
  return runPaymentAction(() => deletePayment(taskId.value, paymentId));
}

async function copyInvite() {
  await navigator.clipboard.writeText(inviteUrl.value);
  copied.value = true;
  window.setTimeout(() => (copied.value = false), 1500);
}

async function runMemberAction(targetUid: string, action: () => Promise<void>) {
  busyUid.value = targetUid;
  actionError.value = null;
  try {
    await action();
    await Promise.all([taskState.load(), memberState.load()]);
  } catch (err) {
    actionError.value = firebaseErrorMessage(err);
  } finally {
    busyUid.value = null;
  }
}

const virtualNickname = ref("");
const addingVirtual = ref(false);

/**
 * 長輩這類沒有 Google 帳號的人，由管理者代為建立。
 *
 * 沒有走 runMemberAction 是因為那支函式要一個 targetUid 來標示哪一列在忙，
 * 而這裡還沒有人可以標 —— id 要等寫入成功才存在。刷新與錯誤處理照抄它。
 */
async function addVirtualMember() {
  const nickname = virtualNickname.value.trim();
  if (!nickname || addingVirtual.value) return;

  addingVirtual.value = true;
  actionError.value = null;
  try {
    await createVirtualMember(taskId.value, nickname);
    virtualNickname.value = "";
    await Promise.all([taskState.load(), memberState.load()]);
  } catch (err) {
    actionError.value = firebaseErrorMessage(err);
  } finally {
    addingVirtual.value = false;
  }
}

/**
 * 改名只對虛擬成員開放 —— 真實成員的暱稱來自個人資料，他自己改。
 *
 * 存 uid 而不是布林值：成員列上每一列都能開這個對話框，它得知道改的是誰，
 * 而且要拿現在的名字當預填值。
 */
const renaming = ref<string | null>(null);

const renamingMember = computed(() =>
  memberState.members.value.find(member => member.uid === renaming.value)
);

function renameTaskMember(next: string) {
  const targetUid = renaming.value;
  if (!targetUid) return;
  renaming.value = null;

  // 截字是最後一道 —— 對話框的 maxlength 擋得住打字，擋不住貼上。
  return runMemberAction(targetUid, () => renameMember(taskId.value, targetUid, next.slice(0, 20)));
}

function changeRole(targetUid: string, role: AssignableRole) {
  return runMemberAction(targetUid, () => setMemberRole(taskId.value, targetUid, role));
}

const removing = ref<{ uid: string; prompt: RemoveMemberPrompt; footprint: MemberFootprint } | null>(null);

/**
 * 按下「移除」只負責算出後果並開對話框，真正動手的是下面兩支。
 *
 * 沒有帳的人也走同一個對話框 —— 只是它不給選擇、也不要求打字。
 */
function removeTaskMember(targetUid: string) {
  const target = memberState.members.value.find(member => member.uid === targetUid);
  const footprint = memberFootprint(targetUid, expenseState.expenses.value, paymentState.payments.value);
  // 沒出現在 balances 代表他還沒參與任何一筆支出，當作已結清。
  const balance = settlement.value.balances.find(item => item.uid === targetUid)?.balance ?? 0;

  removing.value = {
    uid: targetUid,
    footprint,
    prompt: removeMemberPrompt({
      name: target?.nickname || "",
      expenseCount: footprint.expenseIds.length,
      paymentCount: footprint.paymentIds.length,
      balance,
      currency: settlement.value.currency,
      virtual: target?.virtual === true,
      othersPaid: footprint.othersPaid
    })
  };
}

/** 保留結算資料 —— 舊的軟刪，行為完全不變。 */
async function confirmSoftRemove() {
  const target = removing.value;
  if (!target) return;
  removing.value = null;
  await runMemberAction(target.uid, () => removeMember(taskId.value, target.uid));
}

/** 真實移除 —— 連他的支出與付款一起刪。 */
async function confirmHardRemove() {
  const target = removing.value;
  if (!target) return;
  await runMemberAction(target.uid, () =>
    hardDeleteMember(taskId.value, target.uid, target.footprint)
  );
  removing.value = null;
  // 支出與付款也被刪了，兩份列表都要重讀 —— runMemberAction 只重載任務與成員。
  await Promise.all([expenseState.load(), paymentState.load()]);
}

/**
 * 點標題觸發的重新載入。
 *
 * 跟 `load` 分開只為了一件事：`taskState.load()` 會把 loading 打開，整頁
 * 會退回「讀取任務中」的骨架 —— 手動重整時畫面整個閃掉，比不重整還糟。
 * 這裡自己記一個旗標，畫面留在原地，只在標題旁邊講一句「重新載入中」。
 */
const reloading = ref(false);

async function reload() {
  if (reloading.value) return;
  reloading.value = true;
  try {
    await load();
  } finally {
    reloading.value = false;
  }
}

/**
 * 收尾在頁面而不是路由，理由跟任務列表那邊一樣：導航結束時畫面還是空的，
 * 那時候回報等於少算了使用者真正在盯著骨架的那一段。
 */
onMounted(async () => {
  markPhase("mount");
  await load();
  await nextTick();
  markPhase("render");

  const trace = finishTrace("task");
  if (trace) reportTrace(trace);
});
</script>

<template>
  <AppLayout>
    <div class="stack">
      <LoadingState v-if="taskState.loading.value" title="讀取任務中" message="正在檢查你的任務權限。" />

      <AccessDenied v-else-if="denied || taskState.denied.value" />

      <div v-else-if="taskState.error.value" class="stack">
        <ErrorState
          :message="taskState.error.value"
          retryable
          :retrying="taskState.loading.value"
          @retry="load"
        />
      </div>

      <!--
        這條一定要排在 task.value 那條之前：已刪除的任務 task.value 也是有值的，
        放在後面就永遠不會命中。
      -->
      <ErrorState v-else-if="isDeleted" message="這個任務已被刪除。" />

      <template v-else-if="taskState.task.value">
        <div class="spread">
          <div>
            <!--
              點標題重新載入。這一頁沒有別的地方可以重讀 —— 別人剛加了一筆
              支出、或自己在別的分頁改過，只能整頁重整才看得到。

              做成標題而不是另外擺一顆按鈕，是因為「點標題回到這一頁的最新狀態」
              本來就是很多 App 的習慣，而這裡的版面已經夠擠了。
              用 button 而不是在 h1 上掛 @click：鍵盤 Tab 到得了、Enter 按得下去。
            -->
            <button class="title-reload" :disabled="reloading" @click="reload">
              <h1 class="title">{{ taskState.task.value.name }}</h1>
            </button>
            <p class="tiny">
              {{ taskState.task.value.defaultCurrency }} ·
              {{ taskState.task.value.memberCount }} 位成員 ·
              {{ taskState.task.value.expenseCount }} 筆支出
              <span v-if="reloading"> · 重新載入中...</span>
            </p>
          </div>
          <button v-if="canWrite" class="btn btn-ghost" @click="copyInvite">
            {{ copied ? "已複製" : "邀請" }}
          </button>
        </div>

        <p v-if="isArchived" class="card tiny archived-banner">
          這個任務已封存，目前唯讀。到「我的分帳」解除封存後才能繼續記帳。
        </p>

        <section v-if="isArchived && taskState.isOwner.value" class="card stack">
          <strong class="section-title">分享這趟旅程</strong>

          <p v-if="!expenseState.expenses.value.length" class="tiny warn">
            這個任務還沒有支出，沒有東西可以報告。
          </p>

          <template v-else-if="reportState.report.value">
            <div class="row wrap">
              <input :value="reportState.shareUrl.value" class="input grow" readonly />
              <button class="btn btn-sm" @click="copyShareUrl">
                {{ reportCopied ? "已複製" : "複製" }}
              </button>
              <!--
                只在連結開著時才給這顆。規則是
                `active == true || isTaskMember(taskId)`，owner 是成員，所以連結
                關掉之後 owner 自己還是讀得到完整報告 —— 這時給一顆「開啟」，
                他會看到正常的頁面、以為連結還通著，但別人打開是「找不到」。
                旁邊那句「目前已關閉，連結打不開」已經把狀態講清楚了。

                用連結而不是 button + window.open()：中鍵開新分頁、長按選單、
                「複製連結網址」都會是瀏覽器原生行為，也不會被彈出視窗封鎖擋掉。
                RouterLink 一樣是渲染成 <a href>，這些行為都還在。
              -->
              <RouterLink
                v-if="reportState.report.value.active"
                class="btn btn-sm"
                :to="reportState.sharePath.value"
                :target="newTabTarget"
                rel="noopener"
              >
                開啟
              </RouterLink>
            </div>
            <p v-if="!reportState.report.value.active" class="tiny warn">
              目前已關閉，連結打不開。
            </p>
            <!--
              兩層是兩件事：連結是「拿到網址的人看不看得到」，公開是「陌生人
              在探索頁找不找得到」。只想傳給朋友的人，連結開著但這個不勾。

              連結關掉時整條停用並取消勾選 —— 列出去只會是一張點進去讀不到的
              卡片，而那比沒列出去更糟。
            -->
            <label class="listed" :class="{ off: !reportState.report.value.active }">
              <input
                type="checkbox"
                :checked="reportState.report.value.listed"
                :disabled="!reportState.report.value.active || reportState.busy.value"
                @change="reportState.setListed(!reportState.report.value.listed)"
              />
              <span>
                列入公開頁
                <span class="tiny muted block">
                  {{
                    reportState.report.value.active
                      ? "讓所有簡單分帳使用者在「探索」找得到這趟旅程"
                      : "連結關著的時候不能公開"
                  }}
                </span>
              </span>
            </label>

            <div class="row">
              <button class="btn btn-sm" :disabled="reportState.busy.value" @click="generateReport">
                重新產生
              </button>
              <button
                class="btn btn-sm"
                :disabled="reportState.busy.value"
                @click="reportState.setActive(!reportState.report.value.active)"
              >
                {{ reportState.report.value.active ? "關閉連結" : "重新開啟" }}
              </button>
            </div>
          </template>

          <button
            v-else
            class="btn btn-primary btn-block"
            :disabled="!canGenerateReport || reportState.busy.value"
            @click="generateReport"
          >
            {{ reportState.busy.value ? "產生中..." : "產生分享報告" }}
          </button>

          <p v-if="reportState.error.value" class="tiny warn">{{ reportState.error.value }}</p>
          <!--
            報告是成功的，只是沒有地圖 —— 用 muted 而不是 warn，
            不然看起來像整份報告失敗了。
          -->
          <p v-if="reportState.mapWarning.value" class="tiny">
            報告已產生，但沒有地圖：{{ reportState.mapWarning.value }}
          </p>
        </section>

        <div class="tabs">
          <button class="tab" :class="{ active: activeTab === 'expenses' }" @click="activeTab = 'expenses'">支出</button>
          <button class="tab" :class="{ active: activeTab === 'members' }" @click="activeTab = 'members'">成員</button>
          <button class="tab" :class="{ active: activeTab === 'settlement' }" @click="activeTab = 'settlement'">結算</button>
        </div>

        <ErrorState :message="loadError" />

        <section v-if="activeTab === 'expenses'" class="stack">
          <LoadingState v-if="expenseState.loading.value" title="讀取支出中" message="正在讀取 Firestore 支出資料。" />
          <template v-else>
            <RouterLink
              v-if="!isArchived"
              :to="`/tasks/${taskId}/expenses/new`"
              class="btn btn-primary btn-block"
            >
              新增支出
            </RouterLink>

            <div v-if="mapAvailable && expenseMarkers.length" class="tabs two">
              <button class="tab" :class="{ active: expenseView === 'list' }" @click="expenseView = 'list'">
                清單
              </button>
              <button class="tab" :class="{ active: expenseView === 'map' }" @click="expenseView = 'map'">
                地圖（{{ expenseMarkers.length }}）
              </button>
            </div>

            <template v-if="expenseView === 'map'">
              <PlaceMap :markers="expenseMarkers" height="360px" />
              <p class="tiny">
                只顯示有座標的支出。從地點搜尋清單選出來的才會有座標，自己打字的沒有。
              </p>
            </template>

            <template v-else>
              <EmptyState
                v-if="expenseState.isEmpty.value"
                title="目前尚無支出"
                message="新增第一筆支出後，結算就會根據真實資料計算。"
              />
              <ExpenseDayGroup
                v-for="group in expenseGroups"
                :key="group.date"
                :group="group"
                :currency="taskState.task.value.defaultCurrency"
                :open="!collapsedDays.has(group.date)"
                @toggle="toggleDay"
              >
                <ExpenseRow
                  v-for="expense in group.expenses"
                  :key="expense.id"
                  :expense="expense"
                  :task-id="taskId"
                  :member-names="memberNames"
                  :base-currency="taskState.task.value.defaultCurrency"
                  :can-manage="canManage(expense)"
                  @repeat="repeatExpense"
                />
              </ExpenseDayGroup>
            </template>
          </template>
        </section>

        <section v-if="activeTab === 'members'" class="stack">
          <LoadingState v-if="memberState.loading.value" title="讀取成員中" message="正在讀取 Firestore 成員資料。" />
          <template v-else>
            <p v-if="taskState.isAdmin.value" class="tiny">
              管理員只能移除一般成員。要移除管理員，先把他降為成員。
            </p>
            <MemberRow
              v-for="member in memberState.activeMembers.value"
              :key="member.uid"
              :member="member"
              :current-uid="uid"
              :can-manage="taskState.isAdmin.value"
              :busy="busyUid === member.uid"
              @promote="changeRole($event, 'admin')"
              @demote="changeRole($event, 'member')"
              @remove="removeTaskMember"
              @rename="(memberUid: string) => (renaming = memberUid)"
            />

            <div v-if="taskState.isAdmin.value" class="card stack">
              <strong>新增沒有帳號的成員</strong>
              <p class="tiny">
                長輩這類沒有 Google 帳號的人，可以先用名字記進帳裡 ——
                他會照常被分攤、出現在結算，只是不能自己打開這個網站。
              </p>
              <input
                v-model="virtualNickname"
                class="input"
                maxlength="20"
                placeholder="例如：阿嬤"
                @keyup.enter="addVirtualMember"
              />
              <button
                class="btn"
                :disabled="addingVirtual || !virtualNickname.trim()"
                @click="addVirtualMember"
              >
                {{ addingVirtual ? "新增中…" : "新增" }}
              </button>
            </div>
          </template>

          <RemoveMemberDialog
            v-if="removing"
            :open="true"
            :prompt="removing.prompt"
            :busy="busyUid === removing.uid"
            @soft="confirmSoftRemove"
            @hard="confirmHardRemove"
            @cancel="removing = null"
          />
        </section>

        <section v-if="activeTab === 'settlement'" class="stack">
          <LoadingState v-if="expenseState.loading.value" title="讀取支出中" message="結算會依最新支出重新計算。" />
          <EmptyState
            v-else-if="expenseState.isEmpty.value"
            title="目前尚無支出，無法結算"
            message="先在支出頁籤新增第一筆支出。"
          />
          <template v-else>
            <SettlementPanel
              :settlement="settlement"
              :expenses="expenseState.expenses.value"
              :payments="paymentState.payments.value"
              :members="memberState.members.value"
              :task-name="taskState.task.value.name"
              :default-currency="taskState.task.value.defaultCurrency"
              :current-uid="uid"
              :is-admin="taskState.isAdmin.value"
              :can-write="!isArchived"
              :busy="paymentBusy"
              @record="recordPayment"
              @confirm="acceptPayment"
              @remove="(id: string) => (removingPayment = id)"
            />
            <SettlementHistory
              :settlement="settlement"
              :snapshots="settlementState.snapshots.value"
              :task-name="taskState.task.value.name"
              :can-manage="canWrite"
              :busy="settlementBusy"
              @save="saveSettlement"
              @remove="(id: string) => (removingSettlement = id)"
            />
          </template>
        </section>
      </template>

      <PromptDialog
        :open="renaming !== null"
        title="改成什麼名字？"
        message="這個名字只在這個任務裡用，支出與結算上的顯示都會跟著換。"
        label="名字"
        confirm-label="改名"
        :initial="renamingMember?.nickname ?? ''"
        placeholder="例如：阿嬤"
        :maxlength="20"
        :busy="busyUid === renaming"
        @confirm="renameTaskMember"
        @cancel="renaming = null"
      />

      <ConfirmDialog
        :open="removingPayment !== null"
        title="刪掉這筆付款紀錄？"
        message="結算餘額會跟著變回去，這筆付款就當作沒發生過。"
        confirm-label="刪掉付款紀錄"
        danger
        @confirm="removePayment"
        @cancel="removingPayment = null"
      />

      <ConfirmDialog
        :open="removingSettlement !== null"
        title="刪掉這筆結算紀錄？"
        message="這是當時帳目的快照，刪掉就找不回來了。目前的帳目與結算不受影響。"
        confirm-label="刪掉結算紀錄"
        danger
        @confirm="removeSettlement"
        @cancel="removingSettlement = null"
      />
    </div>
  </AppLayout>
</template>

<style scoped>
/* 標題本身就是按鈕，但看起來要跟原本的標題一模一樣。 */
.title-reload {
  display: block;
  margin: 0;
  border: 0;
  background: none;
  padding: 0;
  text-align: left;
  cursor: pointer;
}

.title-reload:disabled {
  cursor: default;
  opacity: 0.6;
}

.listed {
  display: flex;
  gap: var(--space-3);
  align-items: flex-start;
  line-height: 1.5;
}

.listed input {
  margin-top: 3px;
  flex: none;
}

/* 連結關著時整條淡掉，才看得出來為什麼點不動。 */
.listed.off {
  opacity: 0.55;
}

.block {
  display: block;
}

.archived-banner {
  border-left: 3px solid var(--color-muted);
  color: var(--color-muted);
}

/* 分享連結的輸入框要吃掉剩餘寬度，複製鈕才不會被擠掉。 */
.grow {
  flex: 1;
  min-width: 0;
}

/* 網址很長，手機寬度下輸入框佔滿一行、兩顆按鈕落到下一行，不要硬擠。 */
.wrap {
  flex-wrap: wrap;
}

.wrap .grow {
  flex: 1 1 100%;
}

.warn {
  color: var(--color-danger);
}

.tabs.two {
  grid-template-columns: repeat(2, 1fr);
}
</style>
