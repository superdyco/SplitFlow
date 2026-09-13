<script setup lang="ts">
/**
 * 「用 AI 讀收據」按鈕與它下面那一行。
 *
 * 只在剛拍或剛選了一張照片時出現（由母元件決定）。讀到的結果交給母元件套進
 * 表單 —— 這個元件不知道表單長什麼樣，它只負責「讀」與「講結果」。
 */
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { getAiCredits, readReceipt } from "@/services/aiService";
import { aiButtonState, GUEST_AI_NOTICE, type AiReadResult } from "@/utils/aiReceipt";
import { firebaseErrorMessage } from "@/utils/firestore";
import { nudgeSticky } from "@/utils/stickyNudge";

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

/**
 * 點數用完了。網頁不賣點數（spec 的決定），所以只講去哪裡買，**不放連結** ——
 * 也不寫商店名稱，那是 App 裡的事。
 *
 * 兩種情況：按鈕本來就是「點數用完了」，或按下去才被函式告知沒點數
 * （另一台裝置剛好用掉最後一點）。
 */
const outOfCredits = ref(false);

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
  outOfCredits.value = false;
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
    outOfCredits.value = (err as { code?: string }).code === "functions/resource-exhausted";
    error.value = firebaseErrorMessage(err);
    // AI 出錯也扣了 1 點，餘額要重讀。
    balance.value = await getAiCredits(props.uid).catch(() => balance.value);
  } finally {
    busy.value = false;
    // 結果或錯誤那一行會把版面撐高，而 iOS 不一定重算 sticky 的位置 ——
    // 送出列會停在畫面中間。見 `nudgeSticky` 的說明。
    await nextTick();
    nudgeSticky();
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
    <span v-if="button.kind === 'empty' || outOfCredits" class="tiny">點數用完了，可以到手機 App 儲值。</span>
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
