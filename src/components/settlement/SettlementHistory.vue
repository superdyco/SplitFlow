<script setup lang="ts">
import { computed, ref } from "vue";
import type { Settlement, SettlementSnapshot } from "@/types/settlement";
import { formatAmount } from "@/utils/currency";
import { matchesSnapshot } from "@/utils/settlement";
import { formatDateTime } from "@/utils/firestore";
import { buildSettlementText } from "@/utils/settlementText";
import { useCopy } from "@/composables/useCopy";

const props = defineProps<{
  settlement: Settlement;
  snapshots: SettlementSnapshot[];
  taskName: string;
  canManage: boolean;
  busy: boolean;
}>();

const emit = defineEmits<{
  (e: "save", note: string): void;
  (e: "remove", settlementId: string): void;
}>();

const composing = ref(false);
const note = ref("");
const openId = ref<string | null>(null);

const latest = computed(() => props.snapshots[0] ?? null);
/** 上次存快照之後帳目有沒有再變動。沒有快照就不用提示。 */
const changedSinceLatest = computed(
  () => !!latest.value && !matchesSnapshot(props.settlement, latest.value)
);

function money(value: number, currency: string) {
  return formatAmount(value, currency);
}

function toggle(id: string) {
  openId.value = openId.value === id ? null : id;
}

function submit() {
  emit("save", note.value.trim().slice(0, 200));
  note.value = "";
  composing.value = false;
}

const { copied, error: copyError, copy } = useCopy();

/**
 * 快照自帶 memberNames，所以有人改暱稱或離開任務之後，
 * 複製出來的仍是結算當時的名字。
 */
function copySnapshot(snapshot: SettlementSnapshot) {
  return copy(
    buildSettlementText({
      taskName: props.taskName,
      currency: snapshot.currency,
      transfers: snapshot.transfers,
      memberNames: snapshot.memberNames,
      expenseCount: snapshot.expenseCount,
      total: snapshot.total,
      snapshotDate: formatDateTime(snapshot.createdAt) || "剛剛",
      note: snapshot.note
    })
  );
}
</script>

<template>
  <section class="card stack">
    <div class="spread">
      <strong class="section-title">結算紀錄</strong>
      <button
        v-if="canManage && !composing"
        class="btn btn-ghost btn-sm"
        :disabled="busy"
        @click="composing = true"
      >
        儲存這次結算
      </button>
    </div>

    <p v-if="!snapshots.length" class="tiny">
      還沒有結算紀錄。把目前的結果存下來，之後帳目再變動也查得到當時算出來是多少。
    </p>
    <p v-else-if="changedSinceLatest" class="tiny warn">
      上次結算之後帳目又變動了，下面的紀錄是當時的結果，不是現在的。
    </p>
    <p v-else class="tiny">目前的帳目跟最近一次結算紀錄一致。</p>

    <div v-if="composing" class="draft stack">
      <label class="field">
        <span class="label">備註（選填）</span>
        <input v-model="note" class="input" maxlength="200" placeholder="例如：曼谷回國當天結算" />
      </label>
      <p class="tiny">
        會把目前的應收應付、轉帳建議與大家的暱稱一起存成一份紀錄。存下來之後不能修改，只能刪除。
      </p>
      <div class="row">
        <button class="btn btn-primary btn-sm" :disabled="busy" @click="submit">存成紀錄</button>
        <button class="btn btn-sm" :disabled="busy" @click="composing = false">取消</button>
      </div>
    </div>

    <div v-for="snapshot in snapshots" :key="snapshot.id" class="entry">
      <button type="button" class="entry-head" @click="toggle(snapshot.id)">
        <span class="entry-main">
          <strong>{{ formatDateTime(snapshot.createdAt) || "剛剛" }}</strong>
          <span class="tiny">
            {{ snapshot.expenseCount }} 筆 · 共
            {{ money(snapshot.total, snapshot.currency) }} {{ snapshot.currency }}
            <template v-if="snapshot.note"> · {{ snapshot.note }}</template>
          </span>
        </span>
        <span class="chevron" aria-hidden="true">{{ openId === snapshot.id ? "▾" : "▸" }}</span>
      </button>

      <div v-if="openId === snapshot.id" class="detail stack">
        <div class="stack rows">
          <span class="label">當時的應收應付</span>
          <div v-for="item in snapshot.balances" :key="item.uid" class="line">
            <span>{{ snapshot.memberNames[item.uid] || "已離開的成員" }}</span>
            <strong :class="{ receive: item.balance > 0, pay: item.balance < 0 }">
              <template v-if="item.balance > 0">應收 {{ money(item.balance, snapshot.currency) }}</template>
              <template v-else-if="item.balance < 0">應付 {{ money(-item.balance, snapshot.currency) }}</template>
              <template v-else>已結清</template>
            </strong>
          </div>
        </div>

        <div class="stack rows">
          <div class="spread">
            <span class="label">當時的轉帳建議</span>
            <button class="btn btn-ghost btn-sm" @click="copySnapshot(snapshot)">
              {{ copied ? "已複製" : "複製結算" }}
            </button>
          </div>
          <p v-if="copyError" class="tiny warn">{{ copyError }}</p>
          <p v-if="!snapshot.transfers.length" class="tiny">當時已經全部結清。</p>
          <div v-for="(transfer, index) in snapshot.transfers" :key="index" class="line">
            <span>
              {{ snapshot.memberNames[transfer.from] || "已離開的成員" }}
              →
              {{ snapshot.memberNames[transfer.to] || "已離開的成員" }}
            </span>
            <strong>{{ money(transfer.amount, snapshot.currency) }}</strong>
          </div>
        </div>

        <button
          v-if="canManage"
          class="btn btn-danger btn-sm"
          :disabled="busy"
          @click="emit('remove', snapshot.id)"
        >
          刪除這筆紀錄
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.draft {
  padding: 12px;
  border-radius: 14px;
  background: var(--color-surface);
}

.draft .tiny {
  margin: 0;
}

.entry {
  border-top: 1px solid var(--color-line);
  padding-top: 10px;
}

.entry-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 4px 0;
  border: 0;
  background: none;
  text-align: left;
}

.entry-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.entry-main .tiny {
  margin: 0;
}

.chevron {
  flex: none;
  color: var(--color-muted);
}

.detail {
  padding: 10px 0 4px;
}

.rows {
  gap: 8px;
}

.line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.receive {
  color: var(--color-success);
}

.pay {
  color: var(--color-danger);
}

.warn {
  color: var(--color-danger);
}
</style>
