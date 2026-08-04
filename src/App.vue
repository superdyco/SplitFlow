<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { flushReceipts } from "@/services/receiptService";

/**
 * 待上傳的收據有三個補傳時機：App 啟動、重新連上網、以及剛入列的當下
 * （第三個在 receiptService.queueReceipt 裡）。
 *
 * 掛在 App.vue 而不是各個頁面，是因為補傳跟使用者現在看哪一頁無關 ——
 * 在任務列表頁重新連上網，昨天在餐廳拍的收據也該自己傳出去。
 */
function flush() {
  void flushReceipts();
}

onMounted(() => {
  flush();
  window.addEventListener("online", flush);
});

onUnmounted(() => window.removeEventListener("online", flush));
</script>

<template>
  <RouterView />
</template>
