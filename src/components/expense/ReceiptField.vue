<script setup lang="ts">
import { ref } from "vue";

defineProps<{
  previewUrl: string | null;
  /**
   * empty=還沒有照片，unsaved=選好了但還沒按送出，uploading=正在傳，
   * ready=已上傳，pending=排隊等網路，failed=傳太多次失敗了
   */
  state: "empty" | "unsaved" | "uploading" | "ready" | "pending" | "failed";
  /** 送出鈕的文字，用在提示裡。新增與編輯的字不一樣。 */
  submitLabel: string;
  busy: boolean;
  canManage: boolean;
  /** 壓縮失敗、重試失敗之類。一定要顯示 —— 靜默失敗會讓使用者以為照片存好了。 */
  error: string | null;
}>();

const emit = defineEmits<{
  (e: "pick", file: File): void;
  (e: "clear"): void;
  (e: "retry"): void;
  (e: "view"): void;
}>();

const input = ref<HTMLInputElement | null>(null);

function onChange(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (file) emit("pick", file);
  // 清掉 value，這樣選同一個檔案第二次也會觸發 change。
  target.value = "";
}
</script>

<template>
  <div class="field">
    <span class="label">收據（選填）</span>

    <!--
      刻意不加 capture="environment"：加了會強制直接開相機、不能從相簿選。
      實際情境是「當場拍」跟「晚上回飯店補進去」各佔一半，
      不加這個屬性 iOS 才會給「拍照／照片圖庫」選單。
    -->
    <input ref="input" type="file" accept="image/*" class="hidden-input" @change="onChange" />

    <button
      v-if="state === 'empty'"
      type="button"
      class="drop"
      :disabled="busy || !canManage"
      @click="input?.click()"
    >
      {{ busy ? "處理中..." : "📷 拍照或選一張收據" }}
    </button>

    <div v-else class="preview">
      <button type="button" class="thumb" @click="emit('view')">
        <img v-if="previewUrl" :src="previewUrl" alt="收據縮圖" />
        <span v-else class="tiny">收據</span>
        <span v-if="state === 'unsaved'" class="badge unsaved">未儲存</span>
        <span v-else-if="state === 'uploading'" class="badge uploading">上傳中</span>
        <span v-else-if="state === 'pending'" class="badge">待上傳</span>
        <span v-else-if="state === 'failed'" class="badge failed">上傳失敗</span>
      </button>

      <div class="actions">
        <button
          v-if="canManage"
          type="button"
          class="btn btn-sm"
          :disabled="busy"
          @click="input?.click()"
        >
          更換
        </button>
        <button
          v-if="canManage"
          type="button"
          class="btn btn-sm"
          :disabled="busy"
          @click="emit('clear')"
        >
          移除
        </button>
        <button
          v-if="state === 'failed'"
          type="button"
          class="btn btn-sm"
          :disabled="busy"
          @click="emit('retry')"
        >
          重試
        </button>
      </div>
    </div>

    <span v-if="error" class="tiny warn">{{ error }}</span>
    <!--
      這句是必要的：照片要等按下送出、拿到 expenseId 之後才會上傳，
      但縮圖一出現就跟存好了長得一樣。不講的話使用者會直接離開，照片就沒了。
    -->
    <span v-else-if="state === 'unsaved'" class="tiny warn">
      還沒儲存。要按下面的「{{ submitLabel }}」，這張照片才會上傳。
    </span>
    <!--
      uploading 與 pending 的文案必須分開。使用者明明有網路、照片正在傳的時候，
      如果看到「連上網路後會自動傳出去」，會以為功能壞了。
    -->
    <span v-else-if="state === 'uploading'" class="tiny">
      正在上傳，傳完會自動更新，不用重整。
    </span>
    <span v-else-if="state === 'pending'" class="tiny">
      照片還在這台裝置上，連上網路後會自動傳出去。
    </span>
    <span v-else-if="state === 'failed'" class="tiny warn">
      這張照片試了幾次都傳不出去。點「重試」再試一次，或移除後重拍。
    </span>
  </div>
</template>

<style scoped>
.hidden-input {
  display: none;
}

.drop {
  min-height: 96px;
  border: 1px dashed var(--color-line-strong);
  border-radius: var(--radius-md);
  background: none;
  color: var(--color-muted);
  font-weight: 700;
}

.drop:disabled {
  opacity: 0.6;
}

.preview {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.thumb {
  position: relative;
  flex: none;
  width: 96px;
  height: 96px;
  padding: 0;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--color-surface);
}

.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.badge {
  position: absolute;
  top: 4px;
  right: 4px;
  padding: 2px 6px;
  border-radius: var(--radius-pill);
  background: var(--color-line-strong);
  color: var(--color-surface);
  font-size: 11px;
  font-weight: 700;
}

.badge.failed {
  background: var(--color-danger);
}

.badge.unsaved {
  background: var(--color-primary);
}

.badge.uploading {
  background: var(--color-primary);
  /* 會動代表真的在進行中，靜態標籤看起來跟卡住一樣。 */
  animation: pulse 1.2s ease-in-out infinite;
}

@keyframes pulse {
  50% {
    opacity: 0.45;
  }
}

@media (prefers-reduced-motion: reduce) {
  .badge.uploading {
    animation: none;
  }
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.warn {
  color: var(--color-danger);
}
</style>
