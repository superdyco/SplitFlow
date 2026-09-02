<script setup lang="ts">
import { computed } from "vue";
import { RouterLink, type RouteLocationRaw } from "vue-router";
import type { Settlement } from "@/types/settlement";
import { myOwed, myTransfers } from "@/utils/settlementSummary";
import { formatAmount } from "@/utils/currency";

const props = defineProps<{
  settlement: Settlement;
  uid: string;
  /** uid → 顯示名稱。TaskPage 已經有這個 computed。 */
  memberNames: Record<string, string>;
  settlementTo: RouteLocationRaw;
}>();

const owed = computed(() => myOwed(props.settlement.balances, props.uid));
const mine = computed(() => myTransfers(props.settlement.transfers, props.uid));

function money(amount: number) {
  return formatAmount(amount, props.settlement.currency);
}

function name(uid: string) {
  return props.memberNames[uid] ?? "已移除的成員";
}
</script>

<template>
  <section class="card summary">
    <p class="label">我的分攤</p>
    <p class="figure">{{ money(owed) }}</p>
    <!--
      筆數用 settlement.expenseCount（只數算得出金額的）而不是 task.expenseCount
      （全部）。兩者的差額正是未換算的那幾筆，而那條警告就在下面 —— 用全部的
      筆數會讓「總額」跟「筆數」對不起來，而且對不起來的方向剛好是讓數字看起來
      比較完整。
    -->
    <p class="tiny context">
      這趟總額 {{ money(settlement.total) }} · {{ settlement.expenseCount }} 筆
    </p>

    <div class="lines">
      <!--
        方向不能只靠顏色。文案本身就是「你付給 X」與「X 付給你」，
        色覺障礙的人讀文字就分得出來 —— 跟 .btn-saved 的雙重編碼同一個原則。
      -->
      <p v-for="line in mine.lines" :key="`${line.from}-${line.to}`" class="line">
        <span v-if="line.outgoing">你付給 {{ name(line.to) }}</span>
        <span v-else>{{ name(line.from) }} 付給你</span>
        <strong :class="{ incoming: !line.outgoing }">{{ money(line.amount) }}</strong>
      </p>

      <p v-if="mine.rest" class="tiny">還有 {{ mine.rest }} 筆</p>

      <!-- 已結清是好消息，值得一行字。留白會讓人以為是還沒算出來。 -->
      <p v-if="!mine.lines.length" class="line settled">已經結清</p>
    </div>

    <!--
      數字不完整時，話要講在數字旁邊。這個警告本來只存在於 SettlementPanel，
      而結算已經變成次頁 —— 不提上來的話，使用者會更少看到「上面那個數字
      少算了東西」。
    -->
    <p v-if="settlement.unconverted.length" class="warn">
      有 {{ settlement.unconverted.length }} 筆支出還沒有匯率，沒有算進上面的數字。
    </p>

    <RouterLink :to="settlementTo" class="more">完整結算與付款紀錄 →</RouterLink>
  </section>
</template>

<style scoped>
.summary {
  display: flex;
  flex-direction: column;
}

.label {
  margin: 0 0 var(--space-text);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
}

.figure {
  margin: 0;
  font-size: var(--text-display);
  font-weight: 800;
  letter-spacing: -0.03em;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.context {
  margin: var(--space-2) 0 0;
}

.lines {
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-line);
}

.line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  margin: 0 0 var(--space-2);
  font-size: var(--text-body);
}

.line:last-child {
  margin-bottom: 0;
}

.line strong {
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

/* 收錢跟付錢是相反方向的行動，不該長一樣。 */
.line strong.incoming {
  color: var(--color-success);
}

.settled {
  color: var(--color-muted);
}

.warn {
  margin: var(--space-3) 0 0;
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-line);
  font-size: var(--text-tiny);
  line-height: 1.65;
  color: var(--color-danger);
}

.more {
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-line);
  color: var(--color-primary-dark);
  font-size: var(--text-tiny);
  font-weight: 800;
  transition: color var(--dur-base) var(--ease);
}

.more:hover {
  color: var(--color-primary-deep);
}
</style>
