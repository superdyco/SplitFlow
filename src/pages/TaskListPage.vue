<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import AppLayout from "@/layouts/AppLayout.vue";
import EmptyState from "@/components/common/EmptyState.vue";
import ErrorState from "@/components/common/ErrorState.vue";
import LoadingState from "@/components/common/LoadingState.vue";
import TaskCard from "@/components/task/TaskCard.vue";
import type { Task } from "@/types/task";
import type { TaskRole } from "@/types/member";
import { useAuthStore } from "@/stores/auth";
import { listUserTasks } from "@/services/taskService";
import { getTaskMember, listTaskMembers } from "@/services/memberService";
import { listExpenses } from "@/services/expenseService";
import { myTripCost, sumByCurrency } from "@/utils/myCost";
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

const totals = computed(() =>
  sumByCurrency(
    rows.value.map(row => ({
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
    const entries = await Promise.all(
      rows.value.map(async row => {
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
        v-if="!loading && !error && rows.length === 0"
        title="目前沒有進行中的分帳"
        message="建立一個新任務，或從別人傳來的邀請連結加入。"
      >
        <RouterLink to="/tasks/new" class="btn btn-primary" style="margin-top: 16px">建立分帳任務</RouterLink>
      </EmptyState>

      <template v-if="!loading && !error && rows.length">
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

      <div v-if="!loading && rows.length" class="stack">
        <TaskCard
          v-for="row in rows"
          :key="row.task.id"
          :task="row.task"
          :role="row.role"
          :my-cost="costsLoaded ? costs.get(row.task.id) ?? 0 : null"
        />
      </div>
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
