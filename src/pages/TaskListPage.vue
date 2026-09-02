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
import { myTripCost, sharesOf, totalsOf, type TripCost } from "@/utils/myCost";
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
/*
  算成功的與算失敗的分開存，而不是一個 Map 加上「查不到就當 0」。

  「算不出來」跟「花了零元」是兩件事。用 ?? 0 補的話，讀失敗的那趟
  會被當成零元算進總額與佔比 —— 數字少一截，分母錯掉，而畫面上看
  起來完全正常。
*/
const okCosts = ref<TripCost[]>([]);
const failedTasks = ref<Task[]>([]);
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

const totals = computed(() => totalsOf(okCosts.value));

/*
  卡片上的金額也走同一條規則：查不到就是 null，不是 0。

  TaskCard 的 myCost 收到 null 時整行不顯示，收到 0 會顯示「TWD 0」——
  對一趟讀失敗的旅程來說，後者是在說「這趟你沒花錢」，那是假的。
*/
const costById = computed(() => new Map(okCosts.value.map(item => [item.taskId, item.amount])));

/** 每個幣別一塊，各自一條佔比條。跨幣別不合併 —— 混成一條等於在說 1 TWD = 1 THB。 */
const blocks = computed(() =>
  totals.value.map(item => ({
    currency: item.currency,
    amount: item.amount,
    shares: sharesOf(okCosts.value, item.currency)
  }))
);

const barColors = ["var(--color-primary-b1)", "var(--color-primary-b2)", "var(--color-primary-b3)"];
function barColor(index: number) {
  // 第四段以後（只可能是「其他」）用中性色，不再往下分明度。
  return barColors[index] ?? "var(--color-line-strong)";
}

/*
  少算了就要講，而且要講是哪一趟。只寫「部分失敗」的話，使用者無法
  判斷這個數字能不能用。
*/
const failedNote = computed(() => {
  const names = failedTasks.value.map(task => task.name);
  if (!names.length) return null;
  return `有 ${names.length} 趟旅程沒讀到（${names.join("、")}），這個數字少算了那幾趟。`;
});

/*
  滾動計數只在使用者主動按下計算時跑。

  綁在 render 上的話，每次資料更新都會重跑，而且平常進頁面讀金額會被
  硬生生延後 0.6 秒 —— 金額正是這個 app 的重點。按了計算的人本來就在
  等，那 0.6 秒是他自己要求的。

  減少動態要自己判斷：requestAnimationFrame 是 JS，不受 CSS 那段
  prefers-reduced-motion 管。
*/
const countProgress = ref(1);

const reduceMotion =
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

function playCount() {
  if (reduceMotion) {
    countProgress.value = 1;
    return;
  }
  countProgress.value = 0;
  const start = performance.now();
  const step = (now: number) => {
    const p = Math.min((now - start) / 620, 1);
    // ease-out cubic，跟 --dur-count 與 --ease 同一組手感。
    countProgress.value = 1 - Math.pow(1 - p, 3);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function myCostOf(taskId: string) {
  return costById.value.get(taskId) ?? null;
}

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
    /*
      allSettled 而不是 all：原本任何一趟讀失敗就整個 reject，使用者按了
      計算、等完「任務數 × 2 趟查詢」，然後什麼都拿不到，只有一行紅字。
      算得出來的先給。
    */
    const settled = await Promise.allSettled(
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
        return {
          taskId: row.task.id,
          name: row.task.name,
          currency: row.task.defaultCurrency,
          amount: cost
        } satisfies TripCost;
      })
    );

    const ok: TripCost[] = [];
    const failed: Task[] = [];
    settled.forEach((result, index) => {
      if (result.status === "fulfilled") ok.push(result.value);
      else failed.push(costable.value[index].task);
    });

    okCosts.value = ok;
    failedTasks.value = failed;
    /*
      一趟都沒成功就不算「載好了」—— 那跟沒按過是一樣的狀態，給使用者
      一顆可以重試的按鈕比給一張空卡片有用。
    */
    costsLoaded.value = ok.length > 0;
    if (ok.length) playCount();

    // 失敗的那幾筆要留在 trace 裡：逾時而失敗通常就是最慢的那幾筆，
    // 濾掉它們會讓數字好看得不真實。
    if (failed.length) traceDetail("failed", failed.length);
  } catch (err) {
    // allSettled 不會 reject，走到這裡代表是預期外的錯誤。
    costsError.value = firebaseErrorMessage(err);
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

      <!--
        一個任務都沒有的人不該看到一顆算不出東西的按鈕。

        總花費是按需計算的，所以「還沒算」是每次進頁面的第一眼 ——
        那一格不能是空白，要直接講為什麼要按。
      -->
      <div v-if="!loading && !error && costable.length" class="card hero">
        <div class="hero-head">
          <span class="hero-label">我的總花費</span>
          <button class="btn-quiet hero-action" :disabled="costsLoading" @click="loadCosts">
            {{ costsLoading ? "計算中…" : costsLoaded ? "重新計算" : "計算" }}
          </button>
        </div>

        <p v-if="!costsLoaded && !costsLoading" class="hero-empty">
          跨旅程加總要把每趟的支出全部載下來，點一下才算。
        </p>

        <!-- 骨架的形狀就是結果的形狀，數字進來時不跳版。 -->
        <template v-else-if="costsLoading">
          <div class="skel skel-fig"></div>
          <div class="skel skel-bar"></div>
          <div class="skel skel-leg"></div>
        </template>

        <template v-else>
          <div v-for="(block, bi) in blocks" :key="block.currency" class="hero-block">
            <p class="hero-fig">
              <span class="hero-cur">{{ block.currency }}</span
              >{{ formatAmount(Math.round(block.amount * countProgress), block.currency) }}
            </p>
            <div v-if="block.shares.length" class="hero-bar">
              <i
                v-for="(share, si) in block.shares"
                :key="share.name"
                :style="{ flexGrow: share.ratio * countProgress, background: barColor(si) }"
              ></i>
            </div>
            <div v-if="block.shares.length" class="hero-leg">
              <span v-for="(share, si) in block.shares" :key="share.name">
                <em :style="{ background: barColor(si) }"></em>{{ share.name }}
                {{ Math.round(share.ratio * 100) }}%
              </span>
            </div>
            <p v-if="bi === 0 && failedNote" class="hero-warn">{{ failedNote }}</p>
          </div>
          <p v-if="!blocks.length" class="tiny">目前還沒有算得出金額的支出。</p>
        </template>

        <p v-if="costsError" class="hero-warn">{{ costsError }}</p>
      </div>

      <div v-if="!loading && partitioned.active.length" class="stack">
        <TaskCard
          v-for="row in partitioned.active"
          :key="row.task.id"
          :task="row.task"
          :role="row.role"
          :my-cost="myCostOf(row.task.id)"
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
          :my-cost="myCostOf(row.task.id)"
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
  margin: calc(var(--space-1) * -1) 0 0;
  line-height: 1.7;
}

