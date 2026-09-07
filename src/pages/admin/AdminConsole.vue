<script setup lang="ts">
import { computed } from "vue";
import { RouterLink, useRoute } from "vue-router";
import AdminOverviewPage from "@/pages/admin/AdminOverviewPage.vue";
import AdminUsersPage from "@/pages/admin/AdminUsersPage.vue";
import AdminTasksPage from "@/pages/admin/AdminTasksPage.vue";
import AdminReportsPage from "@/pages/admin/AdminReportsPage.vue";
import AdminHealthPage from "@/pages/admin/AdminHealthPage.vue";
import AdminAuditPage from "@/pages/admin/AdminAuditPage.vue";

/**
 * 後台的外框。
 *
 * ## 為什麼分頁不用 vue-router 的巢狀路由
 *
 * 巢狀路由的子元件是路由自己去 import 的，所以**在門確認身分之前**就會把
 * 子頁面那包 JS 抓下來。整個後台走一道門的重點就是「不是管理者的人連下載
 * 都不會發生」，巢狀路由會把那件事拆掉。
 *
 * 所以路由只有一條 `/admin/:section*`，網址照樣是真的、上一頁也照樣能用，
 * 只是決定顯示哪一頁的是這裡而不是路由表。
 */
const route = useRoute();

const SECTIONS = [
  { id: "", label: "總覽", to: "/admin" },
  { id: "users", label: "使用者", to: "/admin/users" },
  { id: "tasks", label: "任務", to: "/admin/tasks" },
  { id: "reports", label: "公開報告", to: "/admin/reports" },
  { id: "health", label: "系統健康", to: "/admin/health" },
  { id: "audit", label: "稽核日誌", to: "/admin/audit" }
] as const;

const section = computed(() => {
  const raw = route.params.section;
  const parts = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return parts[0] ?? "";
});

const VIEWS = {
  users: AdminUsersPage,
  tasks: AdminTasksPage,
  reports: AdminReportsPage,
  health: AdminHealthPage,
  audit: AdminAuditPage
} as const;

const view = computed(
  () => VIEWS[section.value as keyof typeof VIEWS] ?? AdminOverviewPage
);
</script>

<template>
  <div class="admin">
    <aside class="side">
      <div class="mark">
        <img src="/logo.png" alt="" class="mark-logo" />
        <div>
          <div class="mark-name">簡單分帳</div>
          <div class="mark-sub">管理後台</div>
        </div>
      </div>

      <nav class="nav">
        <RouterLink
          v-for="item in SECTIONS"
          :key="item.id"
          :to="item.to"
          class="nav-item"
          :class="{ active: section === item.id }"
        >
          {{ item.label }}
        </RouterLink>
      </nav>

      <div class="foot">
        <!--
          「唯讀」不是裝飾。這個後台看得到全部使用者的資料，而看得到什麼、
          能動什麼是兩件事 —— 把後者標出來，才不會有人以為自己按得動。
        -->
        <span class="ro">唯讀模式</span>
        <RouterLink to="/tasks" class="back">回到 app</RouterLink>
      </div>
    </aside>

    <component :is="view" />
  </div>
</template>

<style scoped>
.admin {
  display: flex;
  min-height: 100vh;
}

/*
  內容區。.page 本來是一般頁面的根，沒有任何 flex 設定 —— 放進這個橫排裡
  就成了一個 flex: 0 1 auto、min-width: auto 的項目：寬度由內容決定（寬螢幕
  上右邊空一大塊、.console 的 margin: 0 auto 也置中不了），而且縮不到內容
  以下（長的 Email 跟 UID 會把整頁推出視窗）。兩件事都得寫清楚才會停。
*/
.admin > .page {
  flex: 1;
  min-width: 0;
}

.side {
  width: 220px;
  flex: none;
  background: var(--color-surface);
  border-right: 1px solid var(--color-line);
  padding: var(--space-6) var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.mark {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.mark-logo {
  width: 38px;
  height: 38px;
  border-radius: var(--radius-md);
  object-fit: cover;
}

.mark-name {
  font-weight: 900;
  line-height: 1.2;
}

.mark-sub {
  color: var(--color-muted);
  font-size: var(--text-tiny);
  font-weight: 700;
  line-height: 1.4;
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-item {
  display: flex;
  align-items: center;
  min-height: 40px;
  padding: 0 var(--space-3);
  border-radius: var(--radius-sm);
  color: var(--color-muted);
  font-weight: 700;
  transition: background var(--dur-base) var(--ease);
}

.nav-item:hover {
  background: var(--color-track);
}

/* 選中態跟 .seg-item.active 同一組 token —— 側邊導覽是次層級，不跟頁面標題搶重量。 */
.nav-item.active {
  background: var(--color-card);
  color: var(--color-ink);
  box-shadow: var(--shadow-rest);
}

.foot {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
}

.ro {
  border-radius: var(--radius-pill);
  padding: 5px 10px;
  background: var(--color-track);
  color: var(--color-muted);
  font-size: var(--text-tiny);
  font-weight: 700;
}

.back {
  color: var(--color-muted);
  font-size: var(--text-tiny);
  font-weight: 700;
  padding: 0 var(--space-1);
}

.back:hover {
  color: var(--color-primary-dark);
}

/* 後台是桌機的東西。窄畫面把導覽收成上面一條，不做抽屜 —— 那是為了一個
   幾乎不會發生的情境多一套互動。 */
@media (max-width: 720px) {
  .admin {
    flex-direction: column;
  }

  .side {
    width: 100%;
    border-right: 0;
    border-bottom: 1px solid var(--color-line);
    flex-direction: row;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-4);
  }

  .nav {
    flex-direction: row;
  }

  .foot {
    margin-top: 0;
    margin-left: auto;
    flex-direction: row;
    align-items: center;
  }
}
</style>
