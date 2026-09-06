<script setup lang="ts">
import { defineAsyncComponent, ref } from "vue";
import { isPlatformAdmin } from "@/services/adminService";
import NotFoundPage from "@/pages/NotFoundPage.vue";
import LoadingState from "@/components/common/LoadingState.vue";

/**
 * `/admin` 的門。
 *
 * ## 為什麼守衛不做這件事
 *
 * 因為要**網址不變**。守衛只能轉址，而轉址到 `/404` 就等於承認 `/admin`
 * 是一個真的、只是你不夠格的網址 —— 隨便打一個不存在的網址是原地顯示
 * 找不到頁面，只有 `/admin` 會跳走的話，那個差別本身就是答案。
 *
 * 所以這裡渲染的是跟萬用路由**同一個** NotFoundPage，兩邊看起來一模一樣。
 *
 * ## 為什麼後台是動態 import
 *
 * 不是管理者的人連那包 JS 都不會下載。這跟 `stores/user.ts` 把
 * memberService 改成動態 import 是同一個考量：不要為了一個幾乎沒人會用到
 * 的東西，讓每個人的每次開啟都多下載一份。
 *
 * 這一層的擋只是體驗，不是防線 —— 真正的防線是每支 callable 自己驗
 * claim。把後台的 JS 抓下來讀也拿不到任何資料。
 */
const state = ref<"checking" | "denied" | "ok">("checking");

const Console = defineAsyncComponent(() => import("@/pages/admin/AdminConsole.vue"));

isPlatformAdmin().then(ok => {
  state.value = ok ? "ok" : "denied";
});
</script>

<template>
  <!--
    檢查期間顯示讀取中而不是先閃一下找不到頁面。閃一下的話，管理者每次
    進來都會先被告知這裡不存在。
  -->
  <div v-if="state === 'checking'" class="page">
    <div class="shell">
      <LoadingState title="讀取中" message="正在確認權限" />
    </div>
  </div>
  <NotFoundPage v-else-if="state === 'denied'" />
  <component :is="Console" v-else />
</template>
