import { createRouter, createWebHistory, type RouteLocationNormalized } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { useUserStore } from "@/stores/user";
import { getTaskMember } from "@/services/memberService";

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
    { path: "/tasks/:taskId", component: TaskPage, meta: { requiresAuth: true, requiresProfile: true, requiresTaskMember: true } },
    { path: "/tasks/:taskId/expenses/new", component: ExpenseFormPage, meta: { requiresAuth: true, requiresProfile: true, requiresTaskMember: true } },
    { path: "/tasks/:taskId/expenses/:expenseId/edit", component: ExpenseFormPage, meta: { requiresAuth: true, requiresProfile: true, requiresTaskMember: true } },
    { path: "/join/:inviteCode", component: JoinTaskPage, meta: { public: true } },
    // 公開的旅費報告：不需要帳號，守衛在 `if (!user) return true` 就放行了。
    { path: "/r/:taskId/:reportId", component: ReportPage, meta: { public: true } },
    { path: "/profile", component: ProfilePage, meta: { requiresAuth: true, requiresProfile: true } }
  ]
});

router.beforeEach(async to => {
  const authStore = useAuthStore();
  authStore.init();
  await waitForAuth(authStore);

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
  if (to.meta.requiresProfile && !profile?.nickname) {
    return `/onboarding?redirect=${redirectPath(to)}`;
  }

  if (to.path === "/onboarding" && profile?.nickname) {
    const redirect = typeof to.query.redirect === "string" ? decodeURIComponent(to.query.redirect) : "/tasks";
    return redirect === "/login" ? "/tasks" : redirect;
  }

  if (to.meta.requiresTaskMember) {
    if (to.query.denied === "1") return true;
    const taskId = String(to.params.taskId || "");
    try {
      const member = await getTaskMember(taskId, user.uid);
      if (!member?.active) return `/tasks/${taskId}?denied=1`;
    } catch {
      return `/tasks/${taskId}?denied=1`;
    }
  }

  return true;
});
