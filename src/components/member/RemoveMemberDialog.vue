<script setup lang="ts">
/**
 * 移除成員的對話框。
 *
 * 跟 ConfirmDialog 分開的理由是它給不了三個出口 —— 這裡要「取消 / 保留結算
 * 資料 / 真實移除」。摩擦機制（照著打名字才按得下去）比照 ConfirmDialog 的
 * requireText，理由一樣：後果越嚴重、需要越刻意的動作。
 *
 * 沒有帳的人不給選擇也不要求打字 —— 沒東西可失去，逼他打字只是懲罰。
 */
import { computed, ref, watch } from "vue";
import type { RemoveMemberPrompt } from "@/utils/memberRemoval";

const props = defineProps<{
  open: boolean;
  prompt: RemoveMemberPrompt;
  busy: boolean;
}>();

const emit = defineEmits<{
  (e: "soft"): void;
  (e: "hard"): void;
  (e: "cancel"): void;
}>();

const typed = ref("");

// 每次重新開啟都要清空，不然上一次打的字會讓按鈕一開始就是啟用的。
watch(
  () => props.open,
  isOpen => {
    if (isOpen) typed.value = "";
  }
);

const canHardDelete = computed(
  () => !props.prompt.requireText || typed.value.trim() === props.prompt.requireText
);
</script>

<template>
  <div v-if="open" class="overlay" role="dialog" aria-modal="true" @click.self="emit('cancel')">
    <div class="card dialog stack">
      <strong class="section-title">{{ prompt.title }}</strong>
      <p class="tiny message">{{ prompt.message }}</p>

      <label v-if="prompt.requireText" class="field">
        <span class="label">請輸入「{{ prompt.requireText }}」以確認真實移除</span>
        <input v-model="typed" class="input" autocomplete="off" :disabled="busy" />
      </label>

      <button
        v-if="prompt.hasRecords"
        class="btn btn-block"
        :disabled="busy"
        @click="emit('soft')"
      >
        保留結算資料
      </button>
      <button
        class="btn btn-block btn-danger"
        :disabled="busy || !canHardDelete"
        @click="emit('hard')"
      >
        {{ busy ? "刪除中…" : prompt.hasRecords ? "真實移除" : "刪除" }}
      </button>
      <button class="btn btn-block" :disabled="busy" @click="emit('cancel')">取消</button>
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
  /* 訊息很長時（列出支出數與付款數）在小螢幕上要能捲。 */
  max-height: 90vh;
  overflow-y: auto;
}

.message {
  /* 這裡會講出刪掉之後會發生什麼，是使用者唯一會讀的地方，不要壓得太扁。 */
  line-height: 1.7;
  white-space: pre-line;
}
</style>
