<script setup lang="ts">
/**
 * 公開的旅費報告。**任何人都能開，不需要帳號。**
 *
 * 刻意不套 AppLayout：那會顯示「我的分帳」導覽列，對沒有帳號的訪客沒有意義，
 * 還會誘導他去點。地圖是一張存在 Storage 的靜態圖片，這個頁面不載 Maps SDK、
 * 也不帶任何 API 金鑰 —— 連結會被到處轉傳，不能把金鑰跟著送出去。
 */
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import type { TripReport } from "@/types/report";
import { getPublicReport } from "@/services/reportService";
import { categoryMeta } from "@/types/expense";
import { formatAmount } from "@/utils/currency";

const route = useRoute();
const taskId = String(route.params.taskId || "");
const reportId = String(route.params.reportId || "");

const report = ref<TripReport | null>(null);
const loading = ref(true);
const mapUrl = ref<string | null>(null);

/**
 * 讀失敗與「不存在」在這裡是同一件事：規則會讓已撤銷的報告讀取失敗，
 * 所以 client 分不出「連結錯了」與「已關閉」。
 *
 * 而且就算分得出來也不該分 —— 回「這份報告已關閉」等於告訴陌生人
 * 「這個 ID 是真的，只是被關起來」，那是不必要的資訊洩漏。
 */
const notFound = computed(() => !loading.value && !report.value);

const dateRange = computed(() => {
  const value = report.value;
  if (!value?.startDate || !value.endDate) return "";
  return `${value.startDate} – ${value.endDate}`;
});

async function load() {
  loading.value = true;
  try {
    report.value = await getPublicReport(taskId, reportId);
  } catch {
    report.value = null;
  } finally {
    loading.value = false;
  }

  const path = report.value?.mapPath;
  if (!path) return;
  try {
    const { getDownloadURL, getStorage, ref: storageRef } = await import("firebase/storage");
    const { app } = await import("@/firebase/config");
    mapUrl.value = await getDownloadURL(storageRef(getStorage(app), path));
  } catch {
    // 沒有地圖不影響其他內容。
    mapUrl.value = null;
  }
}

onMounted(load);
</script>

<template>
  <div class="page">
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

      <section class="card headline">
        <p class="tiny">每人平均</p>
        <strong class="figure">
          {{ report.currency }} {{ formatAmount(report.perPerson, report.currency) }}
        </strong>
        <p class="tiny">
          總花費 {{ report.currency }} {{ formatAmount(report.total, report.currency) }} ·
          {{ report.expenseCount }} 筆
        </p>
      </section>

      <img v-if="mapUrl" :src="mapUrl" alt="去過的地方" class="map" />

      <section v-if="report.places.length" class="card stack">
        <strong class="section-title">去過的地方</strong>
        <div v-for="place in report.places" :key="place.name" class="line">
          <span class="name">{{ place.name }}</span>
          <span class="tiny count">{{ place.expenseCount }} 筆</span>
          <span class="amount">{{ formatAmount(place.total, report.currency) }}</span>
        </div>
      </section>

      <section v-if="report.categories.length" class="card stack">
        <strong class="section-title">花在哪</strong>
        <div v-for="item in report.categories" :key="item.category" class="line">
          <span class="name">
            {{ categoryMeta(item.category).icon }} {{ categoryMeta(item.category).label }}
          </span>
          <span class="tiny count">{{ Math.round(item.share) }}%</span>
          <span class="amount">{{ formatAmount(item.total, report.currency) }}</span>
        </div>
      </section>

      <p class="tiny center footer">由 <a href="/">SplitFlow</a> 產生</p>
    </template>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 560px;
  margin: 0 auto;
  padding: 24px 16px 48px;
}

.center {
  text-align: center;
}

.headline {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  text-align: center;
}

.figure {
  font-size: 34px;
  font-variant-numeric: tabular-nums;
}

.map {
  width: 100%;
  border-radius: 16px;
  border: 1px solid var(--color-line);
}

.line {
  display: flex;
  align-items: baseline;
  gap: 10px;
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
  color: var(--color-primary);
}
</style>
