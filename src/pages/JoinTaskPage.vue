<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import AuthLayout from "@/layouts/AuthLayout.vue";
import AppLayout from "@/layouts/AppLayout.vue";
import ErrorState from "@/components/common/ErrorState.vue";
import LoadingState from "@/components/common/LoadingState.vue";
import type { Invite } from "@/types/task";
import { signInWithGoogle } from "@/services/authService";
import { getInvite } from "@/services/inviteService";
import { joinTask } from "@/services/memberService";
import { useAuthStore } from "@/stores/auth";
import { useUserStore } from "@/stores/user";
import { firebaseErrorMessage } from "@/utils/firestore";

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const userStore = useUserStore();
const invite = ref<Invite | null>(null);
const loading = ref(true);
const joining = ref(false);
const error = ref<string | null>(null);
const inviteCode = computed(() => String(route.params.inviteCode || ""));
const Layout = computed(() => authStore.user ? AppLayout : AuthLayout);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    invite.value = await getInvite(inviteCode.value);
    if (!invite.value || !invite.value.active) error.value = "這個邀請連結不存在或已停用";
  } catch (err) {
    error.value = firebaseErrorMessage(err);
  } finally {
    loading.value = false;
  }
}

async function login() {
  try {
    const user = await signInWithGoogle();
    await userStore.load(user.uid);
    if (!userStore.profile?.nickname) {
      await router.push(`/onboarding?redirect=${encodeURIComponent(route.fullPath)}`);
    }
  } catch (err) {
    error.value = firebaseErrorMessage(err);
  }
}

async function join() {
  if (!invite.value || !authStore.user) return;
  if (!userStore.profile?.nickname) {
    await router.push(`/onboarding?redirect=${encodeURIComponent(route.fullPath)}`);
    return;
  }
  joining.value = true;
  error.value = null;
  try {
    await joinTask(invite.value.taskId, userStore.profile);
    await router.push(`/tasks/${invite.value.taskId}`);
  } catch (err) {
    error.value = firebaseErrorMessage(err);
  } finally {
    joining.value = false;
  }
}

onMounted(load);
</script>

<template>
  <component :is="Layout">
    <div class="stack">
      <LoadingState v-if="loading" title="讀取邀請中" message="正在確認邀請連結。" />
      <ErrorState v-else :message="error" />

      <div v-if="invite && !error" class="card stack invite-card">
        <p class="tiny">JOIN SPLITFLOW</p>
        <h1 class="title">{{ invite.taskName }}</h1>
        <p class="muted">主要幣別 {{ invite.defaultCurrency }} · {{ invite.startDate || "未設定日期" }} - {{ invite.endDate || "未設定日期" }}</p>
        <button v-if="!authStore.user" class="btn btn-primary btn-block" @click="login">使用 Google 登入並加入</button>
        <button v-else class="btn btn-primary btn-block" :disabled="joining" @click="join">
          {{ joining ? "加入中..." : "加入這個任務" }}
        </button>
      </div>
    </div>
  </component>
</template>

<style scoped>
.invite-card {
  text-align: center;
}
</style>
