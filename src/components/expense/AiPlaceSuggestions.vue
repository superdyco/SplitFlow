<script setup lang="ts">
/**
 * AI 讀完收據之後的「是不是這家？」。
 *
 * 用店名＋地址搜一次，列出最多 3 家，**點了才算數**。不自動選第一個：連鎖店
 * 同一個名字附近有好幾家，選錯的地點會出現在公開報告的地圖上，而使用者不一定
 * 會發現。
 *
 * 搜尋與位置偏好跟 PlaceField 用同一組函式，所以結果跟自己在地點欄位打字一樣；
 * autocomplete 與 details 共用 session token，算一次計費。
 */
import { nextTick, onMounted, ref, watch } from "vue";
import type { ExpensePlace } from "@/types/expense";
import {
  autocompletePlaces,
  getPlaceDetails,
  newSessionToken,
  placesEnabled,
  recallPlaceBias,
  rememberPlaceBias,
  type PlaceSuggestion
} from "@/services/placeService";
import { nudgeSticky } from "@/utils/stickyNudge";

const props = defineProps<{ query: string; taskId: string }>();
const emit = defineEmits<{ (e: "pick", place: ExpensePlace): void; (e: "dismiss"): void }>();

/** 三家就夠挑了。再多就變成一份清單，那是地點欄位本來就做得到的事。 */
const MAX = 3;

const searchable = placesEnabled();
const suggestions = ref<PlaceSuggestion[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
let session = newSessionToken();

async function search() {
  if (!searchable) return;
  loading.value = true;
  error.value = null;
  suggestions.value = [];
  try {
    const found = await autocompletePlaces(props.query, session, recallPlaceBias(props.taskId));
    suggestions.value = found.slice(0, MAX);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
    // 候選出現會把版面撐高，送出列在 iOS standalone 會停在舊位置。見 nudgeSticky。
    await nextTick();
    nudgeSticky();
  }
}

async function pick(suggestion: PlaceSuggestion) {
  loading.value = true;
  error.value = null;
  try {
    const detail = await getPlaceDetails(suggestion.placeId, session);
    // 這個任務接下來的搜尋就以這裡為中心，跟在地點欄位裡選的一樣。
    rememberPlaceBias(props.taskId, detail);
    session = newSessionToken();
    emit("pick", detail);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

onMounted(search);

// 同一張收據重按一次 AI、店名或地址變了，就重查。舊的 session 沒選就作廢。
watch(
  () => props.query,
  () => {
    session = newSessionToken();
    void search();
  }
);
</script>

<template>
  <!-- 沒有地點金鑰、或查完什麼都沒有，整塊不出現。地點欄位照樣可以自己打。 -->
  <div v-if="searchable && (loading || error || suggestions.length)" class="ai-place">
    <span class="tiny">是不是這家？點一下才會填進地點。</span>
    <span v-if="loading && !suggestions.length" class="tiny">找地點中…</span>
    <button
      v-for="item in suggestions"
      :key="item.placeId"
      type="button"
      class="btn btn-sm choice"
      :disabled="loading"
      @click="pick(item)"
    >
      <strong>{{ item.primary }}</strong>
      <span v-if="item.secondary" class="tiny">{{ item.secondary }}</span>
    </button>
    <span v-if="error" class="tiny warn">{{ error }}</span>
    <button
      v-if="suggestions.length"
      type="button"
      class="btn btn-ghost btn-sm dismiss"
      :disabled="loading"
      @click="emit('dismiss')"
    >
      都不是
    </button>
  </div>
</template>

<style scoped>
.ai-place {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--space-2);
}

/* 店名一行、地址一行，左對齊 —— 按鈕預設置中，兩行字置中很難讀。 */
.choice {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
  height: auto;
  padding-block: var(--space-2);
}

.dismiss {
  align-self: flex-start;
}

.warn {
  color: var(--color-danger);
}
</style>
