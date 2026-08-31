<script setup lang="ts">
/**
 * 唯讀的支出詳情。
 *
 * 為什麼需要它：編輯頁只讓「自己建的、自己先付的、或管理員」進得去，其他人
 * 連看都看不到。列表上只標「📎 有收據」，點下去卻沒有東西可點 —— 而收據的
 * 用途就是對帳，看不到照片等於這個功能對半數的人不存在。
 *
 * 這一頁不做任何寫入，所以不需要 taskIsActive 那類判斷：封存的任務照樣讀得到。
 */
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRoute } from "vue-router";
import AppLayout from "@/layouts/AppLayout.vue";
import AccessDenied from "@/components/common/AccessDenied.vue";
import ErrorState from "@/components/common/ErrorState.vue";
import LoadingState from "@/components/common/LoadingState.vue";
import PlaceMap from "@/components/map/PlaceMap.vue";
import ReceiptViewer from "@/components/expense/ReceiptViewer.vue";
import { mapsEnabled } from "@/services/mapsLoader";
import { getExpense } from "@/services/expenseService";
import { receiptUrl } from "@/services/receiptService";
import { useAuthStore } from "@/stores/auth";
import { useTask } from "@/composables/useTask";
import { useTaskMembers } from "@/composables/useTaskMembers";
import { categoryMeta, type Expense } from "@/types/expense";
import { memberDisplayName } from "@/utils/memberName";
import { formatAmount } from "@/utils/currency";
import { expenseDate, expenseTime } from "@/utils/expenseDate";
import { firebaseErrorMessage } from "@/utils/firestore";

const route = useRoute();
const taskId = route.params.taskId as string;
const expenseId = route.params.expenseId as string;

const uid = useAuthStore().user?.uid ?? "";
const taskState = useTask(taskId, uid);
const memberState = useTaskMembers(taskId);

const expense = ref<Expense | null>(null);
const loading = ref(true);
const loadError = ref<string | null>(null);

/** 收據的下載網址。要等 Storage 換一次，所以跟支出本身分開。 */
const receiptSrc = ref<string | null>(null);
const receiptError = ref<string | null>(null);
const viewerOpen = ref(false);

const names = computed(() =>
  Object.fromEntries(
    memberState.members.value.map(member => [member.uid, memberDisplayName(member)])
  )
);

function nameOf(memberUid: string): string {
  return names.value[memberUid] || "已離開的成員";
}

const meta = computed(() => (expense.value ? categoryMeta(expense.value.category) : null));
const baseCurrency = computed(() => taskState.task.value?.defaultCurrency || "TWD");

/** 外幣才需要顯示換算，同幣別再寫一次只是重複。 */
const converted = computed(() => {
  const item = expense.value;
  if (!item || item.currency === baseCurrency.value || item.baseAmount === null) return null;
  return formatAmount(item.baseAmount, baseCurrency.value);
});

const shownDate = computed(() => {
  const item = expense.value;
  if (!item) return "";
  const time = expenseTime(item);
  return time ? `${expenseDate(item)} ${time}` : expenseDate(item);
});

/** 分攤依金額由大到小，對帳時想找的通常是「誰分最多」。 */
const splits = computed(() => {
  const item = expense.value;
  if (!item) return [];
  return Object.entries(item.splits)
    .map(([memberUid, amount]) => ({ uid: memberUid, name: nameOf(memberUid), amount }))
    .sort((a, b) => b.amount - a.amount);
});

const placeMarkers = computed(() => {
  const place = expense.value?.place;
  if (!place || place.lat === null || place.lng === null) return [];
  return [{ id: expenseId, title: place.name, lat: place.lat, lng: place.lng }];
});

const mapAvailable = mapsEnabled();

/**
 * 待上傳的收據（`path` 還是 null）只存在拍攝者自己的手機裡，別人拿不到。
 * 講清楚比留一個永遠轉圈的區塊好。
 */
const receiptPending = computed(() => !!expense.value?.receipt && !expense.value.receipt.path);

async function loadReceipt(path: string) {
  try {
    receiptSrc.value = await receiptUrl(path);
  } catch (err) {
    receiptError.value = firebaseErrorMessage(err);
  }
}

