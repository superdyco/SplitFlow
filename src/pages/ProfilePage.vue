<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import AppLayout from "@/layouts/AppLayout.vue";
import ErrorState from "@/components/common/ErrorState.vue";
import { logout } from "@/services/authService";
import { useAuthStore } from "@/stores/auth";
import { useUserStore } from "@/stores/user";
import { firebaseErrorMessage, required } from "@/utils/firestore";

const router = useRouter();
const authStore = useAuthStore();
const userStore = useUserStore();
const nickname = ref(userStore.profile?.nickname || "");
const loading = ref(false);
const error = ref<string | null>(null);
const initial = computed(() => nickname.value.trim().charAt(0).toUpperCase() || "?");

async function save() {
  if (!authStore.user) return;
  loading.value = true;
  error.value = null;
  try {
    await userStore.updateNickname(authStore.user.uid, required(nickname.value, "暱稱"));
  } catch (err) {
    error.value = firebaseErrorMessage(err);
  } finally {
    loading.value = false;
  }
}

async function signOut() {
  await logout();
  userStore.clear();
  await router.push("/login");
}
</script>

<template>
  <AppLayout>
    <div class="stack">
      <h1 class="title">個人設定</h1>
      <div class="card stack">
        <div class="row">
          <span class="avatar">{{ initial }}</span>
          <div class="field" style="flex: 1">
            <span class="label">暱稱</span>
            <input v-model="nickname" class="input" />
          </div>
        </div>
        <div class="spread">
          <span class="muted">電子郵件</span>
          <strong>{{ authStore.user?.email }}</strong>
        </div>
      </div>
      <ErrorState :message="error" />
      <button class="btn btn-primary btn-block" :disabled="loading" @click="save">
        {{ loading ? "儲存中..." : "儲存變更" }}
      </button>
      <button class="btn btn-danger btn-block" @click="signOut">登出</button>
    </div>
  </AppLayout>
</template>
