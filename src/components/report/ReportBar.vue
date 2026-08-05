<script setup lang="ts">
/**
 * 報告裡的水平長條。
 *
 * 兩種用途的基準不同（分類是佔總額百分比、地點是相對於最大值的比例），
 * 但都在呼叫端換算成 0-1 再傳進來 —— 元件不需要知道那個差別。
 */
import { computed } from "vue";

const props = defineProps<{
  /** 0-1。超出範圍會被夾住，資料異常時不會撐破版面。 */
  value: number;
  /** 地點用淡版，才不會跟分類的長條搶視覺重量。 */
  soft?: boolean;
}>();

const width = computed(() => `${Math.min(1, Math.max(0, props.value)) * 100}%`);
</script>

<template>
  <div class="track">
    <div class="fill" :class="{ soft }" :style="{ width }" />
  </div>
</template>

<style scoped>
.track {
  width: 100%;
  height: 6px;
  border-radius: 999px;
  background: var(--color-line);
  overflow: hidden;
}

.fill {
  height: 100%;
  border-radius: 999px;
  background: var(--color-primary);
}

/*
  用透明度而不是 --color-primary-soft：後者是 #fff0e4，那是給卡片底色用的，
  當長條會淡到看不出長度。
*/
.soft {
  opacity: 0.35;
}
</style>
