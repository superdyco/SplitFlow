<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import AppLayout from "@/layouts/AppLayout.vue";
import ConfirmDialog from "@/components/common/ConfirmDialog.vue";
import ErrorState from "@/components/common/ErrorState.vue";
import { logout, providerLabel } from "@/services/authService";
import { listQueued } from "@/services/receiptQueue";
import { useAuthStore } from "@/stores/auth";
import { useUserStore } from "@/stores/user";
import { useCopy } from "@/composables/useCopy";
import { recentErrors } from "@/utils/debugLog";
import { buildDiagnosticsText } from "@/utils/diagnostics";
import { firebaseErrorMessage, required, textFieldError } from "@/utils/firestore";
import { isInstalledApp } from "@/utils/platform";
import { buildDataExport, downloadDataExport } from "@/services/dataExportService";
import { deleteOwnAccount } from "@/services/accountService";
import { listUserTasks } from "@/services/taskService";
import type { Task } from "@/types/task";
import { deleteAccountPrompt } from "@/utils/accountDeletion";

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
const exporting = ref(false);
const exportProgress = ref("");

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

/**
 * 診斷資訊。**預設收起來**：這一頁是給使用者改暱稱的，不是儀表板。
 *
 * 收據佇列要開 IndexedDB，所以等使用者真的展開才去讀 —— 每次進個人設定
 * 都開一次資料庫，只為了一段大部分時候沒人看的文字，不划算。
 */
const showDiagnostics = ref(false);
const queuedReceipts = ref<number[] | null>(null);
const errors = ref(recentErrors());
const { copied: diagnosticsCopied, copy } = useCopy();

const diagnosticsText = computed(() =>
  buildDiagnosticsText({
    version: __APP_VERSION__,
    uid: authStore.user?.uid || "",
    loginMethod: loginMethod.value,
    online: navigator.onLine,
    installed: isInstalledApp(),
    queuedReceipts: queuedReceipts.value,
    placesKey: !!(
      import.meta.env.VITE_GOOGLE_PLACES_API_KEY || import.meta.env.VITE_GOOGLE_MAPS_API_KEY
    ),
    mapsKey: !!import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
    userAgent: navigator.userAgent,
    errors: errors.value
  })
);

async function toggleDiagnostics() {
  showDiagnostics.value = !showDiagnostics.value;
  if (!showDiagnostics.value) return;
  // 每次展開都重新抓一次，不然使用者照著指示重現問題之後看到的還是舊的那份。
  errors.value = recentErrors();
  try {
    queuedReceipts.value = (await listQueued()).map(item => item.attempts);
  } catch {
    // 讀不到佇列本身就是一條線索，buildDiagnosticsText 會把 null 講成人話。
    queuedReceipts.value = null;
  }
}

async function signOut() {
  await logout();
  userStore.clear();
  await router.push("/login");
}

// 刪除帳號的確認要講出「幾個任務」「幾個是你的」，所以這一頁需要任務清單。
// 只讀一次就好 —— 這裡要的是數量，不是即時狀態。
const tasks = ref<Task[]>([]);
const deleting = ref(false);
const confirmingDelete = ref(false);

onMounted(async () => {
  const id = authStore.user?.uid;
  if (!id) return;
  try {
    tasks.value = await listUserTasks(id);
  } catch {
    // 讀不到就當作沒有任務。確認訊息會少講一段，但不該讓整頁壞掉，
    // 而且刪除本身在雲端執行，不依賴這份清單。
    tasks.value = [];
  }
});

// 對話框的內容。要在畫面上綁定，所以是 computed 而不是按下去才算。
const deletePrompt = computed(() =>
  deleteAccountPrompt({
    nickname: userStore.profile?.nickname ?? "",
    taskCount: tasks.value.length,
    ownedTaskCount: tasks.value.filter(task => task.ownerId === authStore.user?.uid).length
  })
);

async function deleteAccount() {
  if (deleting.value) return;
  confirmingDelete.value = false;

  deleting.value = true;
  error.value = null;
  try {
    await deleteOwnAccount();
    userStore.clear();
    await router.push("/login");
  } catch (err) {
    error.value = firebaseErrorMessage(err);
  } finally {
    deleting.value = false;
  }
}

