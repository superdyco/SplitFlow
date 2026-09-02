<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import AppLayout from "@/layouts/AppLayout.vue";
import EmptyState from "@/components/common/EmptyState.vue";
import ErrorState from "@/components/common/ErrorState.vue";
import LoadingState from "@/components/common/LoadingState.vue";
import TaskCard from "@/components/task/TaskCard.vue";
import ConfirmDialog from "@/components/common/ConfirmDialog.vue";
import type { Task, TaskStatus } from "@/types/task";
import type { TaskRole } from "@/types/member";
import { useAuthStore } from "@/stores/auth";
import { listUserTasks, setTaskStatus } from "@/services/taskService";
import { settleWrite } from "@/utils/offlineWrite";
import { listTaskMembers } from "@/services/memberService";
import { listExpenses } from "@/services/expenseService";
import { myTripCost, sumByCurrency } from "@/utils/myCost";
import { partitionTasks } from "@/utils/taskStatus";
import { taskRole } from "@/utils/taskRole";
import { formatAmount } from "@/utils/currency";
import { firebaseErrorMessage } from "@/utils/firestore";
import { finishTrace, markPhase, startTrace, traceDetail } from "@/utils/perfTrace";
import { reportTrace } from "@/services/perfService";
import { recoverConnection } from "@/services/networkRecovery";
import { readWithRecovery } from "@/utils/stallGuard";

const authStore = useAuthStore();
const loading = ref(true);
const error = ref<string | null>(null);
const rows = ref<Array<{ task: Task; role: TaskRole }>>([]);

/**
 * 一次查詢就夠：角色從 task 文件的 ownerId / adminIds 推導，不再逐一讀
 * members/{uid}。原本那組扇出佔掉冷啟動的 44%，而且包在 Promise.all 裡，
 * 任何一筆卡住整份清單都不會出現。
 */
async function load() {
  const uid = authStore.user?.uid;
  if (!uid) return;
  loading.value = true;
  error.value = null;
  try {
    /*
      卡住就重連。量測顯示這一趟有 44% 的機率會等 30 秒 —— 不是查詢慢
      （健康時 49～99ms），是連線死了沒人宣告。guardStall 負責宣告。
    */
    const tasks = await readWithRecovery(() => listUserTasks(uid), recoverConnection).catch(err => {
      throw new Error(`讀取任務列表失敗：${firebaseErrorMessage(err)}`);
    });
    // 只有這一趟是 Firestore 的時間。守衛與 chunk 的等待記在導航那邊。
    markPhase("query");
    rows.value = tasks.map(task => ({ task, role: taskRole(task, uid) }));
  } catch (err) {
    error.value = firebaseErrorMessage(err);
  } finally {
    loading.value = false;
  }
}

/**
 * 我的花費要把每個任務的支出全部載下來在前端算 —— 換算後的分攤金額沒有存在
 * 資料庫裡，沒辦法用 Firestore 的聚合查詢在伺服器端加總（跨幣別會算錯）。
 *
 * 所以做成按需載入：不點就維持列表原本的速度，點了才付「任務數 × 支出數」
 * 這個讀取成本。
 */
const costs = ref<Map<string, number>>(new Map());
const costsLoading = ref(false);
const costsError = ref<string | null>(null);
const costsLoaded = ref(false);

/** 已刪除的一律不出現在任何一區 —— 規則在 partitionTasks 裡，有測試釘住。 */
const partitioned = computed(() => partitionTasks(rows.value));

/**
 * 封存的也要算。封存代表「這趟結束了，不再記帳」，不代表錢沒花過 ——
 * 而且旅程通常是走完才封存，把它們排除掉，總花費會少掉最完整的那幾趟。
 * 已刪除的不算：那是使用者明確表示不要了。
 */
const costable = computed(() => [...partitioned.value.active, ...partitioned.value.archived]);

const totals = computed(() =>
  sumByCurrency(
    costable.value.map(row => ({
      currency: row.task.defaultCurrency,
      amount: costs.value.get(row.task.id) ?? 0
    }))
  )
);

