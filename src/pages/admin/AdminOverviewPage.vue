<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { fetchOverview, type AdminOverview, type AdminRange } from "@/services/adminService";
import LoadingState from "@/components/common/LoadingState.vue";
import ErrorState from "@/components/common/ErrorState.vue";
import EmptyState from "@/components/common/EmptyState.vue";
import DauChart from "@/pages/admin/DauChart.vue";

const RANGES: Array<{ value: AdminRange; label: string }> = [
  { value: "7d", label: "7 天" },
  { value: "30d", label: "30 天" },
  { value: "90d", label: "90 天" }
];

const range = ref<AdminRange>("30d");
const data = ref<AdminOverview | null>(null);
const error = ref<string | null>(null);
const loading = ref(true);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    data.value = await fetchOverview(range.value);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

watch(range, load, { immediate: true });

const number = (n: number) => n.toLocaleString("zh-TW");

/**
 * 「本週 +N」只有在真的有彙總資料時才顯示。
 *
 * 沒資料的時候 weekly 全部是 0，而畫面上的「本週 +0」跟「本週真的沒有新增」
 * 看起來一模一樣 —— 前者是假的。寧可什麼都不顯示。
 */
const hasWeekly = computed(() => (data.value?.coverage?.present ?? 0) > 0);

/**
 * 前端與 functions 是**分開部署**的，中間一定有一段版本對不上的窗口 ——
 * 而且使用者的瀏覽器還可能拿著舊的 JS 打新的函式。
 *
 * 所以新欄位一律當成「可能不存在」。少了這一層，舊的 adminOverview 沒回
 * topTasks 時，`data.topTasks.length` 會在 undefined 上直接爆掉整頁 ——
 * 那不是「這一區沒東西」，是整個總覽白畫面。
 */
const topTasks = computed(() => data.value?.topTasks ?? []);

/** 同上：舊版的 adminOverview 沒有這個欄位。 */
const guests = computed(() => data.value?.guests ?? null);

const retention = computed(() => {
  const cohort = data.value?.cohort;
  // matured 是 0 的時候回 null 不回 0%：那天只是沒有任務滿七天，不是留存率是零。
  if (!cohort || cohort.matured <= 0) return null;
  return Math.round((cohort.retained / cohort.matured) * 100);
});


/**
 * 有沒有東西可以畫。
 *
 * **看的是「有沒有任何一天有值」，不是「有沒有彙總文件」。** 戳記開始收
 * 之前的日子文件是存在的，只是 dau 為 null —— 用 coverage 判斷的話，
 * 那幾天會讓這裡以為有資料，然後畫出一張空的圖表框。
 */
const hasSeries = computed(() => (data.value?.dau ?? []).some(point => point.value !== null));
</script>

