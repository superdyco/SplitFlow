<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import AppLayout from "@/layouts/AppLayout.vue";
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
import { useExpenses } from "@/composables/useExpenses";
import { usePayments } from "@/composables/usePayments";
import { useTask } from "@/composables/useTask";
import { useTaskMembers } from "@/composables/useTaskMembers";
import { removeMember, setMemberRole } from "@/services/memberService";
import { confirmPayment, createPayment, deletePayment } from "@/services/paymentService";
import { buildInviteUrl, firebaseErrorMessage } from "@/utils/firestore";
import { removeMemberMessage } from "@/utils/memberRemoval";

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

const memberNames = computed(() =>
  Object.fromEntries(memberState.members.value.map(member => [member.uid, member.nickname]))
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
function canManage(expense: Expense) {
  return taskState.isAdmin.value || expense.createdBy === uid || expense.paidBy === uid;
}

async function load() {
  await taskState.load();
  if (!taskState.isMember.value) return;
  await Promise.all([
    memberState.load(),
    expenseState.load(),
    paymentState.load(),
    settlementState.load()
  ]);
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

function removeSettlement(settlementId: string) {
  if (!window.confirm("確定要刪掉這筆結算紀錄嗎？刪掉就找不回來了。")) return;
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

function removePayment(paymentId: string) {
  if (!window.confirm("確定要刪掉這筆付款紀錄嗎？結算餘額會跟著變回去。")) return;
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

function changeRole(targetUid: string, role: AssignableRole) {
  return runMemberAction(targetUid, () => setMemberRole(taskId.value, targetUid, role));
}

function removeTaskMember(targetUid: string) {
  const target = memberState.members.value.find(member => member.uid === targetUid);
  // 沒出現在 balances 代表他還沒參與任何一筆支出，當作已結清。
  const balance = settlement.value.balances.find(item => item.uid === targetUid)?.balance ?? 0;
  const message = removeMemberMessage({
    name: target?.nickname || "",
    balance,
    currency: settlement.value.currency
  });
  if (!window.confirm(message)) return;
  return runMemberAction(targetUid, () => removeMember(taskId.value, targetUid));
}

onMounted(load);
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

      <template v-else-if="taskState.task.value">
        <div class="spread">
          <div>
            <h1 class="title">{{ taskState.task.value.name }}</h1>
            <p class="tiny">
              {{ taskState.task.value.defaultCurrency }} ·
              {{ taskState.task.value.memberCount }} 位成員 ·
              {{ taskState.task.value.expenseCount }} 筆支出
            </p>
          </div>
          <button v-if="taskState.isAdmin.value" class="btn btn-ghost" @click="copyInvite">
            {{ copied ? "已複製" : "邀請" }}
          </button>
        </div>

        <div class="tabs">
          <button class="tab" :class="{ active: activeTab === 'expenses' }" @click="activeTab = 'expenses'">支出</button>
          <button class="tab" :class="{ active: activeTab === 'members' }" @click="activeTab = 'members'">成員</button>
          <button class="tab" :class="{ active: activeTab === 'settlement' }" @click="activeTab = 'settlement'">結算</button>
        </div>

        <ErrorState :message="loadError" />

        <section v-if="activeTab === 'expenses'" class="stack">
          <LoadingState v-if="expenseState.loading.value" title="讀取支出中" message="正在讀取 Firestore 支出資料。" />
          <template v-else>
            <RouterLink :to="`/tasks/${taskId}/expenses/new`" class="btn btn-primary btn-block">新增支出</RouterLink>

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
            />
          </template>
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
              :busy="paymentBusy"
              @record="recordPayment"
              @confirm="acceptPayment"
              @remove="removePayment"
            />
            <SettlementHistory
              :settlement="settlement"
              :snapshots="settlementState.snapshots.value"
              :task-name="taskState.task.value.name"
              :can-manage="taskState.isAdmin.value"
              :busy="settlementBusy"
              @save="saveSettlement"
              @remove="removeSettlement"
            />
          </template>
        </section>
      </template>
    </div>
  </AppLayout>
</template>

<style scoped>
.tabs.two {
  grid-template-columns: repeat(2, 1fr);
}
</style>
