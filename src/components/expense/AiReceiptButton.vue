<script setup lang="ts">
/**
 * 「用 AI 讀收據」按鈕與它下面那一行。
 *
 * 只在剛拍或剛選了一張照片時出現（由母元件決定）。讀到的結果交給母元件套進
 * 表單 —— 這個元件不知道表單長什麼樣，它只負責「讀」與「講結果」。
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { getAiCredits, readReceipt } from "@/services/aiService";
import { aiButtonState, GUEST_AI_NOTICE, type AiReadResult } from "@/utils/aiReceipt";
import { firebaseErrorMessage } from "@/utils/firestore";

const props = defineProps<{
  blob: Blob;
  uid: string;
  guest: boolean;
  /** 套進表單之後，母元件算出來的那一行。 */
  note: string | null;
  /** 幣別不支援時的警告。不會自己消失。 */
  warning: string | null;
}>();

const emit = defineEmits<{ (e: "result", result: AiReadResult): void }>();

const balance = ref<number | null>(null);
const busy = ref(false);
const error = ref<string | null>(null);
const guestNotice = ref(false);
const online = ref(navigator.onLine);

function syncOnline() {
  online.value = navigator.onLine;
}

onMounted(async () => {
  window.addEventListener("online", syncOnline);
  window.addEventListener("offline", syncOnline);
  if (props.guest) return;
  try {
    balance.value = await getAiCredits(props.uid);
  } catch {
    // 讀不到餘額不擋按鈕：真的沒點數時函式會說。
  }
});

onUnmounted(() => {
  window.removeEventListener("online", syncOnline);
  window.removeEventListener("offline", syncOnline);
});

const button = computed(() =>
  aiButtonState({ guest: props.guest, online: online.value, balance: balance.value, busy: busy.value })
);

async function run() {
  error.value = null;
  if (props.guest) {
    guestNotice.value = true;
    return;
  }
  busy.value = true;
  try {
    const result = await readReceipt(props.blob);
    balance.value = result.creditsLeft;
    emit("result", result);
  } catch (err) {
    error.value = firebaseErrorMessage(err);
    // AI 出錯也扣了 1 點，餘額要重讀。
    balance.value = await getAiCredits(props.uid).catch(() => balance.value);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="ai">
    <button type="button" class="btn btn-sm" :disabled="button.disabled" @click="run">
      ✨ {{ button.label }}
    </button>
    <span v-if="guestNotice" class="tiny">
      {{ GUEST_AI_NOTICE }}，<RouterLink to="/profile">到個人設定綁定</RouterLink>。
    </span>
    <span v-else-if="error" class="tiny warn">{{ error }}</span>
    <span v-else-if="note" class="tiny">{{ note }}</span>
    <span v-if="warning" class="tiny warn">{{ warning }}</span>
  </div>
</template>

<style scoped>
.ai {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-1);
}

.warn {
  color: var(--color-danger);
}
</style>
