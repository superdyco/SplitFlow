<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRoute } from "vue-router";
import AppLayout from "@/layouts/AppLayout.vue";
import AccessDenied from "@/components/common/AccessDenied.vue";
import EmptyState from "@/components/common/EmptyState.vue";
import ErrorState from "@/components/common/ErrorState.vue";
import LoadingState from "@/components/common/LoadingState.vue";
import ExpenseRow from "@/components/expense/ExpenseRow.vue";
import MemberRow from "@/components/member/MemberRow.vue";
import SettlementPanel from "@/components/settlement/SettlementPanel.vue";
import SettlementHistory from "@/components/settlement/SettlementHistory.vue";
import PlaceMap from "@/components/map/PlaceMap.vue";
import { mapsEnabled } from "@/services/mapsLoader";
import { useSettlements } from "@/composables/useSettlements";
import { createSettlement, deleteSettlement } from "@/services/settlementService";
import { settleExpenses, toSnapshotInput } from "@/utils/settlement";
import type { Expense } from "@/types/expense";
import type { AssignableRole } from "@/types/member";
import { useAuthStore } from "@/stores/auth";
import { useExpenses } from "@/composables/useExpenses";
import { usePayments } from "@/composables/usePayments";
import { useTask } from "@/composables/useTask";
import { useTaskMembers } from "@/composables/useTaskMembers";
import { deactivateInvite, regenerateInvite } from "@/services/inviteService";
import { removeMember, setMemberRole } from "@/services/memberService";
import { confirmPayment, createPayment, deletePayment } from "@/services/paymentService";
import { buildInviteUrl, firebaseErrorMessage } from "@/utils/firestore";

type Tab = "expenses" | "members" | "settlement";

const route = useRoute();
const authStore = useAuthStore();
const uid = authStore.user!.uid;
const taskId = computed(() => String(route.params.taskId || ""));
const activeTab = ref<Tab>("expenses");
const copied = ref(false);
const denied = computed(() => route.query.denied === "1");
const actionError = ref<string | null>(null);
const busyUid = ref<string | null>(null);
const inviteBusy = ref(false);

const taskState = useTask(taskId.value, uid);
const memberState = useTaskMembers(taskId.value);
const expenseState = useExpenses(taskId.value);
const paymentState = usePayments(taskId.value);
const settlementState = useSettlements(taskId.value);
const paymentBusy = ref(false);
const settlementBusy = ref(false);
const inviteUrl = computed(() => taskState.task.value ? buildInviteUrl(taskState.task.value.inviteCode) : "");
// 建立於這個功能之前的任務沒有 inviteActive 欄位，沒有就當成有效。
const inviteActive = computed(() => taskState.task.value?.inviteActive !== false);

const memberNames = computed(() =>
  Object.fromEntries(memberState.members.value.map(member => [member.uid, member.nickname]))
);

/** 結算結果算一次，結算面板與結算紀錄共用同一份，不會有兩邊算出不同數字的問題。 */
const settlement = computed(() =>
  settleExpenses(
    expenseState.expenses.value,
    paymentState.payments.value,
    memberState.members.value.map(member => member.uid),
    taskState.task.value?.defaultCurrency || "TWD"
  )
);

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
  const name = target?.nickname || "這位成員";
  if (!window.confirm(`確定要把 ${name} 移出任務嗎？他就看不到這個任務了，但既有支出會保留。`)) return;
  return runMemberAction(targetUid, () => removeMember(taskId.value, targetUid));
}

async function runInviteAction(action: () => Promise<unknown>) {
  inviteBusy.value = true;
  actionError.value = null;
  try {
    await action();
    await taskState.load();
  } catch (err) {
    actionError.value = firebaseErrorMessage(err);
  } finally {
    inviteBusy.value = false;
  }
}

function stopInvite() {
  if (!taskState.task.value) return;
  if (!window.confirm("停用後舊連結會立刻失效，確定要停用嗎？")) return;
  const task = taskState.task.value;
  return runInviteAction(() => deactivateInvite(task));
}

function newInvite() {
  if (!taskState.task.value) return;
  const task = taskState.task.value;
  return runInviteAction(() => regenerateInvite(task, uid));
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
          <button v-if="taskState.isAdmin.value && inviteActive" class="btn btn-ghost" @click="copyInvite">
            {{ copied ? "已複製" : "邀請" }}
          </button>
        </div>

        <div v-if="taskState.isAdmin.value" class="card admin-card stack">
          <strong>{{ taskState.isOwner.value ? "Owner 管理區" : "Admin 管理區" }}</strong>

          <template v-if="inviteActive">
            <p class="tiny">邀請連結目前有效，任何拿到連結的人登入後都能加入。</p>
            <div class="row">
              <span class="invite">{{ inviteUrl }}</span>
              <button class="btn btn-sm" :disabled="inviteBusy" @click="copyInvite">
                {{ copied ? "已複製" : "複製" }}
              </button>
            </div>
            <div class="row">
              <button class="btn btn-sm" :disabled="inviteBusy" @click="newInvite">重新產生連結</button>
              <button class="btn btn-danger btn-sm" :disabled="inviteBusy" @click="stopInvite">停用連結</button>
            </div>
          </template>

          <template v-else>
            <p class="tiny">邀請連結已停用，目前沒有人能靠連結加入這個任務。</p>
            <div class="row">
              <button class="btn btn-sm" :disabled="inviteBusy" @click="newInvite">產生新的邀請連結</button>
            </div>
          </template>
        </div>

        <div class="tabs">
          <button class="tab" :class="{ active: activeTab === 'expenses' }" @click="activeTab = 'expenses'">支出</button>
          <button class="tab" :class="{ active: activeTab === 'members' }" @click="activeTab = 'members'">成員</button>
          <button class="tab" :class="{ active: activeTab === 'settlement' }" @click="activeTab = 'settlement'">結算</button>
        </div>

        <ErrorState
          :message="
            actionError ||
            memberState.error.value ||
            expenseState.error.value ||
            paymentState.error.value ||
            settlementState.error.value
          "
        />

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
              <ExpenseRow
                v-for="expense in expenseState.expenses.value"
                :key="expense.id"
                :expense="expense"
                :task-id="taskId"
                :member-names="memberNames"
                :base-currency="taskState.task.value.defaultCurrency"
                :can-manage="canManage(expense)"
              />
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
.admin-card {
  box-shadow: none;
  background: var(--color-primary-soft);
}

.admin-card .row {
  flex-wrap: wrap;
  gap: 8px;
}

.tabs.two {
  grid-template-columns: repeat(2, 1fr);
}

.invite {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  color: var(--color-muted);
  font-size: 13px;
}
</style>
