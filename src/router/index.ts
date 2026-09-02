import { createRouter, createWebHistory, type RouteLocationNormalized } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { useUserStore } from "@/stores/user";
import { markPhase, startTrace, traceDetail } from "@/utils/perfTrace";
import { backgroundContext } from "@/utils/visibility";

/**
 * 追兩頁：任務列表，以及點進去之後的單一任務。使用者一開始說卡的是列表，
 * 後來確認卡的其實是點進任務那一下 —— 兩頁的讀取量差很多（列表一趟查詢，
 * 內頁一次六趟），所以分開追，名字分開才對得起來。
 *
 * 每多追一頁就多一份寫入成本與雜訊，所以還是只有這兩頁。之後要追別頁，
 * 在這裡認出它、頁面自己收尾就好。
 */
const TRACE_NAMES: Array<[RegExp, string]> = [
  [/^\/tasks$/, "tasks"],
  [/^\/tasks\/[^/]+$/, "task"]
];

function traceNameFor(path: string): string | null {
  const hit = TRACE_NAMES.find(([pattern]) => pattern.test(path));
  return hit ? hit[1] : null;
}

/**
 * 冷啟動 = 這個文件的第一次 `/tasks` 導航，不是第一次導航。
 *
 * 這個區別是量出來的。本來的判斷是「第一次導航」，結果 17 筆樣本全部標成
 * 不是冷啟動，包括明明是全新載入的那幾筆。firstPath 指出了原因：這台裝置的
 * 第一次導航是 `/login`（守衛發現已經登入才轉去 `/tasks`），所以 `/tasks`
 * 永遠是第 1 次而不是第 0 次。
 *
 * 而為什麼開在 `/login` —— manifest 的 start_url 是 `/`，但 iOS 幾乎不看
 * manifest（見 index.html 的註解），它記的是「加入主畫面」當下那個網址。
 * 也就是說這是安裝方式造成的，別台裝置可能完全不一樣。所以判斷冷啟動不能
 * 依賴「第一次導航去哪」這種會因人而異的東西。
 *
 * navIndex 與 firstPath 留著：它們花了一輪就解開這件事，成本是兩個數字。
 */
let navigationCount = 0;
let firstPath = "";
/**
 * 每一種追蹤各自進過幾次。0 代表現在這次是第一次，也就是冷啟動。
 * 分開數是因為列表與內頁的冷啟動不是同一件事 —— 從列表點進內頁時，
 * chunk 與登入狀態早就備好了，那不叫冷。
 */
const tracedCounts: Record<string, number> = {};

const LoginPage = () => import("@/pages/LoginPage.vue");
const OnboardingPage = () => import("@/pages/OnboardingPage.vue");
const TaskListPage = () => import("@/pages/TaskListPage.vue");
const CreateTaskPage = () => import("@/pages/CreateTaskPage.vue");
const TaskPage = () => import("@/pages/TaskPage.vue");
const ExpenseFormPage = () => import("@/pages/ExpenseFormPage.vue");
const ExpenseDetailPage = () => import("@/pages/ExpenseDetailPage.vue");
const JoinTaskPage = () => import("@/pages/JoinTaskPage.vue");
const ProfilePage = () => import("@/pages/ProfilePage.vue");
const ReportPage = () => import("@/pages/ReportPage.vue");
const FavoritesPage = () => import("@/pages/FavoritesPage.vue");
const ExplorePage = () => import("@/pages/ExplorePage.vue");

/**
 * 這個文件第一次還原登入狀態與讀個人資料各花了多久。
 *
 * 為什麼要獨立記，不能只看分段：這兩筆帳落在**第一次導航**頭上，而第一次
 * 導航去哪是裝置決定的。桌機直接開 `/tasks`，所以 `auth` 分段量得到（實測
 * 1,053ms）；手機的 PWA 開在 `/login`，帳算在那一次，追蹤 `/tasks` 時
 * `auth` 永遠是 0 —— 三批樣本都被這件事騙過去，還把它當成「手機上很快」。
 *
 * 記成獨立的值之後，不管第一次導航去哪，數字都跟得上來。
 */