async function loadCosts() {
  const uid = authStore.user?.uid;
  if (!uid) return;

  /*
    這裡自己開一個 trace，不併進進頁面那一個：它是使用者按了才發生的，
    而且成本是「任務數 × 2 趟查詢」的扇出。跟列表的載入混在同一筆裡，
    列表本身的數字就再也看不出乾不乾淨了。
  */
  startTrace("tasks-costs");
  traceDetail("taskCount", costable.value.length);
  traceDetail("expenseCount", costable.value.reduce((sum, row) => sum + row.task.expenseCount, 0));

  costsLoading.value = true;
  costsError.value = null;
  try {
    const entries = await Promise.all(
      costable.value.map(async row => {
        // 成員也要載：餘數分給誰取決於加入順序，少了它數字會跟結算頁差幾分錢。
        const [expenses, members] = await Promise.all([
          listExpenses(row.task.id),
          listTaskMembers(row.task.id)
        ]);
        const cost = myTripCost(
          expenses,
          members.map(member => member.uid),
          uid,
          row.task.defaultCurrency
        );
        return [row.task.id, cost] as const;
      })
    );
    costs.value = new Map(entries);
    costsLoaded.value = true;
  } catch (err) {
    costsError.value = firebaseErrorMessage(err);
    // 失敗的那一筆也要留：逾時而失敗通常就是最慢的那幾筆，濾掉它們會讓數字好看得不真實。
    traceDetail("failed", true);
  } finally {
    costsLoading.value = false;
  }

  markPhase("costs");
  const trace = finishTrace("tasks-costs");
  if (trace) reportTrace(trace);
}

/**
 * 對話框只有一個，住在頁面而不是每張卡各一個 —— DOM 裡永遠只有一份，
 * 而且「刪除的規則」集中在這裡而不是散在每張卡。
 */
const pending = ref<{ task: Task; next: TaskStatus } | null>(null);
const actionError = ref<string | null>(null);

const dialogTitle = computed(() => {
  if (!pending.value) return "";
  if (pending.value.next === "archived") return "封存這個任務？";
  if (pending.value.next === "active") return "解除封存？";
  return "刪除這個任務？";
});

const dialogMessage = computed(() => {
  const entry = pending.value;
  if (!entry) return "";
  if (entry.next === "archived") {
    return "封存之後資料留著可以查，但不能再記帳或修改。隨時可以解除。";
  }
  if (entry.next === "active") {
    return "解除之後這個任務就恢復正常，可以繼續記帳。";
  }
  // 刪除：講出實際規模，讓人知道自己在刪什麼。
  return `這個任務有 ${entry.task.memberCount} 位成員、${entry.task.expenseCount} 筆支出。刪除之後所有成員都會看不到，而且無法復原。`;
});

const dialogConfirmLabel = computed(() => {
  if (!pending.value) return "";
  if (pending.value.next === "archived") return "封存";
  if (pending.value.next === "active") return "解除封存";
  return "刪除";
});

/**
 * 分級摩擦：後果越嚴重、需要越刻意的動作。
 * 建錯的空任務刪掉風險是零，不該被懲罰；有支出的任務被誤刪是不可逆的災難。
 */
const dialogRequireText = computed(() => {
  const entry = pending.value;
  if (!entry || entry.next !== "deleted") return null;
  return entry.task.expenseCount > 0 ? entry.task.name : null;
});

function ask(task: Task, next: TaskStatus) {
  actionError.value = null;
  pending.value = { task, next };
}

async function confirmAction() {
  const entry = pending.value;
  if (!entry) return;
  pending.value = null;
  actionError.value = null;
  try {
    await settleWrite(setTaskStatus(entry.task.id, entry.next));
    // 不做樂觀更新：失敗時要把卡片放回去，多一組狀態換一點點速度，
    // 而這個操作一輩子按不到幾次。
    await load();
  } catch (err) {
    actionError.value = firebaseErrorMessage(err);
  }
}

/**
 * 收尾在這裡，因為只有頁面知道「東西真的出現在畫面上」是哪一刻 ——
 * 導航結束時畫面還是空的，那時候回報等於少算了最後一段。
 */
onMounted(async () => {
  // 導航已經完成、元件已經掛上。這一段是 Vue 建版面的時間，跟網路無關。
  markPhase("mount");
  await load();
  // nextTick 之後 DOM 才真的長出來。任務多的時候這一段自己就會說話。
  await nextTick();
  markPhase("render");

  const trace = finishTrace("tasks");
  if (trace) reportTrace(trace);
});
</script>

