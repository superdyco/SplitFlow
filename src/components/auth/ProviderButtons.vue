<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { warmSignIn, type SignInProvider } from "@/services/authService";
import { ENABLED_PROVIDERS, PROVIDER_LABELS } from "@/utils/authError";

defineProps<{
  /**
   * 正在跑的供應商。只 disable 它自己，其他照樣可以按。
   * 某個供應商設定有問題卡住時，使用者還能立刻改用別的方式登入，
   * 不會整頁按不動。Firebase 遇到第二個彈窗會自己取消前一個。
   */
  pending: SignInProvider | null;
  /** 按鈕文字前綴，例如「登入」或「登入並加入」。 */
  action: string;
}>();

const emit = defineEmits<{ (e: "select", provider: SignInProvider): void }>();

const providers = computed(() =>
  ENABLED_PROVIDERS.map(id => ({ id, label: PROVIDER_LABELS[id] }))
);

/**
 * 暖好之前不讓按。
 *
 * 這是這個元件存在的第二個理由，也是它比「各頁自己記得暖機」可靠的地方：
 * 只要畫面上出現這幾顆按鈕，暖機就一定跑過，沒有哪一頁會忘記。
 *
 * 為什麼一定要擋：resolver 沒暖過的話，`signInWithPopup` 會在開彈窗**之前**
 * 先 await 一次初始化（手機上 1.6 秒），iOS 會因此把使用者手勢作廢，彈窗被擋掉，
 * 登入無聲卡死。這個坑踩過一次（2026-08-24），而「按鈕暖好前按不下去」正是
 * 從結構上把那個失敗模式關掉 —— 不存在「按了之後才開始慢慢載」這件事。
 *
 * 不怕永遠鎖住：`warmSignIn` 不會 reject，而它底下的 `loadGapi` 自己帶
 * timeout 與 ontimeout，一定會結束。
 */
const ready = ref(false);

onMounted(async () => {
  await warmSignIn();
  ready.value = true;
});
</script>

<template>
  <div class="stack providers">
    <button
      v-for="provider in providers"
      :key="provider.id"
      class="btn btn-block provider"
      :class="provider.id"
      :disabled="!ready || pending === provider.id"
      @click="emit('select', provider.id)"
    >
      <span class="icon" aria-hidden="true">
        <svg v-if="provider.id === 'google'" viewBox="0 0 48 48" width="18" height="18">
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
          <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
        </svg>
        <svg v-else-if="provider.id === 'apple'" viewBox="0 0 384 512" width="16" height="16" fill="currentColor">
          <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
        </svg>
        <svg v-else viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          <path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.25h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07z" />
        </svg>
      </span>
      <span>
        {{ pending === provider.id ? `${provider.label} ${action}中...` : `使用 ${provider.label} ${action}` }}
      </span>
    </button>
    <!--
      連線正常時這行大概閃 0.3 秒，不會有人注意到；手機或慢網路才看得到。
      沒有這一行的話，使用者只會看到一排按不動的按鈕，不知道在等什麼。
    -->
    <p v-if="!ready" class="tiny prep">登入服務準備中...</p>
  </div>
</template>

<style scoped>
.providers {
  gap: 10px;
}

.prep {
  margin: 0;
  text-align: center;
}

.provider {
  gap: 10px;
}

.icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  flex: none;
}

.provider.apple {
  border-color: var(--color-ink);
  background: var(--color-ink);
  color: #fff;
}

.provider.facebook {
  border-color: #1877f2;
  background: #1877f2;
  color: #fff;
}
</style>
