<script setup lang="ts">
/**
 * 探索：別人願意公開的旅程。
 *
 * 要登入才看得到。單一份報告的連結不需要帳號（傳給誰誰就看得到），但
 * 「一次列出所有人的旅程」是另一回事 —— 那個名單只給這個 App 的使用者。
 * 規則那邊也是這樣寫的，不是只有前端擋。
 */
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import AppLayout from "@/layouts/AppLayout.vue";
import EmptyState from "@/components/common/EmptyState.vue";
import ErrorState from "@/components/common/ErrorState.vue";
import LoadingState from "@/components/common/LoadingState.vue";
import ReportCard from "@/components/report/ReportCard.vue";
import type { PublicReport } from "@/types/report";
import { listPublicReports } from "@/services/reportService";
import { addFavorite, favoritedIds, removeFavorite } from "@/services/favoriteService";
import { useAuthStore } from "@/stores/auth";
import { favoriteId, toFavoriteInput } from "@/utils/favorites";
import { firebaseErrorMessage } from "@/utils/firestore";

const authStore = useAuthStore();
const uid = authStore.user!.uid;

const reports = ref<PublicReport[]>([]);
const saved = ref(new Set<string>());
const loading = ref(true);
const error = ref<string | null>(null);
const actionError = ref<string | null>(null);
/** 正在處理的那一張卡，只鎖那一顆按鈕而不是整頁。 */
const busyId = ref<string | null>(null);

/**
 * 清單與「我收藏了哪些」一起載。
 *
 * 兩趟查詢平行發，而不是每張卡各問一次「這份我收藏了嗎」—— 後者是
 * N 趟往返，二十張卡就是二十趟。
 */
async function load() {
  loading.value = true;
  error.value = null;
  try {
    const [list, ids] = await Promise.all([listPublicReports(), favoritedIds(uid)]);
    reports.value = list;
    saved.value = ids;
  } catch (err) {
    error.value = firebaseErrorMessage(err);
  } finally {
    loading.value = false;
  }
}

function isSaved(report: PublicReport) {
  return saved.value.has(favoriteId(report.taskId, report.id));
}

/**
 * 收藏與取消收藏是同一顆按鈕的兩個狀態。
 *
 * 先改本機的集合再送出（樂觀更新）—— 這顆按鈕會被連按，等伺服器回來才變色
 * 的話使用者會以為沒反應而再按一次。失敗就把狀態改回去並講出原因。
 */
async function toggle(report: PublicReport) {
  const id = favoriteId(report.taskId, report.id);
  const wasSaved = saved.value.has(id);
  busyId.value = id;
  actionError.value = null;

  const next = new Set(saved.value);
  if (wasSaved) next.delete(id);
  else next.add(id);
  saved.value = next;

  try {
    if (wasSaved) await removeFavorite(uid, report.taskId, report.id);
    else await addFavorite(uid, toFavoriteInput(report.taskId, report.id, report));
  } catch (err) {
    const rollback = new Set(saved.value);
    if (wasSaved) rollback.add(id);
    else rollback.delete(id);
    saved.value = rollback;
    actionError.value = firebaseErrorMessage(err);
  } finally {
    busyId.value = null;
  }
}

const isEmpty = computed(() => !loading.value && !error.value && !reports.value.length);

onMounted(load);
</script>

<template>
  <AppLayout>
    <div class="stack">
      <div class="spread">
        <div>
          <p class="tiny">看看別人怎麼玩</p>
          <h1 class="title">探索</h1>
        </div>
        <RouterLink to="/favorites" class="btn btn-ghost">我的收藏</RouterLink>
      </div>

      <p class="tiny intro">
        這裡是其他人願意公開的旅程報告。只有彙總的數字與地點，沒有誰付了什麼、也沒有任何人的名字。
        你自己的旅程要出現在這裡，得在任務封存後自己勾「列入公開頁」。
      </p>

      <LoadingState v-if="loading" title="讀取公開旅程" message="正在找大家分享出來的報告。" />
      <ErrorState v-else :message="error" retryable :retrying="loading" @retry="load" />

      <EmptyState
        v-if="isEmpty"
        title="還沒有人公開旅程"
        message="第一個也可以是你 —— 把任務封存、產生報告，然後勾「列入公開頁」。"
      />

      <div v-if="!loading && reports.length" class="stack">
        <ReportCard
          v-for="report in reports"
          :key="favoriteId(report.taskId, report.id)"
          :task-name="report.taskName"
          :currency="report.currency"
          :start-date="report.startDate"
          :end-date="report.endDate"
          :days="report.days"
          :member-count="report.memberCount"
          :total="report.total"
          :path="`/r/${report.taskId}/${report.id}`"
        >
          <template #actions>
            <button
              class="btn btn-sm"
              :class="{ 'btn-primary': !isSaved(report) }"
              :disabled="busyId === favoriteId(report.taskId, report.id)"
              @click="toggle(report)"
            >
              {{ isSaved(report) ? "已收藏" : "收藏" }}
            </button>
          </template>
        </ReportCard>
      </div>

      <ErrorState :message="actionError" />
    </div>
  </AppLayout>
</template>

<style scoped>
.intro {
  margin: -4px 0 0;
  line-height: 1.7;
}
</style>
