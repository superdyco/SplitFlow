<script setup lang="ts">
import { computed, ref } from "vue";
import type { Expense } from "@/types/expense";
import type { TaskMember } from "@/types/member";
import type { Payment } from "@/types/payment";
import type { Settlement } from "@/types/settlement";
import { amountToInput, formatAmount, parseAmountInput } from "@/utils/currency";
import { buildSettlementText } from "@/utils/settlementText";
import { useCopy } from "@/composables/useCopy";
import CategoryChart from "@/components/settlement/CategoryChart.vue";

const props = defineProps<{
  /** 由 TaskPage 算好後傳進來，結算紀錄那一塊要用同一份。 */
  settlement: Settlement;
  expenses: Expense[];
  payments: Payment[];
  members: TaskMember[];
  taskName: string;
  defaultCurrency: string;
  currentUid: string;
  isAdmin: boolean;
  /**
   * 這個任務還收不收寫入（封存之後就是 false）。
   *
   * 跟 `isAdmin` 分開是因為它們擋的是不同的事：`isAdmin` 決定「能不能代別人動」，
   * `canWrite` 決定「現在還能不能動」。少了它，封存的任務上每個人仍然看得到
   * 自己那筆付款的「刪除」與「確認收到」，按下去才被規則擋掉 ——
   * 前端不該給出規則不會放行的按鈕。
   */
  canWrite: boolean;
  busy: boolean;
}>();

const emit = defineEmits<{
  (e: "record", value: { from: string; to: string; amount: number }): void;
  (e: "confirm", paymentId: string): void;
  (e: "remove", paymentId: string): void;
}>();

const openKey = ref<string | null>(null);
const draftAmount = ref("");
const draftError = ref<string | null>(null);

const settlement = computed(() => props.settlement);

const memberNames = computed(() =>
  Object.fromEntries(props.members.map(member => [member.uid, member.nickname]))
);

const hasForeign = computed(() =>
  props.expenses.some(expense => expense.currency !== props.defaultCurrency && expense.baseAmount !== null)
);

const pendingPayments = computed(() => props.payments.filter(item => item.status === "pending"));
const confirmedPayments = computed(() => props.payments.filter(item => item.status === "confirmed"));

function name(uid: string): string {
  return memberNames.value[uid] || "已離開的成員";
}

function money(value: number): string {
  return formatAmount(value, settlement.value.currency);
}

function transferKey(from: string, to: string) {
  return `${from}->${to}`;
}

/** 付款人自己記，或 admin 代記。 */
function canRecord(from: string) {
  return props.canWrite && (props.currentUid === from || props.isAdmin);
}

function openRecord(from: string, to: string, amount: number) {
  openKey.value = transferKey(from, to);
  draftAmount.value = amountToInput(amount, settlement.value.currency);
  draftError.value = null;
}

function closeRecord() {
  openKey.value = null;
  draftError.value = null;
}

function submitRecord(from: string, to: string) {
  try {
    const amount = parseAmountInput(draftAmount.value, settlement.value.currency);
    emit("record", { from, to, amount });
    closeRecord();
  } catch (err) {
    draftError.value = err instanceof Error ? err.message : String(err);
  }
}

function canDelete(payment: Payment) {
  if (!props.canWrite) return false;
  return props.currentUid === payment.from || props.currentUid === payment.to || props.isAdmin;
}

function canConfirm(payment: Payment) {
  if (!props.canWrite) return false;
  return payment.status === "pending" && (props.currentUid === payment.to || props.isAdmin);
}

const { copied, error: copyError, copy } = useCopy();

/** 待確認的付款還沒扣進轉帳金額，未換算的支出根本沒進結算，兩個都要在文字裡講明。 */
function copySettlement() {
  return copy(
    buildSettlementText({
      taskName: props.taskName,
      currency: settlement.value.currency,
      transfers: settlement.value.transfers,
      memberNames: memberNames.value,
      expenseCount: settlement.value.expenseCount,
      total: settlement.value.total,
      unconvertedCount: settlement.value.unconverted.length,
      pendingCount: pendingPayments.value.length
    })
  );
}
</script>

