<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import AppLayout from "@/layouts/AppLayout.vue";
import AccessDenied from "@/components/common/AccessDenied.vue";
import ErrorState from "@/components/common/ErrorState.vue";
import LoadingState from "@/components/common/LoadingState.vue";
import type { ExpenseCategory, ExpenseInput, ExpensePlace, SplitMode } from "@/types/expense";
import { DEFAULT_CATEGORY, EXPENSE_CATEGORIES } from "@/types/expense";
import { useAuthStore } from "@/stores/auth";
import { useTask } from "@/composables/useTask";
import { useTaskMembers } from "@/composables/useTaskMembers";
import { createExpense, deleteExpense, getExpense, updateExpense } from "@/services/expenseService";
import { getRate } from "@/services/rateService";
import {
  autocompletePlaces,
  getPlaceDetails,
  newSessionToken,
  placesEnabled,
  recallPlaceBias,
  rememberPlaceBias,
  type PlaceSuggestion
} from "@/services/placeService";
import { biasFromPlaces, type LatLng } from "@/utils/placeBias";
import { mapsEnabled } from "@/services/mapsLoader";
import PlaceMap from "@/components/map/PlaceMap.vue";
import {
  CURRENCIES,
  allocate,
  amountToInput,
  convertAmount,
  formatAmount,
  minorUnits,
  parseAmountInput,
  parseRateInput
} from "@/utils/currency";
import { firebaseErrorMessage, required } from "@/utils/firestore";
import { expenseDate, todayInput } from "@/utils/expenseDate";
import { repeatFieldsOf } from "@/utils/repeatExpense";
import { settleWrite } from "@/utils/offlineWrite";
import ReceiptField from "@/components/expense/ReceiptField.vue";
import ReceiptViewer from "@/components/expense/ReceiptViewer.vue";
import { useReceipt } from "@/composables/useReceipt";
import { deleteReceipt, flushReceipts } from "@/services/receiptService";
import { removeQueued } from "@/services/receiptQueue";

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const uid = authStore.user!.uid;
const taskId = String(route.params.taskId || "");
const expenseId = String(route.params.expenseId || "");
const isEdit = computed(() => !!expenseId);
/** 從支出列表的「再記一筆」帶過來的來源 id。 */
const repeatFromId = String(route.query.from || "");

const taskState = useTask(taskId, uid);
const memberState = useTaskMembers(taskId);
const receiptState = useReceipt();

/**
 * 走到這裡的人一定有管理權：load() 對沒權限的人會設 loadError，
 * template 就顯示 ErrorState 而不是表單，根本渲染不到收據欄位。
 *
 * 那為什麼 ReceiptField 還留著 canManage 這個 prop？因為那是元件正確的介面 ——
 * 「能不能改」不該由元件自己猜。之後如果加了唯讀的支出詳情頁，
 * 那一頁傳 false 進來就好，元件不用改。
 */
const canManageReceipt = true;

/** 收據大圖的開關。 */
const viewerOpen = ref(false);

const loading = ref(true);
const saving = ref(false);
const removing = ref(false);
const loadError = ref<string | null>(null);
const error = ref<string | null>(null);
/** 離線排隊時要告訴使用者資料沒有不見，只是還沒送出去。 */
const queuedNotice = ref(false);

const title = ref("");
const category = ref<ExpenseCategory>(DEFAULT_CATEGORY);
const amount = ref("");
const currency = ref("TWD");
/** 消費發生的日期。新增預設今天，用本地時區組字串，不要走 toISOString（那是 UTC）。 */
const date = ref(todayInput());
const paidBy = ref(uid);
const splitMode = ref<SplitMode>("even");
const splitMemberIds = ref<string[]>([]);
const customAmounts = ref<Record<string, string>>({});
const involvedIds = ref<string[]>([]);

const rate = ref("1");
const rateUpdatedAt = ref("");
const rateLoading = ref(false);
const rateError = ref<string | null>(null);

