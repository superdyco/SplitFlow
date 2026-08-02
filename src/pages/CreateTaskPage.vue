<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterLink } from "vue-router";
import AppLayout from "@/layouts/AppLayout.vue";
import ErrorState from "@/components/common/ErrorState.vue";
import type { Task } from "@/types/task";
import { createTask } from "@/services/taskService";
import { useUserStore } from "@/stores/user";
import { CURRENCIES } from "@/utils/currency";
import {
  buildInviteUrl,
  dateRangeError,
  firebaseErrorMessage,
  required,
  textFieldError
} from "@/utils/firestore";

const userStore = useUserStore();
const name = ref("");
const nameTouched = ref(false);
const defaultCurrency = ref("TWD");
const startDate = ref("");
const endDate = ref("");
const loading = ref(false);
const error = ref<string | null>(null);
const createdTask = ref<Task | null>(null);
const copied = ref(false);
const inviteUrl = computed(() => createdTask.value ? buildInviteUrl(createdTask.value.inviteCode) : "");

const nameError = computed(() => textFieldError(name.value, "任務名稱", { max: 40, touched: nameTouched.value }));
const dateError = computed(() => dateRangeError(startDate.value, endDate.value));
const canSubmit = computed(() => !!name.value.trim() && !nameError.value && !dateError.value);

async function submit() {
  if (!userStore.profile) return;
  nameTouched.value = true;
  if (!canSubmit.value) return;
  loading.value = true;
  error.value = null;
  try {
    createdTask.value = await createTask({
      name: required(name.value, "任務名稱"),
      defaultCurrency: defaultCurrency.value,
      startDate: startDate.value || null,
      endDate: endDate.value || null
    }, userStore.profile);
  } catch (err) {
    error.value = firebaseErrorMessage(err);
  } finally {
    loading.value = false;
  }
}

async function copy() {
  await navigator.clipboard.writeText(inviteUrl.value);
  copied.value = true;
  window.setTimeout(() => (copied.value = false), 1500);
}
</script>

<template>
  <AppLayout>
    <div v-if="!createdTask" class="stack">
      <h1 class="title">建立分帳任務</h1>
      <div class="card stack">
        <label class="field">
          <span class="label">任務名稱</span>
          <input
            v-model="name"
            class="input"
            maxlength="40"
            placeholder="例如：曼谷旅行"
            @blur="nameTouched = true"
          />
          <span v-if="nameError" class="tiny warn">{{ nameError }}</span>
        </label>
        <label class="field">
          <span class="label">主要幣別</span>
          <select v-model="defaultCurrency" class="select">
            <option v-for="currency in CURRENCIES" :key="currency" :value="currency">{{ currency }}</option>
          </select>
        </label>
        <label class="field">
          <span class="label">開始日期</span>
          <input v-model="startDate" class="input" type="date" />
        </label>
        <label class="field">
          <span class="label">結束日期</span>
          <input v-model="endDate" class="input" type="date" :min="startDate || undefined" />
          <span v-if="dateError" class="tiny warn">{{ dateError }}</span>
        </label>
      </div>
      <ErrorState :message="error" />
      <button class="btn btn-primary btn-block" :disabled="loading || !canSubmit" @click="submit">
        {{ loading ? "建立中..." : "建立並取得邀請連結" }}
      </button>
    </div>

    <div v-else class="stack">
      <div class="card success-card">
        <div class="brand-mark">✓</div>
        <h1 class="title">任務建立完成</h1>
        <p class="muted">把連結傳給同行的人，他們登入並建立暱稱後就能加入。</p>
      </div>
      <div class="card row">
        <span class="invite">{{ inviteUrl }}</span>
        <button class="btn btn-ghost" @click="copy">{{ copied ? "已複製" : "複製" }}</button>
      </div>
      <RouterLink :to="`/tasks/${createdTask.id}`" class="btn btn-primary btn-block">進入任務</RouterLink>
      <RouterLink to="/tasks" class="btn btn-block">回我的分帳</RouterLink>
    </div>
  </AppLayout>
</template>

<style scoped>
.success-card {
  text-align: center;
}

.success-card .brand-mark {
  margin: 0 auto 14px;
}

.warn {
  color: var(--color-danger);
}

.invite {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  color: var(--color-muted);
  font-size: 13px;
}
</style>