let authRestoreMs: number | null = null;
let profileLoadMs: number | null = null;

async function waitForAuth(authStore: ReturnType<typeof useAuthStore>) {
  const startedAt = performance.now();

  if (!authStore.initialized) {
    await new Promise<void>(resolve => {
      const stop = authStore.$subscribe(() => {
        if (authStore.initialized) {
          stop();
          resolve();
        }
      });
    });
  }

  // 只記第一次。之後每次都是 0，蓋上去就把要查的數字洗掉了。
  if (authRestoreMs === null) authRestoreMs = Math.round(performance.now() - startedAt);
}

async function ensureProfile(uid: string) {
  const userStore = useUserStore();
  const startedAt = performance.now();
  if (userStore.loadedForUid !== uid) await userStore.load(uid);
  if (profileLoadMs === null) profileLoadMs = Math.round(performance.now() - startedAt);
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
    // `/edit` 排在前面，不然 `:expenseId` 會把 "edit" 當成 id 吃掉。
    { path: "/tasks/:taskId/expenses/:expenseId", component: ExpenseDetailPage, meta: { requiresAuth: true, requiresProfile: true } },
    { path: "/join/:inviteCode", component: JoinTaskPage, meta: { public: true } },
    // 公開的旅費報告：不需要帳號，守衛在 `if (!user) return true` 就放行了。
    { path: "/r/:taskId/:reportId", component: ReportPage, meta: { public: true } },
    { path: "/profile", component: ProfilePage, meta: { requiresAuth: true, requiresProfile: true } },
    /*
      收藏與探索都要登入。

      單一份報告的連結（上面那條 /r/...）不需要帳號，傳給誰誰就看得到；
      但「一次列出所有人公開的旅程」是另一回事，那份名單只給這個 app 的
      使用者。規則那邊也是這樣寫的，不是只有這裡擋。
    */
    { path: "/favorites", component: FavoritesPage, meta: { requiresAuth: true, requiresProfile: true } },
    { path: "/explore", component: ExplorePage, meta: { requiresAuth: true, requiresProfile: true } }
  ]
});

router.beforeEach(async (to, from) => {
  if (!firstPath) firstPath = to.path;
  const navIndex = navigationCount;
  navigationCount += 1;

  /*
    query 變了但路徑沒變 —— 那是頁內切換（任務頁的頁籤），不是一次頁面載入。

    不擋的話每切一次頁籤都會 startTrace 開一筆新的 trace，而元件沒有重新
    掛載、onMounted 不會再跑，finishTrace 永遠不會被呼叫。除了讓 tracedCounts
    灌水，更糟的是使用者在頁面還在載的時候切頁籤，正在進行的那一筆會被蓋掉。
  */
  const samePage = to.path === from.path;
  const traceName = samePage ? null : traceNameFor(to.path);
  if (traceName) {
    startTrace(traceName);
    const seen = tracedCounts[traceName] ?? 0;
    traceDetail("cold", seen === 0);
    tracedCounts[traceName] = seen + 1;
    traceDetail("navIndex", navIndex);
    traceDetail("firstPath", firstPath);
    traceDetail("from", from.path);

    /*
      最可疑但一直沒量到的變數。卡 30 秒的樣本是不是都發生在剛從背景回來，
      這兩個數字回答得了 —— 而在此之前我們只能猜。
    */
    const background = backgroundContext(performance.now());
    traceDetail("hiddenMs", background.hiddenMs);
    traceDetail("sinceVisibleMs", background.sinceVisibleMs);
  }

  const authStore = useAuthStore();
  authStore.init();
  await waitForAuth(authStore);
  // 冷啟動時這一段是在等 Firebase 從儲存還原登入狀態；之後都是 0。
  markPhase("auth");
  // 分段量的是「這一次導航等了多久」，這個量的是「這個文件總共等過多久」。
  // 手機上兩者差很多，而差的那一段正是使用者盯著空白畫面的時間。
  traceDetail("authRestoreMs", authRestoreMs ?? 0);

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
  traceDetail("profileLoadMs", profileLoadMs ?? 0);
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
  if (traceNameFor(to.path)) markPhase("chunk");
});