const placeQuery = ref("");
const selectedPlace = ref<ExpensePlace | null>(null);
const suggestions = ref<PlaceSuggestion[]>([]);
const placeLoading = ref(false);
const placeError = ref<string | null>(null);
const placeSearchable = placesEnabled();
/**
 * 搜尋的位置偏好。沒有它的話「星巴克」會回傳全世界的分店 ——
 * 人在曼谷卻搜到台北那間。第一筆支出還沒有參考點，就退回原本的全球搜尋。
 */
const placeBias = ref<LatLng | null>(recallPlaceBias(taskId));
const mapAvailable = mapsEnabled();
let placeSession = newSessionToken();
let placeTimer: number | undefined;

/** 有座標才畫得出地圖，純文字地點就沒有。 */
const placeMarkers = computed(() => {
  const place = selectedPlace.value;
  if (!place || place.lat === null || place.lng === null) return [];
  return [{ id: place.placeId ?? "place", lat: place.lat, lng: place.lng, title: place.name }];
});

const baseCurrency = computed(() => taskState.task.value?.defaultCurrency || "TWD");
const needsRate = computed(() => currency.value !== baseCurrency.value);

/** 已被移除的成員若原本就在這筆支出裡，仍要留在選單上，不然編輯時會被迫把他踢掉。 */
const selectableMembers = computed(() =>
  memberState.members.value.filter(member => member.active || involvedIds.value.includes(member.uid))
);

const decimals = computed(() => minorUnits(currency.value));
const amountHint = computed(() =>
  decimals.value > 0 ? `最多 ${decimals.value} 位小數` : `${currency.value} 不使用小數`
);

function safeParse(value: string, code: string): number | null {
  try {
    return parseAmountInput(value, code);
  } catch {
    return null;
  }
}

const parsedAmount = computed(() => safeParse(amount.value, currency.value));
const parsedRate = computed(() => {
  if (!needsRate.value) return 1;
  try {
    return parseRateInput(rate.value);
  } catch {
    return null;
  }
});

const baseAmount = computed(() => {
  if (parsedAmount.value === null || parsedRate.value === null) return null;
  return convertAmount(parsedAmount.value, currency.value, baseCurrency.value, parsedRate.value);
});

const evenSplits = computed<Record<string, number>>(() => {
  const total = parsedAmount.value;
  const ids = splitMemberIds.value;
  if (total === null || !ids.length) return {};
  const shares = allocate(total, ids.map(() => 1));
  return Object.fromEntries(ids.map((id, index) => [id, shares[index]]));
});

const customSplits = computed(() => {
  const splits: Record<string, number> = {};
  let invalid = false;
  for (const member of selectableMembers.value) {
    const raw = (customAmounts.value[member.uid] ?? "").trim();
    if (!raw) continue;
    const value = safeParse(raw, currency.value);
    if (value === null) invalid = true;
    else splits[member.uid] = value;
  }
  return { splits, invalid };
});

const customTotal = computed(() =>
  Object.values(customSplits.value.splits).reduce((acc, value) => acc + value, 0)
);
const customDiff = computed(() => (parsedAmount.value ?? 0) - customTotal.value);
const finalSplits = computed(() =>
  splitMode.value === "even" ? evenSplits.value : customSplits.value.splits
);

const canSubmit = computed(() => {
  if (!title.value.trim() || parsedAmount.value === null || parsedRate.value === null) return false;
  if (splitMode.value === "even") return splitMemberIds.value.length > 0;
  return !customSplits.value.invalid && Object.keys(customSplits.value.splits).length > 0 && customDiff.value === 0;
});

function memberName(memberUid: string) {
  const member = selectableMembers.value.find(item => item.uid === memberUid);
  if (!member) return "已離開的成員";
  return `${member.nickname}${member.active ? "" : "（已離開）"}`;
}

/**
 * 使用者可能只想打個名字不選建議，所以輸入本身就是有效的地點名稱。
 * 選了建議才會補上地址與座標。
 */
function currentPlace(): ExpensePlace | null {
  const text = placeQuery.value.trim();
  if (!text) return null;
  if (selectedPlace.value && selectedPlace.value.name === text) return selectedPlace.value;
  return { name: text, address: null, lat: null, lng: null, placeId: null };
}

