<script setup lang="ts">
import WeatherChip from "@/components/expense/WeatherChip.vue";
/**
 * 公開的旅費報告。**任何人都能開，不需要帳號。**
 *
 * 刻意不套 AppLayout：那會顯示「我的分帳」導覽列，對沒有帳號的訪客沒有意義，
 * 還會誘導他去點。地圖是一張存在 Storage 的靜態圖片，這個頁面不載 Maps SDK、
 * 也不帶任何 API 金鑰 —— 連結會被到處轉傳，不能把金鑰跟著送出去。
 */
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import type { TripReport } from "@/types/report";
import { getPublicReport } from "@/services/reportService";
import { categoryMeta } from "@/types/expense";
import { formatAmount } from "@/utils/currency";
import { visiblePlaces } from "@/utils/reportPlaces";
import { reportMapUrl } from "@/services/reportMap";
import ReportBar from "@/components/report/ReportBar.vue";
import { addFavorite, isFavorited, removeFavorite } from "@/services/favoriteService";
import { useAuthStore } from "@/stores/auth";
import { toFavoriteInput } from "@/utils/favorites";
import { firebaseErrorMessage } from "@/utils/firestore";

const route = useRoute();
const router = useRouter();
const taskId = String(route.params.taskId || "");
const reportId = String(route.params.reportId || "");

const report = ref<TripReport | null>(null);
const loading = ref(true);
const mapLoaded = ref(false);
const mapFailed = ref(false);

/**
 * 讀失敗與「不存在」在這裡是同一件事：規則會讓已撤銷的報告讀取失敗，
 * 所以 client 分不出「連結錯了」與「已關閉」。
 *
 * 而且就算分得出來也不該分 —— 回「這份報告已關閉」等於告訴陌生人
 * 「這個 ID 是真的，只是被關起來」，那是不必要的資訊洩漏。
 */
const notFound = computed(() => !loading.value && !report.value);

/**
 * 只有從 app 裡面點進來的人才給返回鍵。
 *
 * 這頁刻意沒有導覽列，裝成 App 的時候連瀏覽器的上一頁都沒有 —— 發起人自己
 * 按「開啟」進來就會卡在這裡，只剩頁尾那行 SplitFlow 能回首頁。
 *
 * 判斷用 `history.state.back`：那是 vue-router 記的上一個站內位置，整頁重新
 * 載入會是 null。所以從 LINE 點連結開新分頁的訪客不會看到這顆 —— 他的上一頁
 * 不是這個 app，把他丟回去只會回到不相干的地方。
 */
const cameFromApp = ref(Boolean(window.history.state?.back));

const dateRange = computed(() => {
  const value = report.value;
  if (!value?.startDate || !value.endDate) return "";
  return `${value.startDate} – ${value.endDate}`;
});

const places = computed(() => visiblePlaces(report.value?.places ?? []));

const timeline = computed(() => report.value?.timeline ?? []);

/**
 * 有支出就列，不要求一定有時間。
 *
 * 本來是「整份都沒時間就整區不渲染」，但這樣做的話時間欄位之前的旅程
 * 永遠看不到這一區 —— 而封存的任務是唯讀的，那些支出連補時間都補不了。
 * 沒有時間的日子照樣看得出「這天去了哪、花了多少」，那本身就值得一看。
 */
const showTimeline = computed(() => timeline.value.length > 0);

/**
 * 整份都沒有時間就把時間欄整欄收掉，不要留一排「—」。
 * 只要有一筆有時間就整份都留欄位，這樣每一天的縮排才會一致。
 */
const showTimes = computed(() =>
  timeline.value.some(day => day.entries.some(entry => entry.time))
);

/**
 * `mapPath` 是 null 就完全不渲染地圖區塊，也不發任何請求。
 *
 * 網址由路由參數組出來，跟文件裡的 `mapPath` 等價 —— `useTripReport` 寫進去的
 * 就是 `reportMapPath(taskId, reportId)`。這裡只拿 `mapPath` 當「有沒有圖」的旗標。
 */
const mapSrc = computed(() => (report.value?.mapPath ? reportMapUrl(taskId, reportId) : null));

/**
 * `updatedAt` 是 serverTimestamp，寫入當下的本機快照可能還沒解析成 Timestamp。
 * 公開頁是從伺服器讀的所以正常都有，但拿不到時不該讓整頁掛掉。
 */
/** 年份在標題的日期區間就講過了，每一天再印一次太吵。 */
function dayLabel(date: string): string {
  return date.slice(5).replace("-", "/");
}

const generatedAt = computed(() => {
  const value = report.value?.updatedAt;
  if (!value?.toDate) return "";
  return value.toDate().toLocaleDateString("zh-TW");
});

