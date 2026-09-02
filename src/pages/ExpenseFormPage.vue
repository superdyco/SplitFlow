<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import AppLayout from "@/layouts/AppLayout.vue";
import { memberDisplayName } from "@/utils/memberName";
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
import PlaceField from "@/components/expense/PlaceField.vue";
import {
  CURRENCIES,
  allocate,
  amountInputError,
  amountToInput,
  convertAmount,
  formatAmount,
  minorUnits,
  parseAmountInput,
  parseRateInput,
  rateInputError
} from "@/utils/currency";
import { firebaseErrorMessage, required } from "@/utils/firestore";
import { expenseDate, expenseTime, nowTimeInput, todayInput } from "@/utils/expenseDate";
import { repeatFieldsOf } from "@/utils/repeatExpense";
import { settleWrite } from "@/utils/offlineWrite";
import ReceiptField from "@/components/expense/ReceiptField.vue";
import ReceiptViewer from "@/components/expense/ReceiptViewer.vue";
import { useReceipt } from "@/composables/useReceipt";
import { useDictation } from "@/composables/useDictation";
import { deleteReceipt, flushReceipts } from "@/services/receiptService";
import { removeQueued } from "@/services/receiptQueue";
import ConfirmDialog from "@/components/common/ConfirmDialog.vue";

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

const title = ref("");
/**
 * 支出名稱的語音輸入。講出來的內容直接取代欄位內容，不是接在後面 ——
 * 「晚」加上聽到的「晚餐」會變成「晚晚餐」，那種結果比重打一次還煩。
 * 名稱本來就短，講錯再講一次就好。
 */
const titleVoice = useDictation(text => {
  title.value = text.slice(0, 60);
});
const category = ref<ExpenseCategory>(DEFAULT_CATEGORY);
const amount = ref("");
const currency = ref("TWD");
/** 消費發生的日期。新增預設今天，用本地時區組字串，不要走 toISOString（那是 UTC）。 */
const date = ref(todayInput());
/**
 * 消費發生的時間，選填。新增時預設「現在」—— 多數人是當場記帳，
 * 而且看得到預設值才知道有這個欄位；補記昨天的人自己改掉或清空就好。
 */
const time = ref(nowTimeInput());
const paidBy = ref(uid);
const splitMode = ref<SplitMode>("even");
const splitMemberIds = ref<string[]>([]);
const customAmounts = ref<Record<string, string>>({});
const involvedIds = ref<string[]>([]);
/** 這筆支出的補充說明。maxlength 擋在輸入端，所以不需要額外的錯誤訊息。 */
const note = ref("");

const rate = ref("1");
const rateLoading = ref(false);
const rateError = ref<string | null>(null);

/** 這筆支出的地點。搜尋、定位、地圖全在 PlaceField 裡，這裡只收結果。 */
const place = ref<ExpensePlace | null>(null);

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

/**
 * 金額與匯率的錯誤訊息一定要顯示出來。
 *
 * 之前只有 `parsedAmount` 變 null 讓送出鍵變灰，畫面上沒有任何說明 ——
 * 使用者編輯支出時把幣別從 THB 換成 VND，原本的 "450.50" 突然不合法
 * （VND 不用小數），按鈕就死了而且完全不知道為什麼。
 */
const amountError = computed(() => amountInputError(amount.value, currency.value));
/** 格式錯誤，跟 `rateError`（查詢匯率失敗）是兩回事，不要混用。 */
const rateFormatError = computed(() => (needsRate.value ? rateInputError(rate.value) : null));
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
  return memberDisplayName(member);
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
    // quote.updatedAt 沒有人讀了：「參考匯率更新於…」那句隨著匯率區塊
    // 壓成兩行一起刪掉，留一個沒人讀的 ref 比刪掉更難懂。
    rate.value = String(Number(quote.rate.toFixed(6)));
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
  place.value = fields.place;

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
    /*
      封存的任務唯讀，規則（taskIsActive）會擋掉新增、修改與刪除。
      任務頁本來就不給進來的入口，但網址還在 —— 直接開的話會看到一張
      填得完、送不出去的表單，連「刪除支出」都還在。與其讓人白填一輪
      再撞上看不懂的 unauthorized，不如在這裡就講清楚。
    */
    if (taskState.task.value?.status === "archived") {
      loadError.value = "這個任務已封存，目前唯讀。到「我的分帳」解除封存後才能繼續記帳。";
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
    place.value = expense.place;
    // 「編輯時用這筆支出的座標當搜尋偏好」搬進 PlaceField 了 ——
    // 它從初始值自己推得出來，母元件不必知道有位置偏好這件事。
    // 舊支出沒存日期，帶出 createdAt 換算的那天當預設，存回去就補上了。
    date.value = expenseDate(expense);
    // 時間沒有這種退路（見 expenseTime 的說明）：原本沒記就維持空白，
    // 不要拿「現在」去填，那會把編輯的當下寫成消費時間。
    time.value = expenseTime(expense);
    note.value = expense.note;
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
      place: place.value,
      // 先寫既有的值；新選的照片要等下面拿到 id 之後才處理。
      receipt: receiptState.receipt.value,
      note: note.value.trim(),
      date: date.value || todayInput(),
      // 清空的話就是空字串（沒記時間），不要補上現在幾點。
      time: time.value
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

    /*
      離線排隊時應該要告訴使用者「已經存在這台裝置上，連上網會自動同步」——
      那正是最需要安撫的時刻。原本有這段提示，但它壞了：設完旗標立刻導走，
      元件跟著卸載，那個 <p> 沒有機會渲染。

      刪掉壞的實作，把原意留在這裡。修法不只一種（延後導航、在任務頁顯示、
      改用全域提示），每一種的影響範圍都超出這次改版 —— 但下一個人至少
      知道有人想過這件事，不會以為從來沒有。

      outcome 因此暫時沒有讀取者。留著它是刻意的：那兩行賦值是送出流程的
      一部分，為了消掉一個沒人抱怨的未使用變數去改 settleWrite 的呼叫方式，
      代價比留著大。
    */
    await router.push(`/tasks/${taskId}`);
  } catch (err) {
    error.value = firebaseErrorMessage(err);
  } finally {
    saving.value = false;
  }
}