function onPlaceInput(value: string) {
  placeQuery.value = value;
  selectedPlace.value = null;
  placeError.value = null;
  if (!placeSearchable) return;

  window.clearTimeout(placeTimer);
  if (value.trim().length < 2) {
    suggestions.value = [];
    return;
  }
  // 每打一個字就打一次 API 太浪費，等使用者停下來再查。
  placeTimer = window.setTimeout(searchPlaces, 350);
}

async function searchPlaces() {
  placeLoading.value = true;
  placeError.value = null;
  try {
    suggestions.value = await autocompletePlaces(placeQuery.value, placeSession, placeBias.value);
  } catch (err) {
    suggestions.value = [];
    placeError.value = err instanceof Error ? err.message : String(err);
  } finally {
    placeLoading.value = false;
  }
}

async function pickPlace(suggestion: PlaceSuggestion) {
  placeLoading.value = true;
  placeError.value = null;
  try {
    const detail = await getPlaceDetails(suggestion.placeId, placeSession);
    selectedPlace.value = detail;
    placeQuery.value = detail.name;
    suggestions.value = [];
    // 這個任務接下來的搜尋就以這裡為中心。選到沒有座標的地點時保留原本的偏好。
    rememberPlaceBias(taskId, detail);
    placeBias.value = biasFromPlaces([detail]) ?? placeBias.value;
    // 一次 autocomplete + details 算一個 session，選完就換新的。
    placeSession = newSessionToken();
  } catch (err) {
    placeError.value = err instanceof Error ? err.message : String(err);
  } finally {
    placeLoading.value = false;
  }
}

function clearPlace() {
  window.clearTimeout(placeTimer);
  placeQuery.value = "";
  selectedPlace.value = null;
  suggestions.value = [];
  placeError.value = null;
}

async function loadRate() {
  if (!needsRate.value) {
    rate.value = "1";
    rateError.value = null;
    return;
  }
  rateLoading.value = true;
  rateError.value = null;
  try {
    const quote = await getRate(currency.value, baseCurrency.value);
    rate.value = String(Number(quote.rate.toFixed(6)));
    rateUpdatedAt.value = quote.updatedAt;
  } catch (err) {
    rateError.value = `${err instanceof Error ? err.message : String(err)}。請手動填寫匯率。`;
  } finally {
    rateLoading.value = false;
  }
}

/**
 * 「再記一筆」：帶入來源的分類、幣別、付款人與分攤設定，金額留空。
 * 日期是今天、匯率重新查 —— 見 `repeatFieldsOf` 的說明。
 * 來源讀不到就當作一般的新增，不要擋住使用者記帳。
 */
async function applyRepeatSource() {
  const source = await getExpense(taskId, repeatFromId).catch(() => null);
  if (!source) return;

  const fields = repeatFieldsOf(source);
  title.value = fields.title;
  category.value = fields.category;
  currency.value = fields.currency;
  paidBy.value = fields.paidBy;
  splitMode.value = fields.splitMode;
  involvedIds.value = [...Object.keys(fields.splits), fields.paidBy];
  splitMemberIds.value = selectableMembers.value
    .map(member => member.uid)
    .filter(memberUid => memberUid in fields.splits);
  selectedPlace.value = fields.place;
  placeQuery.value = fields.place?.name ?? "";

  // 自訂分攤的金額跟著原金額走，但新的一筆金額還沒填，留空讓使用者重填。
  if (fields.splitMode === "custom") customAmounts.value = {};
  if (needsRate.value) await loadRate();
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

    currency.value = baseCurrency.value;
    splitMemberIds.value = memberState.activeMembers.value.map(member => member.uid);

    if (!isEdit.value) {
      if (repeatFromId) await applyRepeatSource();
      return;
    }

    const expense = await getExpense(taskId, expenseId);
    if (!expense) {
      loadError.value = "找不到這筆支出";
      return;
    }
    const canManage = taskState.isAdmin.value || expense.createdBy === uid || expense.paidBy === uid;
    if (!canManage) {
      loadError.value = "你只能修改自己建立或自己先付的支出";
      return;
    }

    title.value = expense.title;
    category.value = expense.category;
    currency.value = expense.currency;
    amount.value = amountToInput(expense.amount, expense.currency);
    paidBy.value = expense.paidBy;
    splitMode.value = expense.splitMode;
    involvedIds.value = [...Object.keys(expense.splits), expense.paidBy];
    splitMemberIds.value = selectableMembers.value
      .map(member => member.uid)
      .filter(memberUid => memberUid in expense.splits);
    customAmounts.value = Object.fromEntries(
      Object.entries(expense.splits).map(([memberUid, value]) => [
        memberUid,
        amountToInput(value, expense.currency)
      ])
    );
    selectedPlace.value = expense.place;
    placeQuery.value = expense.place?.name ?? "";
    // 編輯這筆支出時，它自己的座標比 localStorage 裡那個更能代表要找的區域。
    placeBias.value = biasFromPlaces([expense.place]) ?? placeBias.value;
    // 舊支出沒存日期，帶出 createdAt 換算的那天當預設，存回去就補上了。
    date.value = expenseDate(expense);
    await receiptState.loadExisting(expense.receipt);

    // 匯率沿用記帳當下存下來的，不重抓。舊支出沒有存匯率才去問一次當作建議值。
    if (expense.rate !== null) rate.value = String(expense.rate);
    else await loadRate();
  } catch (err) {
    loadError.value = firebaseErrorMessage(err);
  } finally {
    loading.value = false;
  }
}