/*
  收藏。

  這一頁不需要帳號就看得到，所以按鈕只給登入的人 —— 沒登入的看到的是一句
  「登入後可以收藏」加一條連結，帶著 redirect 回來。不做成「按了才發現要登入」，
  那會讓人白按一次還跳走。

  刻意不在這裡放整組導覽列（見檔案開頭的說明）：訪客是從 LINE 之類的地方
  點進來的，這一頁的工作是把旅程講清楚，不是把他推去註冊。
*/
const authStore = useAuthStore();
const saved = ref(false);
const favoriteBusy = ref(false);
const favoriteError = ref<string | null>(null);
const loginPath = computed(
  () => `/login?redirect=${encodeURIComponent(`/r/${taskId}/${reportId}`)}`
);

async function toggleFavorite() {
  const user = authStore.user;
  const current = report.value;
  if (!user || !current || favoriteBusy.value) return;

  favoriteBusy.value = true;
  favoriteError.value = null;
  const wasSaved = saved.value;
  // 樂觀更新：這顆按鈕的回饋要立即，不然會被連按。失敗再改回去。
  saved.value = !wasSaved;

  try {
    if (wasSaved) await removeFavorite(user.uid, taskId, reportId);
    else await addFavorite(user.uid, toFavoriteInput(taskId, reportId, current));
  } catch (err) {
    saved.value = wasSaved;
    favoriteError.value = firebaseErrorMessage(err);
  } finally {
    favoriteBusy.value = false;
  }
}

