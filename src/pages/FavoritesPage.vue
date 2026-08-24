<script setup lang="ts">
/**
 * 我的收藏。
 *
 * 顯示的數字是**收藏當下的快照**，不是即時的。原作者後來重新產生報告的話，
 * 這裡的總額會停在你收藏的那一刻 —— 點進去看到的才是最新版。這是刻意的：
 * 收藏頁要一次查詢就畫得完，而不是每一列各讀一次報告。
 */
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import AppLayout from "@/layouts/AppLayout.vue";
import ConfirmDialog from "@/components/common/ConfirmDialog.vue";
import EmptyState from "@/components/common/EmptyState.vue";
import ErrorState from "@/components/common/ErrorState.vue";
import LoadingState from "@/components/common/LoadingState.vue";
import ReportCard from "@/components/report/ReportCard.vue";
import type { FavoriteReport } from "@/types/favorite";
import { listFavorites, removeFavorite } from "@/services/favoriteService";
import { useAuthStore } from "@/stores/auth";
import { firebaseErrorMessage } from "@/utils/firestore";

const authStore = useAuthStore();
const uid = authStore.user!.uid;

const favorites = ref<FavoriteReport[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const actionError = ref<string | null>(null);
const pending = ref<FavoriteReport | null>(null);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    favorites.value = await listFavorites(uid);
  } catch (err) {
    error.value = firebaseErrorMessage(err);
  } finally {
    loading.value = false;
  }
}

/**
 * 移除要問一下。刪掉本身不痛，但收藏是「我想再回來看」的東西，
 * 而那個連結多半是別人傳的 —— 誤刪之後不一定找得回來。
 */
async function confirmRemove() {
  const entry = pending.value;
  if (!entry) return;
  pending.value = null;
  actionError.value = null;
  try {
    await removeFavorite(uid, entry.taskId, entry.reportId);
    await load();
  } catch (err) {
    actionError.value = firebaseErrorMessage(err);
  }
}

const isEmpty = computed(() => !loading.value && !error.value && !favorites.value.length);

onMounted(load);
</script>

<template>
  <AppLayout>
    <div class="stack">
      <div class="spread">
        <div>
          <p class="tiny">存起來的旅程</p>
          <h1 class="title">我的收藏</h1>
        </div>
        <RouterLink to="/explore" class="btn btn-ghost">探索</RouterLink>
      </div>

      <LoadingState v-if="loading" title="讀取收藏中" message="正在取得你收藏的旅程。" />
      <ErrorState v-else :message="error" retryable :retrying="loading" @retry="load" />

      <EmptyState
        v-if="isEmpty"
        title="還沒有收藏任何旅程"
        message="看到喜歡的行程就按收藏，之後在這裡找得到。"
      >
        <RouterLink to="/explore" class="btn btn-primary" style="margin-top: 16px">
          去探索看看
        </RouterLink>
      </EmptyState>

      <p v-if="!loading && favorites.length" class="tiny muted">
        數字是收藏當下的紀錄，點進去看到的是最新版本。
      </p>

      <div v-if="!loading && favorites.length" class="stack">
        <ReportCard
          v-for="item in favorites"
          :key="item.id"
          :task-name="item.taskName"
          :currency="item.currency"
          :start-date="item.startDate"
          :end-date="item.endDate"
          :days="item.days"
          :member-count="item.memberCount"
          :total="item.total"
          :path="`/r/${item.taskId}/${item.reportId}`"
        >
          <template #actions>
            <!-- 紅色，跟成員移除、刪結算同一套：破壞性的動作在這個 app 裡一律是紅的。 -->
            <button class="btn btn-danger btn-sm" @click="pending = item">移除</button>
          </template>
        </ReportCard>
      </div>

      <ErrorState :message="actionError" />

      <ConfirmDialog
        :open="pending !== null"
        title="移除這個收藏？"
        :message="`「${pending?.taskName ?? ''}」會從收藏清單消失。原本的報告不受影響，但你得重新拿到連結才找得回來。`"
        confirm-label="移除"
        danger
        @confirm="confirmRemove"
        @cancel="pending = null"
      />
    </div>
  </AppLayout>
</template>
