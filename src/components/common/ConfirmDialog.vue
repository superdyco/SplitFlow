<script setup lang="ts">
/**
 * 確認對話框。
 *
 * 不用 window.confirm 的兩個理由：它無法要求輸入文字，而且在手機上是系統
 * 對話框、按鈕位置不受控，「確定」常常就落在拇指下面 —— 那正是我們要避免的手滑。
 *
 * requireText 就是分級摩擦：後果越嚴重、需要越刻意的動作。
 * 沒有它時是單純的確認，有值時要打對那串字才按得下去。
 */
import { computed, ref, watch } from "vue";

const props = defineProps<{
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  /** 有值時要求使用者打出這串字才能確認。 */
  requireText?: string | null;
}>();

const emit = defineEmits<{ (e: "confirm"): void; (e: "cancel"): void }>();

const typed = ref("");

// 每次重新開啟都要清空，不然上一次打的字會讓按鈕一開始就是啟用的。
watch(
  () => props.open,
  isOpen => {
    if (isOpen) typed.value = "";
  }
);

const canConfirm = computed(() => !props.requireText || typed.value.trim() === props.requireText);
</script>

<template>
  <div v-if="open" class="overlay" role="dialog" aria-modal="true" @click.self="emit('cancel')">
    <div class="card dialog stack">
      <strong class="section-title">{{ title }}</strong>
      <p class="tiny message">{{ message }}</p>

      <label v-if="requireText" class="field">
        <span class="label">請輸入「{{ requireText }}」以確認</span>
        <input v-model="typed" class="input" autocomplete="off" />
      </label>

      <button
        class="btn btn-block"
        :class="danger ? 'btn-danger' : 'btn-primary'"
        :disabled="!canConfirm"
        @click="emit('confirm')"
      >
        {{ confirmLabel }}
      </button>
      <button class="btn btn-block" @click="emit('cancel')">取消</button>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.5);
}

.dialog {
  width: 100%;
  max-width: 420px;
  /* 訊息很長時（列出成員數與支出數）在小螢幕上要能捲。 */
  max-height: 90vh;
  overflow-y: auto;
}

.message {
  /* 這裡會講出刪掉之後會發生什麼，是使用者唯一會讀的地方，不要壓得太扁。 */
  line-height: 1.7;
  white-space: pre-line;
}
</style>