<template>
  <AppLayout>
    <div class="stack">
      <div class="spread">
        <div>
          <p class="tiny">哈囉</p>
          <h1 class="title">我的分帳</h1>
        </div>
        <RouterLink to="/tasks/new" class="btn btn-primary">＋ 建立</RouterLink>
      </div>

      <p class="tiny intro">
        專為出國旅行設計：多幣別記帳，匯率在當下就鎖住，事後波動不影響帳目。沒訊號也能記，
        連上網自動同步。收據可拍照存證。結算時自動算出最少的轉帳次數。
      </p>

      <LoadingState v-if="loading" title="讀取任務中" message="正在從 Firestore 取得你的任務。" />
      <ErrorState v-else :message="error" retryable :retrying="loading" @retry="load" />

      <EmptyState
        v-if="!loading && !error && partitioned.active.length === 0 && partitioned.archived.length === 0"
        title="目前沒有進行中的分帳"
        message="建立一個新任務，或從別人傳來的邀請連結加入。"
      >
        <RouterLink to="/tasks/new" class="btn btn-primary" style="margin-top: 16px">建立分帳任務</RouterLink>
      </EmptyState>

      <!-- 一個任務都沒有的人不該看到一顆算不出東西的按鈕。 -->
      <template v-if="!loading && !error && costable.length">
        <button
          v-if="!costsLoaded"
          class="btn btn-block"
          :disabled="costsLoading"
          @click="loadCosts"
        >
          {{ costsLoading ? "計算中..." : "計算我的花費" }}
        </button>

        <div v-else class="spread totals-row">
          <div class="totals">
            <div v-for="item in totals" :key="item.currency" class="total">
              <span class="tiny">{{ item.currency }}</span>
              <strong class="figure">{{ formatAmount(item.amount, item.currency) }}</strong>
            </div>
            <p v-if="!totals.length" class="tiny">目前還沒有算得出金額的支出。</p>
          </div>
          <button class="link" :disabled="costsLoading" @click="loadCosts">
            {{ costsLoading ? "計算中..." : "重新計算" }}
          </button>
        </div>

        <p v-if="costsError" class="tiny warn">{{ costsError }}</p>
      </template>

      <div v-if="!loading && partitioned.active.length" class="stack">
        <TaskCard
          v-for="row in partitioned.active"
          :key="row.task.id"
          :task="row.task"
          :role="row.role"
          :my-cost="costsLoaded ? costs.get(row.task.id) ?? 0 : null"
          @archive="ask($event, 'archived')"
          @unarchive="ask($event, 'active')"
          @delete="ask($event, 'deleted')"
        />
      </div>

      <div v-if="!loading && partitioned.archived.length" class="stack">
        <strong class="section-title">已封存</strong>
        <TaskCard
          v-for="row in partitioned.archived"
          :key="row.task.id"
          :task="row.task"
          :role="row.role"
          :my-cost="costsLoaded ? costs.get(row.task.id) ?? 0 : null"
          @archive="ask($event, 'archived')"
          @unarchive="ask($event, 'active')"
          @delete="ask($event, 'deleted')"
        />
      </div>

      <ErrorState :message="actionError" />

      <ConfirmDialog
        :open="pending !== null"
        :title="dialogTitle"
        :message="dialogMessage"
        :confirm-label="dialogConfirmLabel"
        :danger="pending?.next === 'deleted'"
        :require-text="dialogRequireText"
        @confirm="confirmAction"
        @cancel="pending = null"
      />
    </div>
  </AppLayout>
</template>

<style scoped>
.intro {
  margin: -4px 0 0;
  line-height: 1.7;
}

.totals-row {
  align-items: flex-end;
}

.totals {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 24px;
}

.link {
  flex: none;
  border: 0;
  background: none;
  padding: 0;
  color: var(--color-primary-dark);
  font-size: 12px;
  font-weight: 700;
}

.link:disabled {
  color: var(--color-muted);
}

.total {
  display: flex;
  flex-direction: column;
  gap: var(--space-text);
}

.figure {
  font-size: 22px;
  font-variant-numeric: tabular-nums;
}

.warn {
  color: var(--color-danger);
}
</style>