<template>
  <main class="page">
    <section class="console">
      <header class="topbar">
        <div>
          <h1 class="title">總覽</h1>
          <p v-if="data" class="tiny">
            累計數字為此刻 · 每日資料至 {{ data.through }}
          </p>
        </div>
        <div class="seg" role="group" aria-label="時間區間">
          <button
            v-for="item in RANGES"
            :key="item.value"
            type="button"
            class="seg-item"
            :class="{ active: range === item.value }"
            @click="range = item.value"
          >
            {{ item.label }}
          </button>
        </div>
      </header>

      <LoadingState v-if="loading && !data" title="讀取中" message="正在統計" />
      <ErrorState v-else-if="error" :message="error" retryable :retrying="loading" @retry="load" />

      <template v-else-if="data">
        <div class="tiles">
          <div class="card tile">
            <div class="label">使用者總數</div>
            <div class="value">{{ number(data.totals.users) }}</div>
            <p v-if="hasWeekly" class="tiny up">本週 +{{ number(data.weekly.users) }}</p>
          </div>
          <div class="card tile">
            <div class="label">進行中任務</div>
            <div class="value">{{ number(data.totals.tasksActive) }}</div>
            <p v-if="hasWeekly" class="tiny up">本週 +{{ number(data.weekly.tasks) }}</p>
            <p class="tiny">另有 {{ number(data.totals.tasksArchived) }} 個已封存</p>
          </div>
          <div class="card tile">
            <div class="label">累計支出筆數</div>
            <div class="value">{{ number(data.totals.expenses) }}</div>
            <p v-if="hasWeekly" class="tiny up">本週 +{{ number(data.weekly.expenses) }}</p>
          </div>
          <div class="card tile">
            <div class="label">已刪除任務</div>
            <div class="value">{{ number(data.totals.tasksDeleted) }}</div>
            <p class="tiny">軟刪除，資料還在</p>
          </div>
        </div>

        <p v-if="hasWeekly && data.weekly.missingDays > 0" class="tiny gapwarn">
          本週有 {{ data.weekly.missingDays }} 天沒有彙總資料，上面的「本週 +N」少算了那幾天。
        </p>

        <div class="card">
          <div class="spread">
            <h2 class="card-head">每日活躍使用者</h2>
            <p class="tiny">當天有開啟 app 的帳號數</p>
          </div>

          <!--
            排程還沒開始寫每日彙總的時候，這裡不畫線也不顯示 0。

            那兩種都是在說一件沒有發生的事：0 代表「那天沒有人來」，而實際上
            是「那天還沒有人在數」。這條線唯一的用途就是被拿來做決定。
          -->
          <div v-if="!hasSeries" class="empty accruing">
            <h3 class="section-title">累積中</h3>
            <p class="tiny">
              活躍人數從使用者開啟 app 的那一刻才開始記，沒辦法從既有資料回推。<br />
              這條線會從記錄開始的那天長出來 —— 在那之前的日子是空的，不是 0。
            </p>
          </div>

          <DauChart v-else :points="data.dau" :dimmed="loading" />

          <p v-if="hasSeries && data.coverage.present < data.coverage.expected" class="tiny gap">
            這段期間有
            {{ data.coverage.expected - data.coverage.present }}
            天沒有彙總資料，線在那裡是斷的。
          </p>
        </div>

        <div class="card">
          <div class="spread">
            <h2 class="card-head">訪客</h2>
            <p class="tiny">免登入試用的人後來怎麼了 · 當下記的，算到今天</p>
          </div>
          <!--
            沒有紀錄時不顯示四個 0：那會被讀成「沒有人試用」，而實際上可能只是
            這個統計還沒部署、或這段期間之前還沒開始記。
          -->
          <div v-if="!guests || guests.recordedDays === 0" class="empty accruing">
            <p class="tiny">
              還沒有訪客紀錄。這個統計從部署那天才開始記，之前來過又走掉的訪客補不回來。
            </p>
          </div>
          <template v-else>
            <ul class="platforms">
              <li><span>按了試用</span><strong>{{ number(guests.totals.started) }}</strong></li>
              <li><span>綁定帳號</span><strong>{{ number(guests.totals.bound) }}</strong></li>
              <li><span>合併進既有帳號</span><strong>{{ number(guests.totals.merged) }}</strong></li>
              <li><span>登出離開</span><strong>{{ number(guests.totals.left) }}</strong></li>
            </ul>
            <p class="tiny plat-note">
              「按了試用」包含還沒取暱稱就走掉的人 —— 他們在使用者列表裡看不到。
            </p>
          </template>
        </div>

        <div class="card">
          <div class="spread">
            <h2 class="card-head">最活躍的任務</h2>
            <p class="tiny">照支出筆數，不含已刪除的</p>
          </div>
          <EmptyState
            v-if="topTasks.length === 0"
            title="還沒有任務"
            message="有人建立任務並開始記帳之後，這裡會列出前五名。"
          />
          <table v-else class="tbl">
            <thead>
              <tr>
                <th>任務</th><th>擁有者</th>
                <th class="r">成員</th><th class="r">支出</th><th class="r">最後活動</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="task in topTasks" :key="task.id">
                <td>
                  <span class="tname">{{ task.name || "（沒有名稱）" }}</span>
                  <span v-if="task.status !== 'active'" class="tiny"> · 已封存</span>
                </td>
                <td class="tiny">{{ task.ownerName || "—" }}</td>
                <td class="tiny r num">{{ task.memberCount }}</td>
                <td class="tiny r num">{{ task.expenseCount }}</td>
                <td class="tiny r num">{{ (task.updatedAt ?? "").slice(0, 10) || "—" }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="card">
          <h2 class="card-head">建立任務後有真的在用</h2>
          <p class="tiny">建立後 7 天內記了 3 筆以上支出</p>
          <div v-if="retention === null" class="empty accruing">
            <p class="tiny">跟活躍人數同一個來源，也還在累積。</p>
          </div>
          <div v-else class="ret">
            <span class="value">{{ retention }}%</span>
            <span class="tiny">
              {{ data.cohort?.matured }} 個滿七天的任務裡有 {{ data.cohort?.retained }} 個
            </span>
          </div>
        </div>

        <div class="card">
          <h2 class="card-head">使用裝置</h2>
          <div v-if="!data.platforms" class="empty accruing">
            <p class="tiny">跟活躍人數同一個來源，也還在累積。</p>
          </div>
          <ul v-else class="platforms">
            <li><span>網頁版</span><strong>{{ number(data.platforms.web) }}</strong></li>
            <li><span>Android App</span><strong>{{ number(data.platforms.android) }}</strong></li>
            <li><span>iPhone／iPad</span><strong>{{ number(data.platforms.ios) }}</strong></li>
          </ul>
          <p v-if="data.platforms" class="tiny plat-note">
            算的是當天<strong>最後一次</strong>開啟在哪 —— 同一個人同一天用了兩種裝置，只會算後面那次。
          </p>
        </div>
      </template>
    </section>
  </main>
</template>

<style scoped>
/*
  後台不套 .shell 的 820px 上限 —— 那個寬度是為了手機優先的記帳畫面訂的，
  而這裡是只有桌機會開的表格與圖。
*/
.console {
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

/*
  只有一頁的時候不放側邊導覽。一個只有一個項目的選單不是導覽，是裝飾 ——
  等第二頁進來再加。
*/
.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--space-4);
}

