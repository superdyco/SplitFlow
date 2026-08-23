import { createRouter, createWebHistory, type RouteLocationNormalized } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { useUserStore } from "@/stores/user";
import { markPhase, startTrace, traceDetail } from "@/utils/perfTrace";

/**
 * 只追這一頁。使用者說卡的是它，而每多追一頁就多一份寫入成本與雜訊 ——
 * 之後要追別頁，把路徑加進來、頁面自己收尾就好。
 */
const TRACED_PATH = "/tasks";

/**
 * 冷啟動與站內導航是兩種完全不同的慢法：前者要付 HTML + JS bundle +
 * firebase 初始化，後者一行都不用重載。混在一起平均，兩邊都看不出問題。
 */
let firstNavigation = true;

const LoginPage = () => import("@/pages/LoginPage.vue");
const OnboardingPage = () => import("@/pages/OnboardingPage.vue");
const TaskListPage = () => import("@/pages/TaskListPage.vue");
const CreateTaskPage = () => import("@/pages/CreateTaskPage.vue");
const TaskPage = () => import("@/pages/TaskPage.vue");
const ExpenseFormPage = () => import("@/pages/ExpenseFormPage.vue");
const JoinTaskPage = () => import("@/pages/JoinTaskPage.vue");
const ProfilePage = () => import("@/pages/ProfilePage.vue");
const ReportPage = () => import("@/pages/ReportPage.vue");

function waitForAuth(authStore: ReturnType<typeof useAuthStore>) {
  if (authStore.initialized) return Promise.resolve();
  return new Promise<void>(resolve => {
    const stop = authStore.$subscribe(() => {
      if (authStore.initialized) {
        stop();
        resolve();
      }
    });
  });
}

async function ensureProfile(uid: string) {
  const userStore = useUserStore();
  if (userStore.loadedForUid !== uid) await userStore.load(uid);
  return userStore.profile;
}

function redirectPath(to: RouteLocationNormalized) {
  return encodeURIComponent(to.fullPath);
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/tasks" },
    { path: "/login", component: LoginPage, meta: { public: true } },
    { path: "/onboarding", component: OnboardingPage, meta: { requiresAuth: true } },
    { path: "/tasks", component: TaskListPage, meta: { requiresAuth: true, requiresProfile: true } },
    { path: "/tasks/new", component: CreateTaskPage, meta: { requiresAuth: true, requiresProfile: true } },
    { path: "/tasks/:taskId", component: TaskPage, meta: { requiresAuth: true, requiresProfile: true } },
    { path: "/tasks/:taskId/expenses/new", component: ExpenseFormPage, meta: { requiresAuth: true, requiresProfile: true } },
    { path: "/tasks/:taskId/expenses/:expenseId/edit", component: ExpenseFormPage, meta: { requiresAuth: true, requiresProfile: true } },
    { path: "/join/:inviteCode", component: JoinTaskPage, meta: { public: true } },
    // 公開的旅費報告：不需要帳號，守衛在 `if (!user) return true` 就放行了。
    { path: "/r/:taskId/:reportId", component: ReportPage, meta: { public: true } },
    { path: "/profile", component: ProfilePage, meta: { requiresAuth: true, requiresProfile: true } }
  ]
});

router.beforeEach(async (to, from) => {
  if (to.path === TRACED_PATH) {
    startTrace("tasks");
    traceDetail("cold", firstNavigation);
    traceDetail("from", from.path);
  }
  firstNavigation = false;

  const authStore = useAuthStore();
  authStore.init();
  await waitForAuth(authStore);
  // 冷啟動時這一段是在等 Firebase 從 IndexedDB 還原登入狀態；之後都是 0。
  markPhase("auth");

  const user = authStore.user;
  if (to.path === "/login" && user) {
    const profile = await ensureProfile(user.uid);
    return profile?.nickname ? "/tasks" : `/onboarding?redirect=${redirectPath(to)}`;
  }

  if (to.meta.requiresAuth && !user) {
    return `/login?redirect=${redirectPath(to)}`;
  }

  if (!user) return true;

  const profile = await ensureProfile(user.uid);
  // 第一次會真的讀一趟 users/{uid}，之後 userStore 有快取就是 0。
  markPhase("profile");
  if (to.meta.requiresProfile && !profile?.nickname) {
    return `/onboarding?redirect=${redirectPath(to)}`;
  }

  if (to.path === "/onboarding" && profile?.nickname) {
    const redirect = typeof to.query.redirect === "string" ? decodeURIComponent(to.query.redirect) : "/tasks";
    return redirect === "/login" ? "/tasks" : redirect;
  }

  /*
    這裡本來還有一段 `requiresTaskMember`：進任務頁或支出頁之前先讀一次
    成員文件，不是成員就導去 `?denied=1`。拿掉了，因為它是**重複的**：

      - 真正的防線是 Firestore rules，不是這裡。
      - 任務頁與支出頁自己就會處理 —— `useTask.load()` 讀不到就設 denied，
        兩頁都渲染 <AccessDenied />。行為完全一樣。

    代價卻很實在：守衛是 await 的，這一趟往返擋在導航前面，**畫面還停在上一頁**，
    連「讀取中」都還沒出現；接著頁面自己又會把同一份成員文件再讀一次。
    也就是每次進任務頁／支出頁都要三趟串行往返，其中一趟純屬重複。
    手機網路上那一趟就是使用者說的「按下去之後卡了一下才有反應」。
  */
  return true;
});

/**
 * beforeResolve 跑的時候，頁面元件的 chunk 已經下載並解析完了。
 *
 * 這一段跟守衛是分開的兩次等待，而且它不是 Firestore 的問題而是打包的問題 ——
 * 分不出來的話，看到「進頁面要兩秒」很容易一路往查詢那邊找，然後什麼都找不到。
 */
router.beforeResolve(to => {
  if (to.path === TRACED_PATH) markPhase("chunk");
});