const confirmingRemove = ref(false);

async function remove() {
  confirmingRemove.value = false;
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
          <!-- 分類排在名稱前面：先按一下分類，名稱要打什麼通常也就想好了。 -->
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

          <div class="field">
            <label class="label" for="expense-title">支出名稱</label>
            <div class="row">
              <input
                id="expense-title"
                v-model="title"
                class="input grow"
                maxlength="60"
                placeholder="例如：晚餐"
              />
              <!--
                只有一個圖示，所以 aria-label 是它唯一的名字，不能省。
                聽的時候換成「停止」，因為按下去就是停。
              -->
              <button
                v-if="titleVoice.available"
                type="button"
                class="btn icon-btn"
                :class="{ working: titleVoice.listening.value }"
                :aria-label="titleVoice.listening.value ? '停止語音輸入' : '用說的輸入支出名稱'"
                :title="titleVoice.listening.value ? '停止語音輸入' : '用說的輸入支出名稱'"
                @click="titleVoice.toggle"
              >
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
                  <rect x="9" y="2.5" width="6" height="11" rx="3" fill="currentColor" />
                  <path
                    d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                  />
                </svg>
              </button>
            </div>
            <span v-if="titleVoice.listening.value" class="tiny">請說話...</span>
            <span v-else-if="titleVoice.error.value" class="tiny warn">{{ titleVoice.error.value }}</span>
          </div>

          <div class="row">
            <label class="field grow">
              <span class="label">金額</span>
              <input v-model="amount" class="input" inputmode="decimal" placeholder="0" />
              <span class="tiny" :class="{ warn: amountError }">{{ amountError || amountHint }}</span>
            </label>
            <label class="field currency">
              <span class="label">幣別</span>
              <select v-model="currency" class="select">
                <option v-for="item in CURRENCIES" :key="item" :value="item">{{ item }}</option>
              </select>
            </label>
          </div>

          <div v-if="needsRate" class="field">
            <span class="label">匯率（1 {{ currency }} = ? {{ baseCurrency }}）</span>
            <div class="row">
              <input v-model="rate" class="input grow" inputmode="decimal" placeholder="0" />
              <button type="button" class="btn btn-sm" :disabled="rateLoading" @click="loadRate">
                {{ rateLoading ? "查詢中..." : "重新查詢" }}
              </button>
            </div>
            <!--
              三塊壓成一行。格式錯誤與查詢失敗維持獨立顯示 —— 那是錯誤，該有重量；
              三者互斥，所以最多只佔一行。代價是刪掉「記帳後就固定不再變動」與
              「參考匯率更新於…可以自己改」兩句說明。
            -->
            <span v-if="rateFormatError" class="tiny warn">{{ rateFormatError }}</span>
            <span v-else-if="rateError" class="tiny warn">{{ rateError }}</span>
            <span v-else-if="baseAmount !== null" class="tiny">
              ≈ {{ baseCurrency }} {{ formatAmount(baseAmount, baseCurrency) }}
            </span>
          </div>
        </div>

        <div class="card stack">
          <h2 class="card-head">這趟的細節</h2>

          <div class="field">
            <div class="row">
              <label class="field grow">
                <span class="label">日期</span>
                <input v-model="date" type="date" class="input" />
              </label>
              <label class="field time">
                <span class="label">時間（選填）</span>
                <input v-model="time" type="time" class="input" />
              </label>
            </div>
            <span class="tiny">
              隔天才補記的話改成消費當天，結算與排序都看這個日期。
              時間只影響同一天的排序與顯示，不確定就清空。
            </span>
          </div>

          <PlaceField :task-id="taskId" v-model="place" />

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
            <span class="label">備註（選填）</span>
            <!--
              maxlength 擋在輸入端，所以根本產不出不合法的值，
              不需要再多一個錯誤訊息。比照支出名稱的 maxlength="60"。
            -->
            <textarea
              v-model="note"
              class="input note-input"
              maxlength="500"
              rows="3"
              placeholder="例如：含小費、阿明先付現金、發票在小美那"
            ></textarea>
          </label>
        </div>

        <div class="card stack">
          <h2 class="card-head">怎麼分</h2>

          <label class="field">
            <span class="label">誰先付</span>
            <select v-model="paidBy" class="select">
              <option v-for="member in selectableMembers" :key="member.uid" :value="member.uid">
                {{ member.uid === uid ? `${member.nickname}（你）` : memberDisplayName(member) }}
              </option>
            </select>
          </label>

          <div class="field">
            <span class="label">分攤方式</span>
            <!--
              用 .seg 不用 .tabs：.tabs 是任務頁最上層的頁籤，墨黑實心，那是頁面
              層級的重量。這裡只是表單裡的一個二選一，.seg 就是為次層級切換做的。
            -->
            <div class="seg">
              <button
                type="button"
                class="seg-item"
                :class="{ active: splitMode === 'even' }"
                @click="setSplitMode('even')"
              >
                均分
              </button>
              <button
                type="button"
                class="seg-item"
                :class="{ active: splitMode === 'custom' }"
                @click="setSplitMode('custom')"
              >
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
                {{ memberDisplayName(member) }}
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
                <span class="who">{{ memberDisplayName(member) }}</span>
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

        <ErrorState :message="error" />

        <button class="btn btn-primary btn-block" :disabled="saving || !canSubmit" @click="submit">
          {{ saving ? "儲存中..." : isEdit ? "儲存變更" : "新增支出" }}
        </button>
        <button
          v-if="isEdit"
          class="btn btn-danger btn-block"
          :disabled="removing"
          @click="confirmingRemove = true"
        >
          {{ removing ? "刪除中..." : "刪除支出" }}
        </button>
        <button class="btn btn-block" @click="router.push(`/tasks/${taskId}`)">取消</button>
      </template>

      <ReceiptViewer
        :url="receiptState.previewUrl.value"
        :open="viewerOpen"
        @close="viewerOpen = false"
      />

      <ConfirmDialog
        :open="confirmingRemove"
        title="刪除這筆支出？"
        message="這筆支出與它的收據都會消失，結算金額會跟著重算。刪掉就找不回來了。"
        confirm-label="刪除支出"
        danger
        @confirm="remove"
        @cancel="confirmingRemove = false"
      />
    </div>
  </AppLayout>
</template>

<style scoped>
/*
  卡片的小標。用 --text-card 而不是 --text-section：這是卡片標題不是頁面
  區段，而 --text-card 正是為了「太大」與「跟內文一樣」之間那一格才加的。

  卡 1 沒有小標，那是刻意的 —— 它是主角，不需要一個標題來宣告自己是主角。
*/
.card-head {
  margin: 0;
  font-size: var(--text-card);
  font-weight: 800;
}

.grow {
  flex: 1;
  min-width: 0;
}

.currency {
  flex: none;
  width: 110px;
}

/* 時間比日期短，給它固定寬度，日期那格就吃掉剩下的空間。 */
.time {
  flex: none;
  width: 130px;
}

/*
  .input 是為單行輸入設計的（padding 上下是 0、固定 min-height），
  textarea 要自己補上下內距與行高，不然文字會貼著上緣。
  font-family: inherit 也是必要的 —— textarea 預設是等寬字體，
  不加的話它會跟表單其他欄位長得不一樣。
*/
.note-input {
  min-height: 0;
  padding: 12px 14px;
  line-height: 1.6;
  font-weight: 600;
  font-family: inherit;
  resize: vertical;
}

.row {
  align-items: flex-start;
  flex-wrap: wrap;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 40px;
  padding: 0 14px;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-muted);
  font-weight: 700;
}

.chip.active {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
  color: var(--color-primary-dark);
}

.custom-list {
  gap: var(--space-2);
}

.custom-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
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
  color: var(--color-primary-dark);
  font-size: var(--text-tiny);
  font-weight: 700;
}

/* 只有圖示的方形按鈕（語音），高度對齊旁邊的輸入框（.input 是 52px）。 */
.icon-btn {
  flex: none;
  width: 52px;
  min-height: 52px;
  padding: 0;
  color: var(--color-primary-dark);
}

/*
  進行中的回饋：這種按鈕上沒有文字可以改成「定位中...」，只好讓圖示自己動。
  等語音辨識動輒好幾秒，沒有任何動靜的話會被當成沒反應而一直重按。
*/
.icon-btn.working {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
}

.icon-btn.working svg {
  animation: icon-pulse 1s ease-in-out infinite;
}

@keyframes icon-pulse {
  50% {
    opacity: 0.25;
  }
}

/* 會暈車的人不需要這個提示，顏色的變化已經說明狀態了。 */
@media (prefers-reduced-motion: reduce) {
  .icon-btn.working svg {
    animation: none;
  }
}

.warn {
  color: var(--color-danger);
}
</style>