.hero-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-2);
}

.hero-label {
  font-size: var(--text-tiny);
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
}

/*
  這張卡上唯一的橘色。它是這裡唯一可以按的東西。

  hover 也要自己寫一次：全域的 .btn-quiet:hover 跟 scoped 的
  .hero-action 特異性一樣，誰贏取決於打包順序 —— 不能賭。
*/
.hero-action {
  color: var(--color-primary-dark);
}

.hero-action:hover:not(:disabled) {
  color: var(--color-primary-deep);
}

/* 停用態用 soft：WCAG 1.4.3 豁免停用元件的對比要求，讀起來就是按不了。 */
.hero-action:disabled {
  color: var(--color-soft);
  cursor: not-allowed;
}

.hero-empty {
  margin: 0;
  color: var(--color-muted);
  line-height: 1.6;
}

.hero-block + .hero-block {
  margin-top: var(--space-4);
  padding-top: var(--space-4);
  border-top: 1px solid var(--color-line);
}

.hero-fig {
  margin: 0;
  font-size: var(--text-display);
  font-weight: 800;
  letter-spacing: -0.03em;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

/* 幣別不分主次：totalsOf 已經照金額排序，順序本身就是層次。 */
.hero-cur {
  margin-right: 7px;
  font-size: var(--text-body);
  font-weight: 700;
  color: var(--color-muted);
  letter-spacing: 0;
}

.hero-bar {
  display: flex;
  gap: 2px;
  height: 5px;
  margin: var(--space-3) 0 var(--space-2);
  border-radius: var(--radius-pill);
  overflow: hidden;
}

/*
  用 flex-grow 而不是 width —— 每一段的寬度是彼此的比例，改 width
  會讓它們各自算各自的，中途對不齊。

  過渡用 --dur-base 而不是 --dur-count：countProgress 每一幀都在變，
  再疊一個 620ms 的過渡會拖成一團糊。這裡只是把幀與幀之間抹平。
*/
.hero-bar i {
  display: block;
  flex-basis: 0;
  transition: flex-grow var(--dur-base) var(--ease);
}

.hero-leg {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  font-size: var(--text-tiny);
  color: var(--color-muted);
}

.hero-leg span {
  display: flex;
  align-items: center;
  gap: 5px;
}

.hero-leg em {
  width: 7px;
  height: 7px;
  border-radius: 2px;
}

/*
  少算了就要在數字旁邊講，而且要講是哪一趟。印在卡片外面的話，
  上面那個數字看起來仍然像是完整的。
*/
.hero-warn {
  margin: var(--space-3) 0 0;
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-line);
  font-size: var(--text-tiny);
  line-height: 1.65;
  color: var(--color-danger);
}

.skel {
  border-radius: 7px;
  background: linear-gradient(90deg, #efeae3 25%, #f7f3ee 50%, #efeae3 75%);
  background-size: 200% 100%;
  animation: shimmer 1.4s linear infinite;
}

.skel-fig {
  height: var(--text-display);
  width: 62%;
  margin-bottom: var(--space-3);
}

.skel-bar {
  height: 5px;
  margin-bottom: var(--space-2);
}

.skel-leg {
  height: 11px;
  width: 76%;
}

@keyframes shimmer {
  to {
    background-position: -200% 0;
  }
}
</style>
