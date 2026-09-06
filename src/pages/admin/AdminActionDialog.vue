<script setup lang="ts">
/**
 * 三個處置共用的確認對話框。
 *
 * 沒有沿用 `PromptDialog`：那支收的是「一行文字」，值由使用者決定但**可以是
 * 空的**，而且沒有危險語氣。這裡的理由是必填的、按鈕是紅的、而且有一塊
 * 說明「按下去之後會發生什麼」。跟 ConfirmDialog 與 PromptDialog 分開的
 * 理由一樣：長得像不代表是同一件事。
 */
import { nextTick, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    /** 按下去會發生什麼。一定要給 —— 這個對話框存在的意義就是說清楚這件事。 */
    message: string;
    /**
     * 紅框裡的警告。只有真的有意外後果時才給（例如停用不是立刻生效）。
     * 沒有意外後果卻放一塊紅框，下次真的有的時候就沒人看了。
     */
    warning?: { title: string; body: string } | null;
    confirmLabel: string;
    busy?: boolean;
    error?: string | null;
  }>(),
  { warning: null, busy: false, error: null }
);

const emit = defineEmits<{ (e: "confirm", reason: string): void; (e: "cancel"): void }>();

const reason = ref("");
const input = ref<HTMLTextAreaElement | null>(null);

// 每次重新開啟都清空。上一次打到一半的理由留在下一個對象身上，是這種
// 對話框最容易犯也最難發現的錯 —— 而它會被原字不動地寫進稽核日誌。
watch(
  () => props.open,
  async open => {
    if (!open) return;
    reason.value = "";
    await nextTick();
    input.value?.focus();
  }
);

function confirm() {
  const value = reason.value.trim();
  if (!value) return;
  emit("confirm", value);
}
</script>

<template>
  <div v-if="open" class="backdrop" @click.self="emit('cancel')">
    <div class="card raised dialog" role="dialog" aria-modal="true">
      <h2 class="section-title">{{ title }}</h2>
      <p class="tiny msg">{{ message }}</p>

      <div v-if="warning" class="warn">
        <strong>{{ warning.title }}</strong>
        <p class="tiny">{{ warning.body }}</p>
      </div>

      <div class="field">
        <label class="label" for="admin-reason">理由（必填，會寫進稽核日誌並通知當事人）</label>
        <textarea
          id="admin-reason"
          ref="input"
          v-model="reason"
          class="input area"
          rows="3"
          maxlength="500"
          placeholder="為什麼要做這件事"
        ></textarea>
      </div>

      <p v-if="error" class="error">{{ error }}</p>

      <div class="actions">
        <button type="button" class="btn" :disabled="busy" @click="emit('cancel')">取消</button>
        <button
          type="button"
          class="btn btn-danger"
          :disabled="busy || !reason.trim()"
          @click="confirm"
        >
          {{ busy ? "處理中..." : confirmLabel }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-4);
  background: rgba(26, 22, 19, 0.32);
}

.dialog {
  width: 100%;
  max-width: 440px;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.msg {
  margin: 0;
}

.warn {
  border: 1px solid var(--color-danger-line);
  background: var(--color-danger-soft);
  border-radius: var(--radius-md);
  padding: var(--space-3) var(--space-4);
}

.warn strong {
  font-size: var(--text-control-sm);
}

.warn .tiny {
  margin: var(--space-2) 0 0;
  color: var(--color-ink);
}

.area {
  min-height: 84px;
  padding: var(--space-3) 14px;
  line-height: 1.6;
  resize: vertical;
}

.actions {
  display: flex;
  gap: var(--space-3);
}

.actions .btn {
  flex-grow: 1;
}
</style>