function toggleSplit(memberUid: string) {
  const next = new Set(splitMemberIds.value);
  if (next.has(memberUid)) next.delete(memberUid);
  else next.add(memberUid);
  splitMemberIds.value = selectableMembers.value.map(member => member.uid).filter(item => next.has(item));
}

function toggleAll() {
  const all = selectableMembers.value.map(member => member.uid);
  splitMemberIds.value = splitMemberIds.value.length === all.length ? [] : all;
}

function setSplitMode(mode: SplitMode) {
  // 從均分切到自訂時先把均分結果填進去，使用者只要改想改的那幾個人。
  if (mode === "custom" && splitMode.value === "even") {
    customAmounts.value = Object.fromEntries(
      Object.entries(evenSplits.value).map(([memberUid, value]) => [
        memberUid,
        amountToInput(value, currency.value)
      ])
    );
  }
  splitMode.value = mode;
}

function fillRemainder(memberUid: string) {
  const current = safeParse((customAmounts.value[memberUid] ?? "").trim(), currency.value) ?? 0;
  const target = current + customDiff.value;
  if (target <= 0) return;
  customAmounts.value = { ...customAmounts.value, [memberUid]: amountToInput(target, currency.value) };
}

async function submit() {
  saving.value = true;
  error.value = null;
  try {
    const parsed = parseAmountInput(amount.value, currency.value);
    const usedRate = needsRate.value ? parseRateInput(rate.value) : 1;
    const converted = convertAmount(parsed, currency.value, baseCurrency.value, usedRate);
    if (converted <= 0) throw new Error(`換算成 ${baseCurrency.value} 後金額不到最小單位，請確認匯率`);

    const splits = finalSplits.value;
    if (!Object.keys(splits).length) throw new Error("至少要有一位分攤成員");
    if (splitMode.value === "custom" && customDiff.value !== 0) {
      throw new Error("自訂分攤的合計必須等於支出金額");
    }

    const input: ExpenseInput = {
      title: required(title.value, "支出名稱"),
      category: category.value,
      amount: parsed,
      currency: currency.value,
      rate: usedRate,
      baseAmount: converted,
      paidBy: paidBy.value,
      splitMode: splitMode.value,
      splits,
      place: currentPlace(),
      // 先寫既有的值；新選的照片要等下面拿到 id 之後才處理。
      receipt: receiptState.receipt.value,
      date: date.value || todayInput()
    };

    let outcome: Awaited<ReturnType<typeof settleWrite>>;
    let savedId = expenseId;

    if (isEdit.value) {
      outcome = await settleWrite(updateExpense(taskId, expenseId, input));
    } else {
      const created = createExpense(taskId, input, uid);
      savedId = created.id;
      outcome = await settleWrite(created.synced);
    }

    // 收據放在文件寫完之後：新增模式要先有 expenseId 才知道要傳到哪個路徑。
    // 這一步失敗不該讓已經存好的支出看起來像沒存，所以錯誤只提示不擋跳轉。
    try {
      const saved = await receiptState.commit(taskId, savedId);
      if (saved !== input.receipt) {
        await settleWrite(updateExpense(taskId, savedId, { ...input, receipt: saved }));
      }
      // 一定要等文件寫完才開始上傳，否則 flush 會先把文件改成已上傳、
      // 再被上面那次寫入蓋回待上傳（見 queueReceipt 的說明）。
      if (saved?.localId) void flushReceipts();
    } catch (err) {
      error.value = `支出已儲存，但收據沒有存成功：${firebaseErrorMessage(err)}`;
      saving.value = false;
      return;
    }

    if (outcome === "queued") queuedNotice.value = true;
    await router.push(`/tasks/${taskId}`);
  } catch (err) {
    error.value = firebaseErrorMessage(err);
  } finally {
    saving.value = false;
  }
}

