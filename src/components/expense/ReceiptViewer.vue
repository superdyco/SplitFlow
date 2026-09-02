<script setup lang="ts">
/**
 * 收據大圖。刻意自己畫 overlay 而不用 window.open：
 * PWA 在 standalone 模式下 window.open 會把使用者踢到瀏覽器、回不來原本的頁面；
 * 之後如果包成 Capacitor 更是直接跳出 App。
 */
defineProps<{ url: string | null; open: boolean }>();
const emit = defineEmits<{ (e: "close"): void }>();
</script>

<template>
  <div v-if="open && url" class="overlay" role="dialog" aria-label="收據" @click="emit('close')">
    <img :src="url" alt="收據" @click.stop />
    <button type="button" class="close" @click="emit('close')">關閉</button>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 16px;
  /* 收據常常是白底，深色背景才看得出邊界。 */
  background: rgba(0, 0, 0, 0.85);
}

.overlay img {
  max-width: 100%;
  /* 留空間給關閉鈕，也避免在 iOS 上被瀏覽器列切到。 */
  max-height: 80vh;
  object-fit: contain;
  border-radius: var(--radius-md);
}

.close {
  padding: 10px 24px;
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--color-surface);
  color: var(--color-text);
  font-weight: 700;
}
</style>
