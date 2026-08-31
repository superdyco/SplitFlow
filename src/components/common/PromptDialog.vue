<script setup lang="ts">
/**
 * 收一行文字的對話框。
 *
 * 跟 ConfirmDialog 分開而不是加一個 prop：那邊的 `requireText` 看起來很像
 * 輸入框，但意思完全相反 —— 它是「打對這一串字才准按」的摩擦機制，值是預先
 * 決定的。這裡的值由使用者決定，兩者只是長得像。
 *
 * 取代 window.prompt 的理由跟 ConfirmDialog 取代 window.confirm 一樣：手機上
 * 那是系統對話框，按鈕位置不受控，而且長相跟 App 其他地方完全不一樣。
 */
import { computed, nextTick, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    /** 選填。要解釋這個名字會出現在哪裡時才給。 */
    message?: string;
    label: string;
    confirmLabel: string;
    /** 開啟時填進去的值，通常是「現在的名字」。 */
    initial?: string;
    placeholder?: string;
    maxlength?: number;
    busy?: boolean;
  }>(),
  { message: "", initial: "", placeholder: "", maxlength: 20, busy: false }
);

const emit = defineEmits<{ (e: "confirm", value: string): void; (e: "cancel"): void }>();

const value = ref("");
const input = ref<HTMLInputElement | null>(null);

/*
  每次重新開啟都要重填，不然上一次改到一半的字會留在下一個人身上 —— 這個
  對話框是列表上每一列共用的。

  順便把游標放進去並全選：改名幾乎都是整個換掉，不是在原字後面接。
*/
watch(
  () => props.open,
  async isOpen => {
    if (!isOpen) return;
    value.value = props.initial;
    await nextTick();
    input.value?.focus();
    input.value?.select();
  },
  { immediate: true }
);

const trimmed = computed(() => value.value.trim());
/** 空的不能送，沒改也不能送 —— 按下去什麼都不會發生的按鈕不該是可按的。 */
const canConfirm = computed(() => !props.busy && !!trimmed.value && trimmed.value !== props.initial);

function confirm() {
  if (!canConfirm.value) return;
  emit("confirm", trimmed.value);
}
</script>

<template>
  <div v-if="open" class="overlay" role="dialog" aria-modal="true" @click.self="emit('cancel')">
    <div class="card dialog stack">
      <strong class="section-title">{{ title }}</strong>
      <p v-if="message" class="tiny message">{{ message }}</p>

      <label class="field">
        <span class="label">{{ label }}</span>
        <input
          ref="input"
          v-model="value"
          class="input"
          :maxlength="maxlength"
          :placeholder="placeholder"
          autocomplete="off"
          @keyup.enter="confirm"
        />
      </label>

      <button class="btn btn-block btn-primary" :disabled="!canConfirm" @click="confirm">
        {{ busy ? "儲存中…" : confirmLabel }}
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
  max-height: 90vh;
  overflow-y: auto;
}

.message {
  line-height: 1.7;
  white-space: pre-line;
}
</style>
