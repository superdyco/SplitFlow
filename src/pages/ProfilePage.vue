<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import AppLayout from "@/layouts/AppLayout.vue";
import ErrorState from "@/components/common/ErrorState.vue";
import { logout, providerLabel } from "@/services/authService";
import { useAuthStore } from "@/stores/auth";
import { useUserStore } from "@/stores/user";
import { firebaseErrorMessage, required, textFieldError } from "@/utils/firestore";

const router = useRouter();
const authStore = useAuthStore();
const userStore = useUserStore();
const nickname = ref(userStore.profile?.nickname || "");
const loading = ref(false);
const error = ref<string | null>(null);
const touched = ref(false);
const saved = ref(false);
const initial = computed(() => nickname.value.trim().charAt(0).toUpperCase() || "?");
const nicknameError = computed(() =>
  textFieldError(nickname.value, "暱稱", { max: 20, touched: touched.value })
);
const isDirty = computed(() => nickname.value.trim() !== (userStore.profile?.nickname || ""));
/** 有三種登入方式，記得自己是用哪一個進來的很重要，換一個就是另一個帳號。 */
const loginMethod = computed(() => {
  const id = authStore.user?.providerData[0]?.providerId || userStore.profile?.provider;
  return id ? providerLabel(id) : "";
});
const canSubmit = computed(() => !!nickname.value.trim() && !nicknameError.value && isDirty.value);

async function save() {
  if (!authStore.user) return;
  touched.value = true;
  if (!canSubmit.value) return;
  loading.value = true;
  error.value = null;
  saved.value = false;
  try {
    await userStore.updateNickname(authStore.user.uid, required(nickname.value, "暱稱"));
    saved.value = true;
    window.setTimeout(() => (saved.value = false), 2000);
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
            <input v-model="nickname" class="input" maxlength="20" @blur="touched = true" />
            <span v-if="nicknameError" class="tiny warn">{{ nicknameError }}</span>
          </div>
        </div>
        <div class="spread">
          <span class="muted">電子郵件</span>
          <strong>{{ authStore.user?.email || "未提供" }}</strong>
        </div>
        <div v-if="loginMethod" class="spread">
          <span class="muted">登入方式</span>
          <strong>{{ loginMethod }}</strong>
        </div>
      </div>
      <p class="tiny">
        下次請用同一種方式登入。換一個供應商會被視為另一個帳號，看不到現在的任務。
      </p>
      <ErrorState :message="error" />
      <button class="btn btn-primary btn-block" :disabled="loading || !canSubmit" @click="save">
        {{ loading ? "儲存中..." : saved ? "已儲存" : "儲存變更" }}
      </button>
      <button class="btn btn-danger btn-block" @click="signOut">登出</button>
    </div>
  </AppLayout>
</template>

<style scoped>
.warn {
  color: var(--color-danger);
}
</style>
