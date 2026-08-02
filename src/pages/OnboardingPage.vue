<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import AuthLayout from "@/layouts/AuthLayout.vue";
import ErrorState from "@/components/common/ErrorState.vue";
import { useAuthStore } from "@/stores/auth";
import { useUserStore } from "@/stores/user";
import { firebaseErrorMessage, required, textFieldError } from "@/utils/firestore";

const authStore = useAuthStore();
const userStore = useUserStore();
const router = useRouter();
const route = useRoute();
const nickname = ref(userStore.profile?.nickname || authStore.user?.displayName || "");
const loading = ref(false);
const error = ref<string | null>(null);
const touched = ref(false);
const initial = computed(() => nickname.value.trim().charAt(0).toUpperCase() || "?");
const nicknameError = computed(() =>
  textFieldError(nickname.value, "暱稱", { max: 20, touched: touched.value })
);
const canSubmit = computed(() => !!nickname.value.trim() && !nicknameError.value);

async function save() {
  if (!authStore.user) return;
  touched.value = true;
  if (!canSubmit.value) return;
  loading.value = true;
  error.value = null;
  try {
    await userStore.create(authStore.user, required(nickname.value, "暱稱"));
    const redirect = typeof route.query.redirect === "string" ? decodeURIComponent(route.query.redirect) : "/tasks";
    await router.push(redirect === "/login" ? "/tasks" : redirect);
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
      <p class="tiny">FIRST TIME</p>
      <h1 class="title">取一個暱稱</h1>
      <p class="muted">其他成員會在帳目與成員列表看到這個名字，之後可以在個人設定修改。</p>
      <div class="card row">
        <span class="avatar">{{ initial }}</span>
        <input
          v-model="nickname"
          class="input nickname-input"
          maxlength="20"
          placeholder="輸入暱稱"
          @blur="touched = true"
          @keyup.enter="save"
        />
      </div>
      <p v-if="nicknameError" class="tiny warn">{{ nicknameError }}</p>
      <p class="tiny">已用 Google 登入 · {{ authStore.user?.email }}</p>
      <ErrorState :message="error" />
      <button class="btn btn-primary btn-block" :disabled="loading || !canSubmit" @click="save">
        {{ loading ? "儲存中..." : "建立帳號" }}
      </button>
    </div>
  </AuthLayout>
</template>

<style scoped>
.nickname-input {
  border: 0;
  background: transparent;
  font-size: 21px;
  font-weight: 900;
}

.warn {
  color: var(--color-danger);
}
</style>