async function remove() {
  if (!window.confirm("確定要刪除這筆支出嗎？")) return;
  removing.value = true;
  error.value = null;
  try {
    // 先清收據再刪支出：反過來的話 deleteReceipt 失敗時就沒有東西能告訴我們該刪哪個路徑了。
    // 兩者都是盡力而為，失敗不擋刪除 —— 留下孤兒檔案是設計上接受的取捨。
    const orphan = receiptState.receipt.value;
    if (orphan) {
      await deleteReceipt(taskId, expenseId);
      if (orphan.localId) await removeQueued(orphan.localId).catch(() => {});
    }

    await settleWrite(deleteExpense(taskId, expenseId));
    await router.push(`/tasks/${taskId}`);
  } catch (err) {
    error.value = firebaseErrorMessage(err);
  } finally {
    removing.value = false;
  }
}

watch(currency, () => {
  if (!loading.value) loadRate();
});

onMounted(load);
</script>

<template>
  <AppLayout>
    <div class="stack">
      <LoadingState v-if="loading" title="讀取中" message="正在讀取任務與成員資料。" />

      <AccessDenied v-else-if="taskState.denied.value" />

      <ErrorState v-else-if="loadError" :message="loadError" retryable @retry="load" />

      <template v-else>
        <h1 class="title">{{ isEdit ? "編輯支出" : "新增支出" }}</h1>

        <div class="card stack">
          <label class="field">
            <span class="label">支出名稱</span>
            <input v-model="title" class="input" maxlength="60" placeholder="例如：晚餐" />
          </label>

          <div class="field">
            <span class="label">分類</span>
            <div class="chips">
              <button
                v-for="item in EXPENSE_CATEGORIES"
                :key="item.value"
                type="button"
                class="chip"
                :class="{ active: category === item.value }"
                @click="category = item.value"
              >
                <span>{{ item.icon }}</span>
                <span>{{ item.label }}</span>
              </button>
            </div>
          </div>

          <div class="row">
            <label class="field grow">
              <span class="label">金額</span>
              <input v-model="amount" class="input" inputmode="decimal" placeholder="0" />
              <span class="tiny">{{ amountHint }}</span>
            </label>
            <label class="field currency">
              <span class="label">幣別</span>
              <select v-model="currency" class="select">
                <option v-for="item in CURRENCIES" :key="item" :value="item">{{ item }}</option>
              </select>
            </label>
          </div>

          <label class="field">
            <span class="label">日期</span>
            <input v-model="date" type="date" class="input" />
            <span class="tiny">隔天才補記的話改成消費當天，結算與排序都看這個日期。</span>
          </label>

          <div v-if="needsRate" class="field">
            <span class="label">匯率（1 {{ currency }} = ? {{ baseCurrency }}）</span>
            <div class="row">
              <input v-model="rate" class="input grow" inputmode="decimal" placeholder="0" />
              <button type="button" class="btn btn-sm" :disabled="rateLoading" @click="loadRate">
                {{ rateLoading ? "查詢中..." : "重新查詢" }}
              </button>
            </div>
            <span v-if="rateError" class="tiny warn">{{ rateError }}</span>
            <span v-else-if="rateUpdatedAt" class="tiny">參考匯率更新於 {{ rateUpdatedAt }}，可以自己改成實際成交匯率。</span>
            <span v-if="baseAmount !== null" class="tiny">
              換算後約 {{ baseCurrency }} {{ formatAmount(baseAmount, baseCurrency) }}，記帳後就固定不再變動。
            </span>
          </div>

          <div class="field">
            <div class="spread">
              <span class="label">地點（選填）</span>
              <button v-if="placeQuery" type="button" class="link" @click="clearPlace">清除</button>
            </div>
            <div class="place">
              <input
                :value="placeQuery"
                class="input"
                :placeholder="placeSearchable ? '輸入店名或地址，從清單選一個' : '輸入地點名稱'"
                autocomplete="off"
                @input="onPlaceInput(($event.target as HTMLInputElement).value)"
              />
              <ul v-if="suggestions.length" class="suggestions">
                <li v-for="item in suggestions" :key="item.placeId">
                  <button type="button" class="suggestion" @click="pickPlace(item)">
                    <strong>{{ item.primary }}</strong>
                    <span v-if="item.secondary" class="tiny">{{ item.secondary }}</span>
                  </button>
                </li>
              </ul>
            </div>
            <span v-if="placeLoading" class="tiny">搜尋中...</span>
            <span v-else-if="placeError" class="tiny warn">{{ placeError }}</span>
            <span v-else-if="selectedPlace?.address" class="tiny">{{ selectedPlace.address }}</span>
            <span v-else-if="!placeSearchable" class="tiny">
              沒有設定地點服務金鑰，目前只會存你打的名稱，不會有地址與座標。
            </span>
            <PlaceMap v-if="mapAvailable && placeMarkers.length" :markers="placeMarkers" height="180px" />
          </div>

          <ReceiptField
            :preview-url="receiptState.previewUrl.value"
            :state="receiptState.state.value"
            :busy="receiptState.busy.value"
            :can-manage="canManageReceipt"
            :error="receiptState.error.value"
            :submit-label="isEdit ? '儲存變更' : '新增支出'"
            @pick="receiptState.pickFile"
            @clear="receiptState.clear"
            @retry="receiptState.retry"
            @view="viewerOpen = true"
          />

          <label class="field">
            <span class="label">誰先付</span>
            <select v-model="paidBy" class="select">
              <option v-for="member in selectableMembers" :key="member.uid" :value="member.uid">
                {{ member.nickname }}{{ member.uid === uid ? "（你）" : member.active ? "" : "（已離開）" }}
              </option>
            </select>
          </label>

          <div class="field">
            <span class="label">分攤方式</span>
            <div class="tabs two">
              <button class="tab" :class="{ active: splitMode === 'even' }" @click="setSplitMode('even')">均分</button>
              <button class="tab" :class="{ active: splitMode === 'custom' }" @click="setSplitMode('custom')">
                自訂金額
              </button>
            </div>
          </div>

          <div v-if="splitMode === 'even'" class="field">
            <div class="spread">
              <span class="label">分攤成員（{{ splitMemberIds.length }} 人）</span>
              <button type="button" class="link" @click="toggleAll">
                {{ splitMemberIds.length === selectableMembers.length ? "全部取消" : "全選" }}
              </button>
            </div>
            <div class="chips">
              <button
                v-for="member in selectableMembers"
                :key="member.uid"
                type="button"
                class="chip"
                :class="{ active: splitMemberIds.includes(member.uid) }"
                @click="toggleSplit(member.uid)"
              >
                {{ member.nickname }}{{ member.active ? "" : "（已離開）" }}
              </button>
            </div>
            <p v-if="Object.keys(evenSplits).length" class="tiny">
              每人 {{ currency }}
              {{ formatAmount(Math.min(...Object.values(evenSplits)), currency) }}
              <template v-if="Math.min(...Object.values(evenSplits)) !== Math.max(...Object.values(evenSplits))">
                ~ {{ formatAmount(Math.max(...Object.values(evenSplits)), currency) }}（除不盡的部分依順序多分 1）
              </template>
            </p>
          </div>

          <div v-else class="field">
            <span class="label">每人金額（留白代表沒有參與）</span>
            <div class="stack custom-list">
              <div v-for="member in selectableMembers" :key="member.uid" class="custom-row">
                <span class="who">{{ member.nickname }}{{ member.active ? "" : "（已離開）" }}</span>
                <input
                  :value="customAmounts[member.uid] ?? ''"
                  class="input custom-input"
                  inputmode="decimal"
                  placeholder="0"
                  @input="customAmounts = { ...customAmounts, [member.uid]: ($event.target as HTMLInputElement).value }"
                />
                <button
                  v-if="customDiff !== 0"
                  type="button"
                  class="btn btn-sm"
                  title="把差額補到這個人身上"
                  @click="fillRemainder(member.uid)"
                >
                  補差額
                </button>
              </div>
            </div>
            <p class="tiny" :class="{ warn: customDiff !== 0 || customSplits.invalid }">
              <template v-if="customSplits.invalid">有欄位的金額格式不對。</template>
              <template v-else-if="parsedAmount === null">先填上面的支出金額。</template>
              <template v-else-if="customDiff === 0">
                合計 {{ currency }} {{ formatAmount(customTotal, currency) }}，剛好等於支出金額。
              </template>
              <template v-else-if="customDiff > 0">
                合計 {{ currency }} {{ formatAmount(customTotal, currency) }}，還差
                {{ formatAmount(customDiff, currency) }}。
              </template>
              <template v-else>
                合計 {{ currency }} {{ formatAmount(customTotal, currency) }}，超過
                {{ formatAmount(-customDiff, currency) }}。
              </template>
            </p>
          </div>
        </div>

        <p v-if="queuedNotice" class="card tiny">
          目前沒有連線，已經先存在這台裝置上，連上網路後會自動同步。
        </p>

        <ErrorState :message="error" />

        <button class="btn btn-primary btn-block" :disabled="saving || !canSubmit" @click="submit">
          {{ saving ? "儲存中..." : isEdit ? "儲存變更" : "新增支出" }}
        </button>
        <button v-if="isEdit" class="btn btn-danger btn-block" :disabled="removing" @click="remove">
          {{ removing ? "刪除中..." : "刪除支出" }}
        </button>
        <button class="btn btn-block" @click="router.push(`/tasks/${taskId}`)">取消</button>
      </template>

      <ReceiptViewer
        :url="receiptState.previewUrl.value"
        :open="viewerOpen"
        @close="viewerOpen = false"
      />
    </div>
  </AppLayout>
