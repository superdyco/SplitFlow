<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
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
import { getTaskMember, listTaskMembers } from "@/services/memberService";
import { listExpenses } from "@/services/expenseService";
import { myTripCost, sumByCurrency } from "@/utils/myCost";
import { partitionTasks } from "@/utils/taskStatus";
import { formatAmount } from "@/utils/currency";
import { firebaseErrorMessage } from "@/utils/firestore";

const authStore = useAuthStore();
const loading = ref(true);
const error = ref<string | null>(null);
const rows = ref<Array<{ task: Task; role: TaskRole }>>([]);

/**
 * 讀取分兩步：先查任務清單，再逐一讀自己在該任務的角色。
 * 出錯時標明是哪一步，不然畫面只會顯示一句看不出來源的權限錯誤。
 */
async function load() {
  const uid = authStore.user?.uid;
  if (!uid) return;
  loading.value = true;
  error.value = null;
  try {
    const tasks = await listUserTasks(uid).catch(err => {
      throw new Error(`讀取任務列表失敗：${firebaseErrorMessage(err)}`);
    });

    rows.value = await Promise.all(
      tasks.map(async task => {
        const member = await getTaskMember(task.id, uid).catch(err => {
          throw new Error(`讀取「${task.name}」的角色失敗：${firebaseErrorMessage(err)}`);
        });
        return { task, role: member?.role || ("member" as TaskRole) };
      })
    );
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

/** 只算進行中的：已封存的旅程帳都結完了，不該再算進「我的花費」。 */
const totals = computed(() =>
  sumByCurrency(
    partitioned.value.active.map(row => ({
      currency: row.task.defaultCurrency,
      amount: costs.value.get(row.task.id) ?? 0
    }))
  )
);

async function loadCosts() {
  const uid = authStore.user?.uid;
  if (!uid) return;
  costsLoading.value = true;
  costsError.value = null;
  try {
    // 已封存的任務不需要為了算花費而把支出全部載下來。
    const entries = await Promise.all(
      partitioned.value.active.map(async row => {
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
  } finally {
    costsLoading.value = false;
  }
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

onMounted(load);
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

      <!-- 只剩封存任務的人不該看到一顆算不出東西的按鈕。 -->
      <template v-if="!loading && !error && partitioned.active.length">
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
        <!--
          封存的一律傳 null 而不是 0：那些任務沒有被計算，
          傳 0 會顯示成「花了 0 元」，是錯的。
        -->
        <TaskCard
          v-for="row in partitioned.archived"
          :key="row.task.id"
          :task="row.task"
          :role="row.role"
          :my-cost="null"
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
  color: var(--color-primary);
  font-size: 12px;
  font-weight: 700;
}

.link:disabled {
  color: var(--color-muted);
}

.total {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.figure {
  font-size: 22px;
  font-variant-numeric: tabular-nums;
}

.warn {
  color: var(--color-danger);
}
</style>
