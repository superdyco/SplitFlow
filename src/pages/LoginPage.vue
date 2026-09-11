<script setup lang="ts">
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import AuthLayout from "@/layouts/AuthLayout.vue";
import ErrorState from "@/components/common/ErrorState.vue";
import ProviderButtons from "@/components/auth/ProviderButtons.vue";
import { SignInCancelled, signIn, signInAsGuest, type SignInProvider } from "@/services/authService";
import { firebaseErrorMessage } from "@/utils/firestore";
import { useUserStore } from "@/stores/user";

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();
const pending = ref<SignInProvider | null>(null);
const error = ref<string | null>(null);

async function login(provider: SignInProvider) {
  pending.value = provider;
  error.value = null;
  try {
    const user = await signIn(provider);
    await userStore.load(user.uid);
    const redirect = typeof route.query.redirect === "string" ? decodeURIComponent(route.query.redirect) : "/tasks";
    await router.push(userStore.profile?.nickname ? redirect : `/onboarding?redirect=${encodeURIComponent(redirect)}`);
  } catch (err) {
    // 自己關掉彈窗不是錯誤，安靜收掉就好。
    if (!(err instanceof SignInCancelled)) error.value = firebaseErrorMessage(err);
  } finally {
    // 使用者可能已經改按別的供應商了，別把新那個的狀態清掉。
    if (pending.value === provider) pending.value = null;
  }
}

const guestPending = ref(false);

/** 訪客一定還沒有暱稱，直接去取暱稱頁，原本要去的地方跟著帶過去。 */
async function tryAsGuest() {
  guestPending.value = true;
  error.value = null;
  try {
    await signInAsGuest();
    const redirect = typeof route.query.redirect === "string" ? decodeURIComponent(route.query.redirect) : "/tasks";
    await router.push(`/onboarding?redirect=${encodeURIComponent(redirect)}`);
  } catch (err) {
    error.value = firebaseErrorMessage(err);
  } finally {
    guestPending.value = false;
  }
}
</script>

<template>
  <AuthLayout>
    <div class="stack">
      <img src="/logo.png" alt="簡單分帳" class="logo" />
      <h1 class="title">一趟旅行<br />一份帳單</h1>
      <p class="muted">
        登入簡單分帳，建立任務、邀請同行成員，記帳與結算都用真實資料。
        用哪一種帳號登入都可以，之後會請你取一個同行的人看得到的暱稱。
      </p>
      <ErrorState :message="error" />
      <ProviderButtons :pending="pending" action="登入" @select="login" />
      <button class="btn btn-block" :disabled="guestPending || pending !== null" @click="tryAsGuest">
        {{ guestPending ? "準備中..." : "免登入立即試用" }}
      </button>
      <p class="tiny">試用的資料先存在這台裝置，之後可以在個人設定綁定帳號。</p>
      <p class="tiny">
        同一個 email 請固定用同一種方式登入。用不同供應商登入會被視為不同帳號。
      </p>
    </div>
  </AuthLayout>
</template>

<style scoped>
.logo {
  width: 64px;
  height: 64px;
  border-radius: var(--radius-xl);
  object-fit: cover;
}
</style>
