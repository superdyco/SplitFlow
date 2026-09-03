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
/**
 * 進階區的錯誤跟暱稱的錯誤分開放。
 *
 * 共用一個 ref 的話，匯出失敗時訊息會印在頁面最上方的儲存鈕旁邊，而使用者
 * 正站在摺疊段的底部 —— 他會按了匯出、什麼都沒發生、也不知道為什麼。
 * 錯誤要出現在造成它的那顆按鈕旁邊。
 */
const advancedError = ref<string | null>(null);

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
/**
 * 「進階」：匯出、刪除帳號、診斷。預設收起來。
 *
 * 這三塊加起來佔了整頁一半的高度，而使用者一年用不到一次 —— 平常來這一頁
 * 是為了改暱稱或登出。收起來不是把它們藏起來，是讓常用的那兩件事有重量。
 */
const showAdvanced = ref(false);

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
  advancedError.value = null;
  try {
    await deleteOwnAccount();
    userStore.clear();
    await router.push("/login");
  } catch (err) {
    advancedError.value = firebaseErrorMessage(err);
  } finally {
    deleting.value = false;
  }
}

async function exportData() {
  const uid = authStore.user?.uid;
  if (!uid || exporting.value) return;
  exporting.value = true;
  advancedError.value = null;
  exportProgress.value = "正在整理分帳資料";
  try {
    const data = await buildDataExport(uid, progress => {
      exportProgress.value = progress.message;
    });
    downloadDataExport(data);
    exportProgress.value = "匯出完成";
  } catch (err) {
    advancedError.value = firebaseErrorMessage(err);
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
          <div class="field grow">
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

      <!--
        儲存緊跟在暱稱卡下面。原本它排在「旅程」與「資料匯出」兩張卡之後 ——
        改個暱稱要捲過兩張不相干的卡才按得到，而那兩張卡跟這顆按鈕沒有關係。

        這裡的錯誤只服務儲存。匯出與刪除的錯誤在進階區裡它們自己的按鈕旁邊 ——
        見 advancedError 的說明。
      -->
      <ErrorState :message="error" />
      <button class="btn btn-primary btn-block" :disabled="loading || !canSubmit" @click="save">
        {{ loading ? "儲存中..." : saved ? "已儲存" : "儲存變更" }}
      </button>
      <!--
        收藏與探索自成一張卡，不混進上面的帳號表單。

        這兩個是「去別的地方」而不是「改這一頁的東西」——
        跟暱稱與那顆儲存是不同性質的操作。
      -->
      <div class="card flat stack">
        <h2 class="card-head">旅程</h2>
        <RouterLink to="/favorites" class="btn btn-block">我的收藏</RouterLink>
        <RouterLink to="/explore" class="btn btn-block">探索公開旅程</RouterLink>
      </div>
      <!--
        進階：匯出、刪除帳號、診斷。三塊加起來佔了整頁一半的高度，而使用者
        一年用不到一次 —— 收起來讓上面的暱稱與登出有重量。

        用純文字的展開鍵而不是一張卡：它是一個抽屜的把手，不是一個區塊。
      -->
      <button class="link advanced-toggle" @click="showAdvanced = !showAdvanced">
        {{ showAdvanced ? "收起進階" : "進階" }}
      </button>

      <template v-if="showAdvanced">
        <!-- 錯誤放在進階區內：造成它的按鈕都在這裡。 -->
        <ErrorState :message="advancedError" />

        <div class="card flat stack">
          <h2 class="card-head">資料匯出</h2>
          <p class="tiny">
            下載你目前可讀取的帳號、任務、成員、支出、付款、結算紀錄與 Base64 收據圖片。
            檔案含有私人帳務資料，請妥善保存；收據較多時檔案可能很大。
          </p>
          <button class="btn btn-block" :disabled="exporting" @click="exportData">
            {{ exporting ? "匯出中..." : "匯出 JSON 資料" }}
          </button>
          <span v-if="exportProgress" class="tiny">{{ exportProgress }}</span>
        </div>

        <div class="card flat stack danger-zone">
          <h2 class="card-head">刪除帳號</h2>
          <p class="tiny">
            你的支出與結算會留在同行的人那裡 —— 那些帳同時也是他們的紀錄。
            你的帳號、個人資料與收藏會永久消失，無法復原。
          </p>
          <button class="btn btn-danger btn-block" :disabled="deleting" @click="confirmingDelete = true">
            {{ deleting ? "刪除中..." : "刪除帳號" }}
          </button>
        </div>

        <!--
          診斷在進階裡還有自己的一層摺疊，那不是多餘的：展開它要開 IndexedDB
          讀收據佇列，而那是「出事了才會被叫來按」的東西，不該因為使用者
          打開進階看一眼匯出就順便讀一次資料庫。
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
      </template>

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
    </div>
  </AppLayout>
</template>

<style scoped>
/*
  這裡原本寫 var(--danger, #d63939)，而 --danger 這個 token 不存在 ——
  一年來吃的都是後面那個硬寫的 fallback。改用真正的 token：柔和的紅邊
  跟 .btn-danger 同一個語言，區塊本身不需要跟裡面那顆按鈕搶。
*/
.danger-zone {
  border-color: var(--color-danger-line);
}

.grow {
  flex: 1;
  min-width: 0;
}

.warn {
  color: var(--color-danger);
}

/*
  進階的把手。左對齊、純文字 —— 它是抽屜的把手，不是一個區塊，
  不該有卡片或外框去宣告自己是一個東西。
*/
.advanced-toggle {
  align-self: flex-start;
}

.diagnostics {
  /* 8px 不在 4px 網格上，那是上一輪尺度對齊漏掉的一處。 */
  margin-top: var(--space-2);
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