async function load() {
  loading.value = true;
  loadError.value = null;
  try {
    await taskState.load();
    if (taskState.denied.value) return;
    if (!taskState.isMember.value) {
      loadError.value = taskState.error.value || "讀取任務失敗";
      return;
    }
    await memberState.load();

    const found = await getExpense(taskId, expenseId);
    if (!found) {
      loadError.value = "找不到這筆支出";
      return;
    }
    expense.value = found;

    // 收據失敗不擋整頁：其他欄位照樣有對帳價值。
    if (found.receipt?.path) await loadReceipt(found.receipt.path);
  } catch (err) {
    loadError.value = firebaseErrorMessage(err);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <AppLayout>
    <div class="stack">
      <LoadingState v-if="loading" title="讀取中" message="正在讀取這筆支出。" />

      <AccessDenied v-else-if="taskState.denied.value" />

      <ErrorState v-else-if="loadError" :message="loadError" retryable @retry="load" />

      <template v-else-if="expense && meta">
        <RouterLink :to="`/tasks/${taskId}`" class="tiny back">← 回任務</RouterLink>

        <div class="card stack head">
          <span class="icon" :aria-label="meta.label">{{ meta.icon }}</span>
          <h1 class="title">{{ expense.title }}</h1>
          <strong class="amount">{{ formatAmount(expense.amount, expense.currency) }}</strong>
          <p class="tiny">
            {{ expense.currency }}
            <template v-if="converted"> · 約 {{ baseCurrency }} {{ converted }}</template>
          </p>
        </div>

        <div class="card stack">
          <div class="row">
            <span class="tiny label">分類</span>
            <span>{{ meta.label }}</span>
          </div>
          <div class="row">
            <span class="tiny label">日期</span>
            <span>{{ shownDate }}</span>
          </div>
          <div class="row">
            <span class="tiny label">誰先付</span>
            <span>{{ nameOf(expense.paidBy) }}</span>
          </div>
          <div class="row">
            <span class="tiny label">分攤方式</span>
            <span>{{ expense.splitMode === "custom" ? "自訂金額" : "均分" }}</span>
          </div>
        </div>

        <div class="card stack">
          <strong class="section-title">分攤（{{ splits.length }} 人）</strong>
          <div v-for="split in splits" :key="split.uid" class="row">
            <span>{{ split.name }}</span>
            <span>{{ formatAmount(split.amount, expense.currency) }}</span>
          </div>
        </div>

        <div v-if="expense.place" class="card stack">
          <strong class="section-title">地點</strong>
          <span>📍 {{ expense.place.name }}</span>
          <span v-if="expense.place.address" class="tiny">{{ expense.place.address }}</span>
          <PlaceMap v-if="mapAvailable && placeMarkers.length" :markers="placeMarkers" height="180px" />
        </div>

        <div v-if="expense.note" class="card stack">
          <strong class="section-title">備註</strong>
          <p class="note">{{ expense.note }}</p>
        </div>

        <div v-if="expense.receipt" class="card stack">
          <strong class="section-title">收據</strong>
          <p v-if="receiptPending" class="tiny">
            這張收據還在拍攝者的手機裡等著上傳，他連上網路之後你才看得到。
          </p>
          <p v-else-if="receiptError" class="tiny warn">{{ receiptError }}</p>
          <button v-else-if="receiptSrc" type="button" class="receipt" @click="viewerOpen = true">
            <img :src="receiptSrc" alt="收據" />
          </button>
        </div>

        <ReceiptViewer :url="receiptSrc" :open="viewerOpen" @close="viewerOpen = false" />
      </template>
    </div>
  </AppLayout>
</template>

<style scoped>
.back {
  color: var(--color-muted);
  text-decoration: none;
}

.head {
  align-items: center;
  text-align: center;
}

.head .title {
  margin: 0;
}

.icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 18px;
  background: var(--color-primary-soft);
  font-size: 26px;
}

.amount {
  font-size: 26px;
}

.head .tiny {
  margin: 0;
}

.row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.row .label {
  flex: none;
  color: var(--color-muted);
}

/* 備註可以到 500 字，這一頁是唯一看得到全文的地方，不要截斷。 */
.note {
  margin: 0;
  line-height: 1.7;
  white-space: pre-wrap;
}

.receipt {
  padding: 0;
  border: 0;
  border-radius: 14px;
  background: none;
  cursor: pointer;
}

.receipt img {
  display: block;
  width: 100%;
  border-radius: 14px;
}
</style>
