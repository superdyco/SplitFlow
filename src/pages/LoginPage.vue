<script setup lang="ts">
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import AuthLayout from "@/layouts/AuthLayout.vue";
import ErrorState from "@/components/common/ErrorState.vue";
import { signInWithGoogle } from "@/services/authService";
import { firebaseErrorMessage } from "@/utils/firestore";
import { useUserStore } from "@/stores/user";

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();
const loading = ref(false);
const error = ref<string | null>(null);

async function login() {
  loading.value = true;
  error.value = null;
  try {
    const user = await signInWithGoogle();
    await userStore.load(user.uid);
    const redirect = typeof route.query.redirect === "string" ? decodeURIComponent(route.query.redirect) : "/tasks";
    await router.push(userStore.profile?.nickname ? redirect : `/onboarding?redirect=${encodeURIComponent(redirect)}`);
  } catch (err) {
    error.value = firebaseErrorMessage(err);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <AuthLayout>
    <div class="stack">
      <div class="brand-mark logo">分</div>
      <h1 class="title">一趟旅行<br />一份帳單</h1>
      <p class="muted">使用 Google 帳號登入 SplitFlow，建立任務、邀請同行成員，第一版先完成真實帳號與任務協作流程。</p>
      <ErrorState :message="error" />
      <button class="btn btn-primary btn-block" :disabled="loading" @click="login">
        {{ loading ? "登入中..." : "使用 Google 帳號登入" }}
      </button>
    </div>
  </AuthLayout>
</template>

<style scoped>
.logo {
  width: 64px;
  height: 64px;
  border-radius: 22px;
  font-size: 26px;
}
</style>