.tile .value {
  margin-top: var(--space-text);
  font-size: var(--text-display);
  font-weight: 900;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

.up {
  margin: var(--space-1) 0 0;
  color: var(--color-success);
  font-weight: 700;
}

.gapwarn {
  margin: 0;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  background: var(--color-danger-soft);
  border: 1px solid var(--color-danger-line);
  color: var(--color-ink);
}

.tbl {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  margin-top: var(--space-3);
}

.tbl th {
  text-align: left;
  padding: 0 var(--space-3) var(--space-2) 0;
  border-bottom: 1px solid var(--color-line);
  color: var(--color-muted);
  font-size: var(--text-tiny);
  font-weight: 700;
  white-space: nowrap;
}

.tbl td {
  padding: var(--space-3) var(--space-3) var(--space-3) 0;
  border-bottom: 1px solid var(--color-line);
}

.tbl tbody tr:last-child td {
  border-bottom: 0;
}

.tbl .r {
  text-align: right;
}

.tname {
  font-weight: 800;
}

.num {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.ret {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  margin-top: var(--space-3);
}

.ret .value {
  font-size: var(--text-display);
  font-weight: 900;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

.accruing {
  margin-top: var(--space-4);
}

.gap {
  margin-top: var(--space-3);
}

.platforms {
  list-style: none;
  margin: var(--space-4) 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.platforms li {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  font-weight: 700;
}

.platforms strong {
  font-variant-numeric: tabular-nums;
}

.plat-note {
  margin-top: var(--space-3);
}
</style>