</template>

<style scoped>
.grow {
  flex: 1;
  min-width: 0;
}

.currency {
  flex: none;
  width: 110px;
}

.row {
  align-items: flex-start;
  flex-wrap: wrap;
}

.tabs.two {
  grid-template-columns: repeat(2, 1fr);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 40px;
  padding: 0 14px;
  border: 1px solid var(--color-line);
  border-radius: 14px;
  background: var(--color-surface);
  color: var(--color-muted);
  font-weight: 700;
}

.chip.active {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
  color: var(--color-primary);
}

.custom-list {
  gap: 8px;
}

.custom-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.custom-row .who {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 700;
}

.custom-input {
  flex: none;
  width: 120px;
  min-height: 44px;
  text-align: right;
}

.link {
  border: 0;
  background: none;
  padding: 0;
  color: var(--color-primary);
  font-size: 12px;
  font-weight: 700;
}

.place {
  position: relative;
}

.suggestions {
  position: absolute;
  z-index: 5;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  margin: 0;
  padding: 6px;
  list-style: none;
  border: 1px solid var(--color-line);
  border-radius: 16px;
  background: var(--color-card);
  box-shadow: var(--shadow-card);
  max-height: 260px;
  overflow-y: auto;
}

.suggestion {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 10px 12px;
  border: 0;
  border-radius: 12px;
  background: none;
  text-align: left;
}

.suggestion:hover {
  background: var(--color-primary-soft);
}

.suggestion .tiny {
  line-height: 1.4;
}

.warn {
  color: var(--color-danger);
}
</style>