async function load() {
  loading.value = true;
  try {
    report.value = await getPublicReport(taskId, reportId);
  } catch {
    report.value = null;
  } finally {
    loading.value = false;
  }

  // 報告讀不到就不必問收藏了 —— 那個連結已經沒有意義。
  const user = authStore.user;
  if (!user || !report.value) return;
  try {
    saved.value = await isFavorited(user.uid, taskId, reportId);
  } catch {
    // 問不到就當作沒收藏。按下去會蓋寫同一個 id，不會變成兩筆。
    saved.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="page">
    <button v-if="cameFromApp" type="button" class="back" @click="router.back()">
      ← 返回
    </button>

    <p v-if="loading" class="tiny center">讀取中...</p>

    <p v-else-if="notFound" class="center">
      找不到這份報告。連結可能不完整，或發起人已經把它關閉了。
    </p>

    <template v-else-if="report">
      <h1 class="title center">{{ report.taskName }}</h1>
      <p class="tiny center">
        <template v-if="dateRange">{{ dateRange }} · </template>
        <template v-if="report.days">{{ report.days }} 天 · </template>
        {{ report.memberCount }} 人
      </p>

      <div class="favorite">
        <button
          v-if="authStore.user"
          type="button"
          class="btn btn-sm"
          :class="saved ? 'btn-saved' : 'btn-primary'"
          :disabled="favoriteBusy"
          @click="toggleFavorite"
        >
          {{ saved ? "♥ 已收藏" : "♡ 收藏這趟旅程" }}
        </button>
        <p v-else class="tiny">
          <RouterLink :to="loginPath">登入</RouterLink> 之後可以把這趟旅程收藏起來。
        </p>
        <p v-if="favoriteError" class="tiny warn">{{ favoriteError }}</p>
      </div>

      <section class="card hero">
        <p class="tiny">每人平均</p>
        <strong class="figure">
          {{ report.currency }} {{ formatAmount(report.perPerson, report.currency) }}
        </strong>
        <p class="tiny">
          總花費 {{ report.currency }} {{ formatAmount(report.total, report.currency) }} ·
          {{ report.expenseCount }} 筆 · {{ report.places.length }} 個地點
        </p>
      </section>

      <section v-if="report.categories.length" class="card stack">
        <strong class="section-title">花在哪</strong>
        <div v-for="item in report.categories" :key="item.category" class="entry">
          <div class="line">
            <span class="name">
              {{ categoryMeta(item.category).icon }} {{ categoryMeta(item.category).label }}
            </span>
            <span class="tiny count">{{ Math.round(item.share) }}%</span>
            <span class="amount">{{ formatAmount(item.total, report.currency) }}</span>
          </div>
          <ReportBar :value="item.share / 100" />
        </div>
      </section>

      <!--
        骨架先把 8:5 的位置佔住（對應 640x400 的靜態地圖），圖載完才淡入。
        用 v-show 而不是 v-if：v-if 會讓 <img> 在載完前不存在，等於沒開始下載。
      -->
      <div v-if="mapSrc && !mapFailed" class="map-slot">
        <div v-if="!mapLoaded" class="map-skeleton" />
        <img
          v-show="mapLoaded"
          :src="mapSrc"
          alt="去過的地方"
          class="map"
          @load="mapLoaded = true"
          @error="mapFailed = true"
        />
      </div>

      <section v-if="places.rows.length" class="card stack">
        <strong class="section-title">去過的地方</strong>
        <div v-for="row in places.rows" :key="row.name" class="entry">
          <div class="line">
            <span class="name">{{ row.name }}</span>
            <span class="tiny count">{{ row.expenseCount }} 筆</span>
            <span class="amount">{{ formatAmount(row.total, report.currency) }}</span>
          </div>
          <ReportBar v-if="row.bar !== null" :value="row.bar" soft />
        </div>
        <p v-if="places.hiddenCount" class="tiny">還有 {{ places.hiddenCount }} 個地點</p>
      </section>

      <!--
        時間軸放在最後：前面幾區回答「花了多少、花在哪」，這一區回答「怎麼過的」。
        沒有名稱可放，所以每一列是「幾點 · 分類圖示 · 地點（沒有地點就寫分類）· 金額」。
      -->
      <section v-if="showTimeline" class="card stack">
        <strong class="section-title">每天怎麼過的</strong>
        <div v-for="day in timeline" :key="day.date" class="day">
          <div class="line">
            <span class="name day-head">
              Day {{ day.day }} · {{ dayLabel(day.date) }}
              <!--
                舊報告沒有這個欄位，所以一定要 v-if 而不是假設它存在 ——
                這次改動之前產生的報告要照樣打得開。
              -->
              <WeatherChip v-if="day.weather" :weather="day.weather" show-label />
            </span>
            <span class="amount">{{ formatAmount(day.total, report.currency) }}</span>
          </div>
          <ol class="entries">
            <!--
              沒有 id 可以當 key —— 報告裡刻意不存支出 id。這份清單是死的快照，
              不會新增刪除也不會重排，用索引當 key 是安全的。
            -->
            <li v-for="(entry, index) in day.entries" :key="index" class="line entry-row">
              <!-- 這份報告有時間才留這一欄；沒記時間的那幾筆用破折號佔位，
                   時間欄才不會忽寬忽窄。 -->
              <span v-if="showTimes" class="tiny time">{{ entry.time || "—" }}</span>
              <span class="name">
                {{ categoryMeta(entry.category).icon }}
                {{ entry.place || categoryMeta(entry.category).label }}
              </span>
              <span class="amount">{{ formatAmount(entry.amount, report.currency) }}</span>
            </li>
          </ol>
        </div>
      </section>

      <p class="tiny center footer">
        <template v-if="generatedAt">產生於 {{ generatedAt }} · </template>
        由 <a href="/">簡單分帳</a> 產生
      </p>
    </template>
  </div>
</template>

<style scoped>
/* 收藏放在標題與數字之間：看到是誰的旅程之後、還沒往下捲之前。 */
.favorite {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  margin-top: 4px;
  text-align: center;
}

.page {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: 560px;
  margin: 0 auto;
  padding: 24px 16px 48px;
}

.center {
  text-align: center;
}

/*
  靠左、不撐滿：.page 是 flex column，不寫 align-self 按鈕會被拉成整行寬。
  `.link` 在這個專案是各頁自己寫的 scoped 樣式，不是全域類別，所以這裡要有自己的一份。
*/
.back {
  align-self: flex-start;
  border: 0;
  background: none;
  padding: 0;
  color: var(--color-primary-dark);
  font-size: var(--text-control-sm);
  font-weight: 700;
}

.hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  /* .page 的 gap 是 16px，這裡再加 8px 讓主角與下一張卡拉開成 24px。 */
  margin-bottom: 8px;
  padding: 24px 18px;
  text-align: center;
  background: var(--color-primary-soft);
  border-color: var(--color-primary-soft);
}

.figure {
  font-size: var(--text-hero);
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

.entry {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

/*
  骨架與圖疊在同一個固定比例的容器裡，位置從一開始就定死。
  沒有這個容器的話，圖載完才撐出高度，下面的內容會被整塊推走。
*/
.map-slot {
  position: relative;
  aspect-ratio: 8 / 5;
}

.map,
.map-skeleton {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-line);
}

.map {
  object-fit: cover;
  animation: fade-in 0.3s ease;
}

.map-skeleton {
  background: linear-gradient(
    90deg,
    var(--color-line) 25%,
    var(--color-surface) 50%,
    var(--color-line) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.4s infinite;
}

@keyframes shimmer {
  from {
    background-position: 200% 0;
  }
  to {
    background-position: -200% 0;
  }
}

@keyframes fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.line {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
}

.day {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.day-head {
  font-weight: 700;
}

/*
  時間軸那條線：清單本身的左框線就是軸，每一列用 ::before 點在上面。
  故意不做成每列各自的裝飾 —— 一條連續的線才看得出「這是同一天」。
*/
.entries {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 2px 0 0;
  padding: 2px 0 2px 12px;
  border-left: 2px solid var(--color-line);
  list-style: none;
}

.entry-row {
  position: relative;
}

/* -17px = 左內距 12 + 框線 2，再往左半顆點（4）讓它正好騎在線上。 */
.entry-row::before {
  content: "";
  position: absolute;
  left: -17px;
  top: 0.5em;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-line-strong);
}

.time {
  flex: none;
  width: 40px;
  font-variant-numeric: tabular-nums;
}

.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.amount {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.count {
  flex: none;
}

.footer a {
  color: var(--color-primary-dark);
}
</style>
