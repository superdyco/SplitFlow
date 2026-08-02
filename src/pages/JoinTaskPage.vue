<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import AuthLayout from "@/layouts/AuthLayout.vue";
import AppLayout from "@/layouts/AppLayout.vue";
import ErrorState from "@/components/common/ErrorState.vue";
import LoadingState from "@/components/common/LoadingState.vue";
import type { Invite } from "@/types/task";
import { signInWithGoogle } from "@/services/authService";
import { getInvite } from "@/services/inviteService";
import { getTaskMember, joinTask } from "@/services/memberService";
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
const alreadyMember = ref(false);
const inviteCode = computed(() => String(route.params.inviteCode || ""));
const Layout = computed(() => authStore.user ? AppLayout : AuthLayout);

/** 已經在任務裡就不用再加入一次，直接放「進入任務」。被移除過的人要走加入流程重新啟用。 */
async function checkMembership() {
  alreadyMember.value = false;
  if (!invite.value || !authStore.user) return;
  try {
    const member = await getTaskMember(invite.value.taskId, authStore.user.uid);
    alreadyMember.value = !!member?.active;
  } catch {
    // 讀不到自己的 member 文件就當作還沒加入，照原本的流程走。
  }
}

async function load() {
  loading.value = true;
  error.value = null;
  try {
    invite.value = await getInvite(inviteCode.value);
    if (!invite.value || !invite.value.active) {
      error.value = "這個邀請連結不存在或已停用";
      return;
    }
    await checkMembership();
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
      return;
    }
    // 登入之後才知道是不是已經在任務裡了。
    await checkMembership();
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

        <template v-else-if="alreadyMember">
          <p class="tiny">你已經是這個任務的成員了。</p>
          <RouterLink :to="`/tasks/${invite.taskId}`" class="btn btn-primary btn-block">進入任務</RouterLink>
        </template>

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