async function exportData() {
  const uid = authStore.user?.uid;
  if (!uid || exporting.value) return;
  exporting.value = true;
  error.value = null;
  exportProgress.value = "正在整理分帳資料";
  try {
    const data = await buildDataExport(uid, progress => {
      exportProgress.value = progress.message;
    });
    downloadDataExport(data);
    exportProgress.value = "匯出完成";
  } catch (err) {
    error.value = firebaseErrorMessage(err);
    exportProgress.value = "";
  } finally {
    exporting.value = false;
  }
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

      <!--
        收藏與探索擺在帳號資訊之後、儲存按鈕之前。

        這兩個是「去別的地方」而不是「改這一頁的東西」，跟下面那顆儲存不同性質，
        所以自成一張卡而不是混進表單裡。
      -->
      <div class="card stack">
        <strong class="section-title">旅程</strong>
        <RouterLink to="/favorites" class="btn btn-block">我的收藏</RouterLink>
        <RouterLink to="/explore" class="btn btn-block">探索公開旅程</RouterLink>
      </div>
      <ErrorState :message="error" />
      <div class="card stack">
        <strong class="section-title">資料匯出</strong>
        <p class="tiny">
          下載你目前可讀取的帳號、任務、成員、支出、付款、結算紀錄與 Base64 收據圖片。
          檔案含有私人帳務資料，請妥善保存；收據較多時檔案可能很大。
        </p>
        <button class="btn btn-block" :disabled="exporting" @click="exportData">
          {{ exporting ? "匯出中..." : "匯出 JSON 資料" }}
        </button>
        <span v-if="exportProgress" class="tiny">{{ exportProgress }}</span>
      </div>
      <button class="btn btn-primary btn-block" :disabled="loading || !canSubmit" @click="save">
        {{ loading ? "儲存中..." : saved ? "已儲存" : "儲存變更" }}
      </button>
      <button class="btn btn-danger btn-block" @click="signOut">登出</button>

      <div class="card stack danger-zone">
        <strong class="section-title">刪除帳號</strong>
        <p class="tiny">
          你的支出與結算會留在同行的人那裡 —— 那些帳同時也是他們的紀錄。
          你的帳號、個人資料與收藏會永久消失，無法復原。
        </p>
        <button class="btn btn-danger btn-block" :disabled="deleting" @click="confirmingDelete = true">
          {{ deleting ? "刪除中..." : "刪除帳號" }}
        </button>
      </div>

      <ConfirmDialog
        :open="confirmingDelete"
        :title="deletePrompt.title"
        :message="deletePrompt.message"
        :confirm-label="deletePrompt.confirmLabel"
        danger
        :require-text="deletePrompt.requireText"
        @confirm="deleteAccount"
        @cancel="confirmingDelete = false"
      />

      <!--
        擺在登出下面、樣式刻意最輕：這是「出事了才會被叫來按」的東西，
        平常不該跟暱稱與登出搶注意力。
      -->
      <div class="stack diagnostics">
        <button class="link" @click="toggleDiagnostics">
          {{ showDiagnostics ? "收起診斷資訊" : "診斷資訊" }}
        </button>
        <template v-if="showDiagnostics">
          <p class="tiny">遇到問題時，把下面這段複製給開發者，通常就查得出原因。</p>
          <pre class="report">{{ diagnosticsText }}</pre>
          <button class="btn btn-block" @click="copy(diagnosticsText)">
            {{ diagnosticsCopied ? "已複製" : "複製診斷資訊" }}
          </button>
        </template>
      </div>
    </div>
  </AppLayout>
</template>

<style scoped>
.danger-zone {
  border-color: var(--danger, #d63939);
}

.warn {
  color: var(--color-danger);
}

.diagnostics {
  margin-top: 8px;
  align-items: flex-start;
}

.link {
  border: 0;
  background: none;
  padding: 0;
  color: var(--color-muted);
  font-size: var(--text-tiny);
  font-weight: 700;
}

/*
  等寬字加保留換行：這段是要被整段複製走的純文字，畫面上長什麼樣就複製到什麼。
  `overflow-x: auto` 是給 userAgent 那種長到爆的行用的，不能讓它把整頁撐寬。
*/
.report {
  width: 100%;
  margin: 0;
  padding: 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  /* 等寬字型的視覺大小比同尺寸的中文小，這塊除錯輸出刻意留在字級表外。 */
  font-size: 11px;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  overflow-x: auto;
}
</style>