<template>
  <div class="stack">
    <div v-if="settlement.unconverted.length" class="card warn-card stack">
      <strong>有 {{ settlement.unconverted.length }} 筆支出還沒有匯率</strong>
      <p class="tiny">
        這些支出是在匯率功能之前記的，沒有存換算金額，所以沒有算進下面的結算。
        打開編輯再存一次就會補上匯率。
      </p>
      <ul class="tiny list">
        <li v-for="expense in settlement.unconverted" :key="expense.id">
          {{ expense.title }} · {{ expense.currency }} {{ formatAmount(expense.amount, expense.currency) }}
        </li>
      </ul>
    </div>

    <section class="card stack">
      <div class="spread">
        <strong class="section-title">{{ settlement.currency }}</strong>
        <span class="tiny">
          {{ settlement.expenseCount }} 筆 · 共 {{ money(settlement.total) }}
          <template v-if="settlement.paidTotal > 0"> · 已付 {{ money(settlement.paidTotal) }}</template>
        </span>
      </div>

      <p v-if="hasForeign" class="tiny">
        外幣支出用記帳當下的匯率換算成 {{ settlement.currency }}，之後匯率變動不會影響已記的帳。
      </p>

      <div class="stack rows">
        <div v-for="item in settlement.balances" :key="item.uid" class="balance">
          <div class="who">
            <strong>{{ name(item.uid) }}</strong>
            <span v-if="item.uid === currentUid" class="tiny">你</span>
          </div>
          <div class="numbers">
            <span class="result" :class="{ receive: item.balance > 0, pay: item.balance < 0 }">
              <template v-if="item.balance > 0">應收 {{ money(item.balance) }}</template>
              <template v-else-if="item.balance < 0">應付 {{ money(-item.balance) }}</template>
              <template v-else>已結清</template>
            </span>
            <span class="tiny">先付 {{ money(item.paid) }} · 分攤 {{ money(item.owed) }}</span>
          </div>
        </div>
      </div>

      <div class="stack rows">
        <div class="spread">
          <span class="label">還需要的轉帳</span>
          <button class="btn btn-ghost btn-sm" @click="copySettlement">
            {{ copied ? "已複製" : "複製結算" }}
          </button>
        </div>
        <p v-if="copyError" class="tiny warn">{{ copyError }}</p>
        <p v-if="!settlement.transfers.length" class="tiny">大家都已結清，不需要轉帳。</p>

        <div v-for="transfer in settlement.transfers" :key="transferKey(transfer.from, transfer.to)" class="transfer">
          <div class="spread">
            <span class="ends">
              <strong>{{ name(transfer.from) }}</strong>
              <span class="arrow">→</span>
              <strong>{{ name(transfer.to) }}</strong>
            </span>
            <div class="row end">
              <strong>{{ money(transfer.amount) }}</strong>
              <button
                v-if="canRecord(transfer.from) && openKey !== transferKey(transfer.from, transfer.to)"
                class="btn btn-ghost btn-sm"
                :disabled="busy"
                @click="openRecord(transfer.from, transfer.to, transfer.amount)"
              >
                記錄已付款
              </button>
            </div>
          </div>

          <div v-if="openKey === transferKey(transfer.from, transfer.to)" class="draft stack">
            <label class="field">
              <span class="label">實際付了多少（可以只付一部分）</span>
              <input v-model="draftAmount" class="input" inputmode="decimal" />
            </label>
            <p v-if="draftError" class="tiny warn">{{ draftError }}</p>
            <p v-else class="tiny">送出後要等 {{ name(transfer.to) }} 確認收到，餘額才會更新。</p>
            <div class="row">
              <button
                class="btn btn-primary btn-sm"
                :disabled="busy"
                @click="submitRecord(transfer.from, transfer.to)"
              >
                送出
              </button>
              <button class="btn btn-sm" :disabled="busy" @click="closeRecord">取消</button>
            </div>
          </div>
        </div>
      </div>

      <div v-if="pendingPayments.length" class="stack rows">
        <span class="label">等待確認（還沒算進餘額）</span>
        <div v-for="payment in pendingPayments" :key="payment.id" class="transfer">
          <div class="spread">
            <span class="ends">
              <strong>{{ name(payment.from) }}</strong>
              <span class="arrow">→</span>
              <strong>{{ name(payment.to) }}</strong>
            </span>
            <div class="row end">
              <strong>{{ formatAmount(payment.amount, payment.currency) }}</strong>
              <button
                v-if="canConfirm(payment)"
                class="btn btn-primary btn-sm"
                :disabled="busy"
                @click="emit('confirm', payment.id)"
              >
                確認收到
              </button>
              <button
                v-if="canDelete(payment)"
                class="btn btn-danger btn-sm"
                :disabled="busy"
                @click="emit('remove', payment.id)"
              >
                刪除
              </button>
            </div>
          </div>
          <p class="tiny">等 {{ name(payment.to) }} 確認</p>
        </div>
      </div>

      <div v-if="confirmedPayments.length" class="stack rows">
        <span class="label">已確認的付款</span>
        <div v-for="payment in confirmedPayments" :key="payment.id" class="transfer">
          <div class="spread">
            <span class="ends">
              <strong>{{ name(payment.from) }}</strong>
              <span class="arrow">→</span>
              <strong>{{ name(payment.to) }}</strong>
            </span>
            <div class="row end">
              <strong class="done">{{ formatAmount(payment.amount, payment.currency) }}</strong>
              <button
                v-if="canDelete(payment)"
                class="btn btn-sm"
                :disabled="busy"
                @click="emit('remove', payment.id)"
              >
                取消這筆
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <CategoryChart :expenses="expenses" :currency="settlement.currency" />
  </div>
</template>

<style scoped>
.warn-card {
  box-shadow: none;
  border-color: #f3d2ce;
  background: #fff5f5;
}

.list {
  margin: 0;
  padding-left: 18px;
}

.rows {
  gap: 10px;
}

.balance,
.transfer {
  padding: 10px 0;
  border-top: 1px solid var(--color-line);
}

.balance {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.balance:first-child,
.transfer:first-of-type {
  border-top: 0;
}

.transfer .spread {
  gap: 10px;
  flex-wrap: wrap;
}

.row.end {
  flex: none;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}

.who {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.numbers {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  flex: none;
  text-align: right;
}

.result {
  font-weight: 800;
  color: var(--color-muted);
}

.result.receive {
  color: var(--color-success);
}

.result.pay {
  color: var(--color-danger);
}

.done {
  color: var(--color-success);
}

.ends {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.arrow {
  color: var(--color-soft);
}

.draft {
  margin-top: 10px;
  padding: 12px;
  border-radius: 14px;
  background: var(--color-surface);
}

.draft .tiny {
  margin: 0;
}

.warn {
  color: var(--color-danger);
}
</style>
