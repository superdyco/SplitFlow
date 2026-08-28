# 新增支出時推播通知（Android）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 有人記了一筆帳，同任務其他人的手機會跳通知，點了打開對應的任務。

**Architecture:** Cloud Functions 的 Firestore 觸發器掛在 `tasks/{taskId}/expenses/{expenseId}` 的建立事件上，算出收件人（`memberIds` 減掉 `createdBy`）、查他們的 FCM token、送出。Token 存在 `users/{uid}/tokens/{token}` 子集合，照抄 repo 既有的 `favorites` 子集合模式。Flutter 那端負責註冊 token、在登出前刪掉、以及把「因為點通知而帶進來的 taskId」轉成一次導頁。

**Tech Stack:** Cloud Functions（Node 20、firebase-functions v6、firebase-admin v13、TypeScript）、Flutter 3.47 / Dart 3.13 + `firebase_messaging`、Firestore Security Rules。

**Spec:** `docs/superpowers/specs/2026-08-28-expense-push-notification-design.md`

## Global Constraints

- **⚠️ Flutter 在目前這台機器上驗證不了。** `flutter` 與 `dart` 都不在 PATH（README 寫的 `C:\dev\flutter` 不存在）。Flutter 的程式照寫，`dart test`／`dart analyze`／`flutter run` 一律留到有環境的機器。**在跑完之前那些任務只能算「已寫、未驗證」，commit message 不要宣稱測試通過。**
- **⚠️ 規則測試也跑不了。** 本機是 JDK 11.0.16，`firebase-tools` 要 JDK 21。規則測試照寫，當作可執行的規格。
- **只做 Android。** iOS 現在連建置都做不到（沒 Mac、沒 Podfile、沒 `GoogleService-Info.plist`、APNs 要 Apple Developer Program）。但**資料模型與 Cloud Function 不綁死平台** —— token 存 `platform` 欄位，函式不假設只有 Android。
- **只推「新增支出」。** 編輯、刪除、付款確認、被加入任務都不推。
- **收件人是 `memberIds` 減掉 `createdBy`，不是減掉 `paidBy`。** 小明幫阿華記一筆阿華付的錢，阿華要收到通知。
- **通知內容完整顯示**：任務名、記帳者暱稱、支出項目、金額。金額格式與 App 內一致（`幣別 + 金額`，例如 `TWD 1,200.00`），**不要另外發明格式**。
- **登出必須在 `signOut()` 之前刪 token。** 順序反了規則會擋下刪除（`isSelf(uid)` 不成立），而留著會讓下一個在這支手機登入的人收到前一個人的通知。
- **不重構成 go_router。** 這個 App 用 `Navigator.push` + `MaterialPageRoute`，`go_router` 是宣告了但沒用的相依。導頁用 provider 傳遞待處理的 taskId，不動導航架構。
- **`deploy:functions` 要獨立**，不要併進現有的 `deploy`（那條是 hosting + rules + indexes + storage）。
- 中文註解與 UI 文案沿用現有語氣：說明「為什麼」而不是複述程式碼。

---

### Task 1: functions 專案骨架與金額格式化

先把新的 npm 專案立起來，並搬好金額格式化 —— 那是唯一有純邏輯、測得到的部分，
先做完它後面的觸發器就只剩串接。

**Files:**
- Create: `functions/package.json`
- Create: `functions/tsconfig.json`
- Create: `functions/.gitignore`
- Create: `functions/src/amount.ts`
- Create: `functions/src/amount.test.ts`
- Modify: `firebase.json`（加 `functions` 區塊）
- Modify: `package.json`（加 `deploy:functions`）

**Interfaces:**
- Consumes: 無
- Produces:
  - `minorUnits(currency: string): number`
  - `formatAmount(amount: number, currency: string): string`

- [ ] **Step 1: 建立 npm 專案**

`functions/package.json`：

```json
{
  "name": "splitflow-functions",
  "private": true,
  "type": "module",
  "engines": { "node": "20" },
  "main": "lib/index.js",
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "dependencies": {
    "firebase-admin": "^13.0.0",
    "firebase-functions": "^6.0.0"
  },
  "devDependencies": {
    "typescript": "^5.8.3",
    "vitest": "^4.1.10"
  }
}
```

`functions/tsconfig.json`：

```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "outDir": "lib",
    "rootDir": "src",
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
```

`functions/.gitignore`：

```
node_modules/
lib/
```

- [ ] **Step 2: 寫失敗的測試**

`functions/src/amount.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { formatAmount, minorUnits } from "./amount.js";

/**
 * 這些期望值是從網頁版 `src/utils/currency.ts` 的 formatAmount 實際跑出來的，
 * 不是照著規則推的。兩邊的輸出必須逐字相同 —— 通知上的金額跟 App 裡看到的
 * 不一樣，使用者會以為記錯了。
 */
describe("formatAmount", () => {
  it("TWD 是兩位小數", () => {
    expect(formatAmount(120000, "TWD")).toBe("1,200.00");
  });

  it("JPY 沒有輔幣單位", () => {
    expect(formatAmount(1200, "JPY")).toBe("1,200");
  });

  it("USD 兩位小數", () => {
    expect(formatAmount(45050, "USD")).toBe("450.50");
  });

  it("小額不會冒出千分位", () => {
    expect(formatAmount(999, "TWD")).toBe("9.99");
  });

  it("沒見過的幣別當成兩位小數", () => {
    expect(formatAmount(100, "XXX")).toBe("1.00");
  });
});

describe("minorUnits", () => {
  it("認得零小數的幣別", () => {
    expect(minorUnits("JPY")).toBe(0);
    expect(minorUnits("KRW")).toBe(0);
    expect(minorUnits("VND")).toBe(0);
  });

  it("其餘一律兩位", () => {
    expect(minorUnits("TWD")).toBe(2);
    expect(minorUnits("沒見過")).toBe(2);
  });
});
```

- [ ] **Step 3: 安裝相依並跑測試確認失敗**

Run: `cd functions && npm install && npm test`
Expected: FAIL —— 找不到 `./amount.js`

- [ ] **Step 4: 寫實作**

`functions/src/amount.ts`：

```ts
/**
 * 金額格式化。**這是第三份副本**（網頁版 `src/utils/currency.ts`、
 * Flutter `lib/domain/currency.dart`，現在再加這裡）。
 *
 * 沒有更好的辦法：函式部署時只上傳 `functions/` 目錄，import 上層的 `src/`
 * 會在部署後找不到檔案。讓 client 先算好寫進文件更糟 —— 那是可以被竄改的
 * 顯示字串，而且污染資料模型。
 *
 * 只搬通知需要的那兩個函式。測試裡的期望值是從網頁版實際跑出來的，
 * 格式跑掉時會被抓到。
 */

const MINOR_UNITS: Record<string, number> = {
  TWD: 2,
  THB: 2,
  USD: 2,
  CNY: 2,
  EGP: 2,
  EUR: 2,
  HKD: 2,
  VND: 0,
  KRW: 0,
  // 日圓沒有輔幣單位，1 円就是最小單位 —— 跟 VND、KRW 同一類。
  JPY: 0
};

export function minorUnits(currency: string): number {
  return MINOR_UNITS[currency] ?? 2;
}

/** 最小單位整數轉成顯示字串，含千分位，例如 45050 / USD -> "450.50"。 */
export function formatAmount(amount: number, currency: string): string {
  const digits = minorUnits(currency);
  const base = String(Math.abs(amount)).padStart(digits + 1, "0");
  const whole = base.slice(0, base.length - digits);
  const fraction = digits ? base.slice(base.length - digits) : "";

  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const sign = amount < 0 ? "-" : "";
  return fraction ? `${sign}${grouped}.${fraction}` : `${sign}${grouped}`;
}
```

- [ ] **Step 5: 跑測試確認通過**

Run: `cd functions && npm test`
Expected: PASS，7 個案例全過

- [ ] **Step 6: 交叉驗證跟網頁版真的一致**

在**專案根目錄**建立一個暫時的測試檔 `tests/_parity.test.ts`：

```ts
import { expect, it } from "vitest";
import { formatAmount } from "@/utils/currency";

it("列出網頁版的輸出，人工比對 functions/src/amount.test.ts", () => {
  const cases: Array<[number, string]> = [
    [120000, "TWD"],
    [1200, "JPY"],
    [45050, "USD"],
    [999, "TWD"],
    [100, "XXX"]
  ];
  const out = cases.map(([a, c]) => `${a}/${c}=${formatAmount(a, c)}`).join(" ");
  expect(out).toBe("PRINT");
});
```

Run: `npm test -- tests/_parity.test.ts`
Expected: FAIL，錯誤訊息裡會印出實際輸出。**逐項比對它跟 Step 2 的期望值一致**，
然後 `rm tests/_parity.test.ts`。這一步是刻意用失敗的斷言把值印出來 ——
比對完就刪掉，不要留在 repo 裡。

- [ ] **Step 7: 接上 firebase.json 與部署指令**

`firebase.json` 在最外層加一個 `functions` 區塊（跟 `hosting`、`firestore`、
`storage` 同層）：

```json
  "functions": {
    "source": "functions",
    "codebase": "default",
    "predeploy": ["npm --prefix functions run build"]
  },
```

根目錄的 `package.json` 加一條 script（**不要動現有的 `deploy`** ——
那條是 hosting + rules + indexes + storage，每次部署網頁版順便重佈函式沒必要，
也讓失敗的原因變模糊）：

```json
    "deploy:functions": "firebase deploy --only functions",
```

- [ ] **Step 8: Commit**

```bash
git add functions/ firebase.json package.json
git commit -m "Give the backend somewhere to live"
```

---

### Task 2: 收件人計算

抽成純函式才測得到 —— 寫在觸發器裡就只能靠實機測，而「誰該收到通知」正是
最不該猜錯的部分。

**Files:**
- Create: `functions/src/recipients.ts`
- Create: `functions/src/recipients.test.ts`

**Interfaces:**
- Consumes: 無
- Produces: `recipientIds(memberIds: string[], createdBy: string): string[]`

- [ ] **Step 1: 寫失敗的測試**

`functions/src/recipients.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { recipientIds } from "./recipients.js";

describe("recipientIds", () => {
  it("排除記帳的人自己", () => {
    expect(recipientIds(["amma", "ming", "hua"], "ming")).toEqual(["amma", "hua"]);
  });

  // 小明幫阿華記一筆阿華付的錢 —— 阿華要收到通知，有人替他登了一筆帳。
  it("不排除付款人", () => {
    expect(recipientIds(["hua", "ming"], "ming")).toEqual(["hua"]);
  });

  it("只有自己一個成員時沒有收件人", () => {
    expect(recipientIds(["ming"], "ming")).toEqual([]);
  });

  it("記帳的人不在名單裡時全部都收（理論上不會發生，但不該當掉）", () => {
    expect(recipientIds(["amma", "hua"], "已離開的人")).toEqual(["amma", "hua"]);
  });

  it("空名單回空陣列", () => {
    expect(recipientIds([], "ming")).toEqual([]);
  });

  // 虛擬成員的合成 id 會留在結果裡，但他沒有 token 文件，
  // 查 token 那一步自然就空了 —— 這裡不特別判斷。
  it("虛擬成員留在名單裡，由查 token 那一步過濾", () => {
    expect(recipientIds(["v_k3n8x2p9qz1m4w7t6r0a", "ming"], "ming")).toEqual([
      "v_k3n8x2p9qz1m4w7t6r0a"
    ]);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd functions && npm test`
Expected: FAIL —— 找不到 `./recipients.js`

- [ ] **Step 3: 寫實作**

`functions/src/recipients.ts`：

```ts
/**
 * 誰該收到「有人新增支出」的通知。
 *
 * **排除的是 createdBy 不是 paidBy。** 小明幫阿華記一筆阿華付的錢，阿華
 * 應該收到通知 —— 有人替他登了一筆帳，那正是他需要知道的。
 *
 * 兩種人不需要在這裡判斷，自然就被排除：
 *
 *   - **虛擬成員**：合成 id 會留在回傳值裡，但他沒有帳號就沒有 token 文件，
 *     查 token 那一步會是空的
 *   - **已被移除的成員**：觸發當下他已經不在 memberIds 裡
 */
export function recipientIds(memberIds: string[], createdBy: string): string[] {
  return memberIds.filter(uid => uid !== createdBy);
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd functions && npm test`
Expected: PASS，13 個案例全過（Task 1 的 7 個 + 這次 6 個）

- [ ] **Step 5: Commit**

```bash
git add functions/src/recipients.ts functions/src/recipients.test.ts
git commit -m "Work out who should hear about a new expense"
```

---

### Task 3: 通知文案

也抽成純函式。文案是使用者唯一會讀的東西，而且金額格式要跟 App 對齊 ——
值得有測試釘住。

**Files:**
- Create: `functions/src/message.ts`
- Create: `functions/src/message.test.ts`

**Interfaces:**
- Consumes: `formatAmount()`（Task 1）
- Produces:
  - `ExpenseNotification { title: string; body: string }`
  - `expenseNotification(input: { taskName: string; author: string; expenseTitle: string; amount: number; currency: string }): ExpenseNotification`

- [ ] **Step 1: 寫失敗的測試**

`functions/src/message.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { expenseNotification } from "./message.js";

describe("expenseNotification", () => {
  const base = {
    taskName: "曼谷旅行",
    author: "小明",
    expenseTitle: "晚餐",
    amount: 120000,
    currency: "TWD"
  };

  it("標題是任務名稱", () => {
    expect(expenseNotification(base).title).toBe("曼谷旅行");
  });

  // 金額寫法跟 App 內一致（幣別 + 金額），不要為了通知另外發明格式。
  it("內文有記帳的人、項目與金額", () => {
    expect(expenseNotification(base).body).toBe("小明新增「晚餐」TWD 1,200.00");
  });

  it("零小數幣別不會多出小數點", () => {
    expect(expenseNotification({ ...base, amount: 1200, currency: "JPY" }).body).toBe(
      "小明新增「晚餐」JPY 1,200"
    );
  });

  // 記帳的人可能已經被移除，member 文件查不到暱稱。
  it("查不到暱稱時用代稱，不要出現空白或 uid", () => {
    expect(expenseNotification({ ...base, author: "" }).body).toBe(
      "有人新增「晚餐」TWD 1,200.00"
    );
  });

  it("沒有任務名稱時用代稱", () => {
    expect(expenseNotification({ ...base, taskName: "" }).title).toBe("分帳更新");
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd functions && npm test`
Expected: FAIL —— 找不到 `./message.js`

- [ ] **Step 3: 寫實作**

`functions/src/message.ts`：

```ts
/**
 * 通知的文字。
 *
 * 金額與項目會顯示在鎖定畫面上，旁邊的人瞄一眼就看得到。2026-08-28 定案：
 * 使用者選擇完整顯示，接受這個取捨。想收斂的話只要改這裡，不影響其他部分。
 */
import { formatAmount } from "./amount.js";

export interface ExpenseNotification {
  title: string;
  body: string;
}

export interface ExpenseNotificationInput {
  taskName: string;
  author: string;
  expenseTitle: string;
  amount: number;
  currency: string;
}

export function expenseNotification({
  taskName,
  author,
  expenseTitle,
  amount,
  currency
}: ExpenseNotificationInput): ExpenseNotification {
  // 記帳的人可能已經被移除，member 文件查不到暱稱 —— 那時寧可說「有人」，
  // 也不要露出 uid 或留一段空白。
  const who = author || "有人";
  return {
    title: taskName || "分帳更新",
    body: `${who}新增「${expenseTitle}」${currency} ${formatAmount(amount, currency)}`
  };
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd functions && npm test`
Expected: PASS，18 個案例全過

- [ ] **Step 5: Commit**

```bash
git add functions/src/message.ts functions/src/message.test.ts
git commit -m "Say what happened in one line"
```

---

### Task 4: Firestore 觸發器

把前三個任務的純函式串起來，加上 Firestore 讀取與 FCM 送出。

**Files:**
- Create: `functions/src/index.ts`

**Interfaces:**
- Consumes: `recipientIds()`（Task 2）、`expenseNotification()`（Task 3）
- Produces: 匯出的 Cloud Function `onExpenseCreated`

- [ ] **Step 1: 確認 Firestore 的區域**

Run: `npx firebase firestore:databases:list --project splitflow-e39c0`
Expected: 印出資料庫清單，其中有 `locationId`（例如 `asia-east1`）。
**記下那個值**，下一步的 `region` 要填一樣的 —— 跨區會讓每次觸發多一段延遲。

若指令不可用，到 Firebase Console 的 Firestore 頁面看「位置」。

- [ ] **Step 2: 寫觸發器**

`functions/src/index.ts`。**`<FIRESTORE_REGION>` 不是佔位符要你自己想** ——
換成 Step 1 實際查到的字串（例如 `asia-east1`）。查不到就不要往下做，
跨區部署會讓每次觸發多一段延遲，而且事後改要重佈。

```ts
/**
 * 有人新增支出時通知同任務的其他成員。
 *
 * 為什麼是 Firestore 觸發器而不是讓 client 寫完之後自己呼叫：
 *
 *   - client 可以說謊 —— 沒記帳也能叫別人的手機響
 *   - **離線記帳根本不會觸發** —— 排隊中的寫入是 Firestore SDK 之後自己
 *     送出的，那時 client 的程式碼早就沒在跑了
 */
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";

import { expenseNotification } from "./message.js";
import { recipientIds } from "./recipients.js";

initializeApp();

const db = getFirestore();

export const onExpenseCreated = onDocumentCreated(
  {
    document: "tasks/{taskId}/expenses/{expenseId}",
    region: "<FIRESTORE_REGION>"
  },
  async event => {
    const expense = event.data?.data();
    if (!expense) return;

    const taskId = event.params.taskId;
    const createdBy = (expense.createdBy as string | undefined) ?? "";

    const taskSnap = await db.doc(`tasks/${taskId}`).get();
    const task = taskSnap.data();
    if (!task) return;

    const targets = recipientIds((task.memberIds as string[]) ?? [], createdBy);
    // 一個人的任務不用通知任何人，直接結束 —— 不要白跑一趟查 token。
    if (targets.length === 0) return;

    // 記帳的人可能已經被移除，那時查不到 member 文件；文案那邊會退回「有人」。
    const authorSnap = await db.doc(`tasks/${taskId}/members/${createdBy}`).get();
    const author = (authorSnap.data()?.nickname as string | undefined) ?? "";

    const { title, body } = expenseNotification({
      taskName: (task.name as string | undefined) ?? "",
      author,
      expenseTitle: (expense.title as string | undefined) ?? "",
      amount: (expense.amount as number | undefined) ?? 0,
      currency: (expense.currency as string | undefined) ?? ""
    });

    // 虛擬成員沒有帳號就沒有 token 文件，這一步自然把他們過濾掉。
    const tokenDocs = await Promise.all(
      targets.map(uid => db.collection(`users/${uid}/tokens`).get())
    );
    const tokens = tokenDocs.flatMap(snap => snap.docs.map(doc => doc.id));
    if (tokens.length === 0) return;

    const response = await getMessaging().sendEachForMulticast({
      tokens,
      notification: { title, body },
      // 點通知要導到哪一個任務。notification 那邊只能放字串。
      data: { taskId }
    });

    // 死 token 不清的話會一直累積，每次推播都白送一次。
    const stale: string[] = [];
    response.responses.forEach((result, index) => {
      if (result.success) return;
      const code = result.error?.code;
      if (
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token"
      ) {
        stale.push(tokens[index]);
      } else {
        logger.warn("推播失敗", { code, taskId });
      }
    });

    if (stale.length === 0) return;

    // 只知道 token 不知道是誰的，用 collectionGroup 找回那些文件。
    const dead = await Promise.all(
      targets.map(uid =>
        db
          .collection(`users/${uid}/tokens`)
          .get()
          .then(snap => snap.docs.filter(doc => stale.includes(doc.id)))
      )
    );
    await Promise.all(dead.flat().map(doc => doc.ref.delete()));
  }
);
```

- [ ] **Step 3: 確認編譯得過**

Run: `cd functions && npm run build`
Expected: 沒有 TypeScript 錯誤，`functions/lib/` 產出 `.js`

- [ ] **Step 4: 確認測試沒被弄壞**

Run: `cd functions && npm test`
Expected: 18 個案例仍然全過

- [ ] **Step 5: Commit**

```bash
git add functions/src/index.ts
git commit -m "Tell the others when someone spends money"
```

---

### Task 5: Firestore 規則

**Files:**
- Modify: `firestore.rules`（`users/{uid}/favorites` 那一段附近）
- Test: `tests/firestore.rules.test.mjs`

**Interfaces:**
- Consumes: 無
- Produces: `users/{uid}/tokens/{token}` 只有本人能讀寫

- [ ] **Step 1: 寫規則測試**

`tests/firestore.rules.test.mjs`，接在收藏那一組測試後面
（`seed()`、`as()`、`anon()`、`test()` 都是檔案裡現成的）：

```js
  // --- 推播 token ---
  // 跟收藏一樣是純私人資料：別人不該知道你用哪台裝置，更不該寫得進你的名下。
  // Cloud Function 用 Admin SDK 讀，繞過規則，所以這裡可以鎖死成只有本人。
  const fcmToken = {
    platform: "android",
    updatedAt: serverTimestamp()
  };

  await test("可以寫入也讀得到自己的推播 token", async () => {
    await seed();
    const ref = doc(as(MEMBER), "users", MEMBER, "tokens", "token-abc");
    await assertSucceeds(setDoc(ref, fcmToken));
    await assertSucceeds(getDoc(ref));
    await assertSucceeds(deleteDoc(ref));
  });

  await test("推播 token 是私人的 —— 別人讀不到也列不出來", async () => {
    await seed();
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), "users", MEMBER, "tokens", "token-abc"), {
        platform: "android",
        updatedAt: new Date()
      });
    });
    await assertFails(getDoc(doc(as(OTHER), "users", MEMBER, "tokens", "token-abc")));
    await assertFails(getDocs(collection(as(OTHER), "users", MEMBER, "tokens")));
  });

  await test("不能把 token 寫進別人的帳號底下", async () => {
    await seed();
    await assertFails(
      setDoc(doc(as(OTHER), "users", MEMBER, "tokens", "token-xyz"), fcmToken)
    );
  });

  await test("不能刪別人的 token", async () => {
    await seed();
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), "users", MEMBER, "tokens", "token-abc"), {
        platform: "android",
        updatedAt: new Date()
      });
    });
    await assertFails(deleteDoc(doc(as(OTHER), "users", MEMBER, "tokens", "token-abc")));
  });

  await test("未登入完全不能碰 token", async () => {
    await seed();
    await assertFails(setDoc(doc(anon(), "users", MEMBER, "tokens", "t"), fcmToken));
    await assertFails(getDoc(doc(anon(), "users", MEMBER, "tokens", "t")));
  });
```

- [ ] **Step 2: 加規則**

`firestore.rules`，在 `match /users/{uid}/favorites/{favoriteId}` 那一段
**後面**加：

```
    /*
      這台裝置的推播 token。**純私人資料**，形狀跟收藏一樣的理由也一樣 ——
      別人不該知道你用哪台裝置，更不該寫得進你的名下。

      Cloud Function 用 Admin SDK 讀，繞過規則，所以這裡可以鎖死成只有本人。

      文件 ID 就是 token 本身：重新註冊時自動覆蓋（冪等），而 FCM 回報某個
      token 失效時函式手上正好有那串 token，直接刪那份文件就好。
    */
    match /users/{uid}/tokens/{token} {
      allow read, write: if isSelf(uid);
    }
```

- [ ] **Step 3: 括號平衡檢查**

Run:
```bash
node -e "const s=require('fs').readFileSync('firestore.rules','utf8');const n=c=>(s.split(c).length-1);console.log('{',n('{'),'}',n('}'),'(',n('('),')',n(')'))"
```
Expected: `{` 與 `}` 相等、`(` 與 `)` 相等

- [ ] **Step 4: 語法檢查測試檔**

Run: `node --check tests/firestore.rules.test.mjs`
Expected: 沒有輸出（語法正確）

- [ ] **Step 5: Commit**

```bash
git add firestore.rules tests/firestore.rules.test.mjs
git commit -m "Keep a device token to its owner"
```

- [ ] **Step 6: 部署前必須先驗**

⚠️ 本機跑不了規則測試（JDK 11，需要 21）。這條規則是**全新的子集合、不碰任何
既有規則**，風險比前兩次低，但仍要驗過再部署：

從 [Adoptium](https://adoptium.net) 下載 JDK 21 的 zip 解壓，設好 `JAVA_HOME`
後跑 `npm run test:rules`，確認新增的 5 個測試**以及既有的所有規則測試**都過。
驗過之後才 `npm run deploy:rules`。**這一步由使用者決定，不要自行部署。**

---

### Task 6: Flutter 的 token 註冊與清除

**Files:**
- Modify: `flutter_app/pubspec.yaml`（加 `firebase_messaging`）
- Create: `flutter_app/lib/data/push_repository.dart`
- Modify: `flutter_app/lib/state/providers.dart`（加 `pushRepositoryProvider`）
- Modify: `flutter_app/lib/data/auth_repository.dart`（`signOut` 之前刪 token）
- Modify: `flutter_app/android/app/src/main/AndroidManifest.xml`（通知權限）

**Interfaces:**
- Consumes: Task 5 的規則
- Produces:
  - `PushRepository.registerToken(String uid) -> Future<void>`
  - `PushRepository.removeToken(String uid) -> Future<void>`
  - `PushRepository.requestPermission() -> Future<bool>`
  - `PushRepository.onTokenRefresh() -> Stream<String>`
  - `pushRepositoryProvider`

- [ ] **Step 1: 加相依與權限**

`flutter_app/pubspec.yaml` 的 `dependencies` 加一行（放在其他 firebase 套件旁邊）：

```yaml
  firebase_messaging: ^15.1.3
```

`flutter_app/android/app/src/main/AndroidManifest.xml`，在既有的兩個
`uses-permission` 後面加：

```xml
    <!-- Android 13 起通知是 runtime permission。宣告在這裡只是讓系統認得，
         真正要不要跳對話框由程式決定 —— 見 PushRepository.requestPermission。 -->
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

- [ ] **Step 2: 寫 repository**

`flutter_app/lib/data/push_repository.dart`：

```dart
import 'package:firebase_messaging/firebase_messaging.dart';

import 'firestore_refs.dart';

/// 推播 token 的註冊與清除。
///
/// token 存在 `users/{uid}/tokens/{token}`，文件 ID 就是 token 本身 ——
/// 重新註冊時自動覆蓋（冪等），而伺服器端回報某個 token 失效時，
/// 那邊手上正好有那串 token，直接刪那份文件就好。
class PushRepository {
  FirebaseMessaging get _messaging => FirebaseMessaging.instance;

  /// 問使用者要不要接收通知。
  ///
  /// **不要在開 App 當下呼叫。** 那時使用者還不知道這 App 要幹嘛，直接按拒絕
  /// 的機率很高，而 Android 拒絕兩次之後就再也不會跳系統對話框 —— 一旦踩到，
  /// 那個人實務上等於永遠收不到通知。呼叫點在第一次進到某個任務時。
  Future<bool> requestPermission() async {
    final settings = await _messaging.requestPermission();
    return settings.authorizationStatus == AuthorizationStatus.authorized ||
        settings.authorizationStatus == AuthorizationStatus.provisional;
  }

  /// 把這台裝置的 token 寫進這個帳號底下。
  ///
  /// 拿不到 token 就安靜地什麼都不做 —— 沒有網路、或使用者拒絕了通知權限
  /// 都會是這個結果，那不該讓任何畫面失敗。
  Future<void> registerToken(String uid) async {
    final token = await _messaging.getToken();
    if (token == null) return;

    await usersRef.doc(uid).collection('tokens').doc(token).set({
      'platform': 'android',
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  /// token 會自己輪替，換新的就寫進去。
  ///
  /// 回傳的是可取消的訂閱：呼叫端負責在登出時停掉，不然換帳號之後舊的
  /// 監聽還會把新 token 寫進前一個人的名下。
  Stream<String> onTokenRefresh() => _messaging.onTokenRefresh;

  /// 刪掉這台裝置在這個帳號底下的 token。
  ///
  /// **登出時必須呼叫，而且要在 signOut() 之前。** 不刪的話，下一個在同一支
  /// 手機登入的人會收到前一個人的旅程通知 —— 那是真的隱私外洩。
  /// 順序也不能反：清掉 auth 之後 `isSelf(uid)` 就不成立，規則會擋下刪除。
  Future<void> removeToken(String uid) async {
    final token = await _messaging.getToken();
    if (token == null) return;
    await usersRef.doc(uid).collection('tokens').doc(token).delete();
  }
}
```

**注意**：`FieldValue` 來自 `cloud_firestore`。`firestore_refs.dart` 已經
import 了它，但這個檔案要自己加 `import 'package:cloud_firestore/cloud_firestore.dart';`
—— Dart 的 import 不會傳遞。

- [ ] **Step 3: 加 provider**

`flutter_app/lib/state/providers.dart`：頂端加
`import '../data/push_repository.dart';`，然後在
`final receiptRepositoryProvider = ...` 那一行後面加：

```dart

/// 推播。註冊 token、清除 token、問通知權限。
final pushRepositoryProvider = Provider((ref) => PushRepository());
```

- [ ] **Step 4: 登出時先刪 token**

`flutter_app/lib/data/auth_repository.dart` 的 `signOut()` 改成：

```dart
  /// 登出。
  ///
  /// [onBeforeSignOut] 在清掉 Firebase Auth **之前**跑，給推播 token 的清除
  /// 用。順序不能反：auth 清掉之後 `isSelf(uid)` 就不成立，規則會擋下刪除，
  /// 而留著會讓下一個在這支手機登入的人收到前一個人的通知。
  ///
  /// 清除失敗不該擋住登出 —— 使用者按了登出就是要離開，卡在那裡更糟。
  Future<void> signOut({Future<void> Function()? onBeforeSignOut}) async {
    if (onBeforeSignOut != null) {
      try {
        await onBeforeSignOut();
      } catch (_) {
        // 沒網路或 token 本來就不在 —— 都不該讓登出失敗。
      }
    }
    await GoogleSignIn.instance.signOut();
    await _auth.signOut();
  }
```

兩個呼叫端跟著改。`flutter_app/lib/ui/profile_page.dart:176`：

```dart
            final uid = ref.read(authStateProvider).value?.uid;
            await ref.read(authRepositoryProvider).signOut(
                  onBeforeSignOut: uid == null
                      ? null
                      : () => ref.read(pushRepositoryProvider).removeToken(uid),
                );
```

`flutter_app/lib/ui/onboarding_page.dart:160` 同樣改法。**兩個檔案都要
確認有 import `../state/providers.dart`**（應該都有，因為它們已經在用
`authRepositoryProvider`）。

- [ ] **Step 5: Commit（標明未驗證）**

```bash
git add flutter_app/pubspec.yaml flutter_app/lib/data/push_repository.dart flutter_app/lib/state/providers.dart flutter_app/lib/data/auth_repository.dart flutter_app/lib/ui/profile_page.dart flutter_app/lib/ui/onboarding_page.dart flutter_app/android/app/src/main/AndroidManifest.xml
git commit -m "Remember which device to ring, and forget it on the way out"
```

- [ ] **Step 6: 回家要驗的清單**

```bash
export ANDROID_HOME=/c/dev/android-sdk
export PATH="/c/dev/flutter/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
cd flutter_app && flutter pub get && dart analyze
```

Expected: `pub get` 拉得到 `firebase_messaging`，analyzer 乾淨。

---

### Task 7: Flutter 的權限詢問與導頁

**Files:**
- Create: `flutter_app/lib/state/pending_task.dart`
- Modify: `flutter_app/lib/main.dart`（啟動時接推播）
- Modify: `flutter_app/lib/ui/task_list_page.dart`（消費待處理的 taskId）
- Modify: `flutter_app/lib/ui/task_page.dart`（第一次進任務時問權限）

**Interfaces:**
- Consumes: `PushRepository.requestPermission()`、`registerToken()`、
  `onTokenRefresh()`、`pushRepositoryProvider`（都來自 Task 6）
- Produces: `pendingTaskIdProvider`（`StateProvider<String?>`，
  由 `main()` 與 `_RootState` 寫入、`TaskListPage` 消費）

- [ ] **Step 1: 建立待處理的 taskId provider**

`flutter_app/lib/state/pending_task.dart`：

```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// 「因為點了通知而要打開的任務」。
///
/// **不能在收到通知的當下就導頁。** `_Root` 有三段狀態判斷（沒登入 → 登入頁；
/// 登入但沒暱稱 → 取暱稱頁；都有了 → 任務列表），太早 push 會疊在登入頁上面，
/// 而那時使用者還沒登入、讀任務會被規則擋下。
///
/// 所以改成放在這裡等著：任務列表掛載之後才消費它並 push，消費完設回 null。
final pendingTaskIdProvider = StateProvider<String?>((ref) => null);
```

- [ ] **Step 2: 啟動時接推播**

`flutter_app/lib/main.dart`：頂端加

```dart
import 'package:firebase_messaging/firebase_messaging.dart';

import 'state/pending_task.dart';
```

`main()` 裡，在 `runApp` 之前加：

```dart
  // App 完全關閉時點通知，訊息會在這裡拿到 —— 之後的 onMessageOpenedApp
  // 不會再送一次，所以兩個都要接。
  String? pendingTaskId;
  if (error == null) {
    final initial = await FirebaseMessaging.instance.getInitialMessage();
    pendingTaskId = initial?.data['taskId'] as String?;
  }

  runApp(
    ProviderScope(
      overrides: [
        if (pendingTaskId != null)
          pendingTaskIdProvider.overrideWith((ref) => pendingTaskId),
      ],
      child: SplitFlowApp(initError: error),
    ),
  );
```

**注意**：原本的 `runApp(ProviderScope(child: SplitFlowApp(initError: error)));`
整行被上面這段取代。

- [ ] **Step 3: 背景點擊也寫進同一個 provider**

`flutter_app/lib/main.dart` 的 `_Root` 從 `ConsumerWidget` 改成
`ConsumerStatefulWidget`。**整個 class 換成下面這段** —— `build` 的內容
與原本完全相同，只是簽章從 `build(BuildContext, WidgetRef ref)` 變成
`build(BuildContext)`（`ConsumerState` 自己有 `ref` 成員）：

```dart
class _Root extends ConsumerStatefulWidget {
  const _Root();

  @override
  ConsumerState<_Root> createState() => _RootState();
}

class _RootState extends ConsumerState<_Root> {
  StreamSubscription<RemoteMessage>? _opened;
  StreamSubscription<String>? _refreshed;

  @override
  void initState() {
    super.initState();

    // App 還活著但在背景時點通知走這條。完全關閉那條在 main() 的
    // getInitialMessage —— 兩條都要接，它們不會互相補位。
    _opened = FirebaseMessaging.onMessageOpenedApp.listen((message) {
      final taskId = message.data['taskId'] as String?;
      if (taskId != null) {
        ref.read(pendingTaskIdProvider.notifier).state = taskId;
      }
    });

    // token 會自己輪替。不接的話換發之後伺服器手上那份就是死的，
    // 而使用者完全不會察覺 —— 只是再也收不到通知。
    _refreshed = ref.read(pushRepositoryProvider).onTokenRefresh().listen((_) {
      final uid = ref.read(authStateProvider).value?.uid;
      if (uid != null) ref.read(pushRepositoryProvider).registerToken(uid);
    });
  }

  @override
  void dispose() {
    _opened?.cancel();
    _refreshed?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authStateProvider);

    return auth.when(
      loading: () => const _Waiting(),
      error: (err, _) => _FatalPage(message: '登入狀態讀取失敗：$err'),
      data: (user) {
        if (user == null) return const SignInPage();

        final profile = ref.watch(userProfileProvider);
        return profile.when(
          // 讀資料的空檔不要先閃一下取暱稱頁 —— 那會讓每次開 App 都像
          // 第一次使用。
          loading: () => const _Waiting(),
          // 讀不到就當作還沒設定：真的沒有的話這一頁正好；只是網路不好的話，
          // 存的時候用的是 merge，不會洗掉既有資料。
          error: (err, _) => OnboardingPage(user: user),
          data: (value) => (value == null || value.nickname.trim().isEmpty)
              ? OnboardingPage(user: user)
              : const TaskListPage(),
        );
      },
    );
  }
}
```

**import 要補**：`dart:async`（`StreamSubscription`）。`RemoteMessage` 與
`FirebaseMessaging` 來自 Step 2 已經加的 `firebase_messaging`。

**前景收到通知刻意不做任何事。** `onMessage` 在 Android 上不會自動顯示
通知，而使用者正看著 App 時 Firestore 的 listener 已經讓畫面自己更新了 ——
再跳一個橫幅只是吵。

- [ ] **Step 4: 任務列表消費待處理的 taskId**

`flutter_app/lib/ui/task_list_page.dart`：頂端加
`import '../state/pending_task.dart';`，在 `_TaskListPageState` 加：

```dart
  @override
  void initState() {
    super.initState();
    // 走到這一頁代表登入狀態已經確定了，這時導頁才安全。
    // 用 addPostFrameCallback 是因為 initState 當下還不能 push。
    WidgetsBinding.instance.addPostFrameCallback((_) => _consumePendingTask());
  }

  /// 點通知帶進來的任務，開一次就消費掉。
  void _consumePendingTask() {
    final taskId = ref.read(pendingTaskIdProvider);
    if (taskId == null || !mounted) return;

    ref.read(pendingTaskIdProvider.notifier).state = null;
    Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => TaskPage(taskId: taskId)),
    );
  }
```

並在 `build` 裡加一個監聽，處理「App 已經在任務列表上時收到點擊」：

```dart
    ref.listen<String?>(pendingTaskIdProvider, (_, next) {
      if (next != null) _consumePendingTask();
    });
```

- [ ] **Step 5: 第一次進任務時問通知權限**

`flutter_app/lib/ui/task_page.dart`：頂端加
`import 'package:shared_preferences/shared_preferences.dart';`（`shared_preferences`
已經在 `pubspec.yaml` 裡）。在該頁的 state 加：

```dart
  /// 第一次進任務時問一次通知權限，問過就不再問。
  ///
  /// 不在開 App 當下問是因為那時使用者還不知道這 App 要幹嘛，直接按拒絕的
  /// 機率很高 —— 而 Android 拒絕兩次之後就再也不會跳系統對話框。走到這一頁
  /// 代表他已經在跟人分帳了，「有人記帳要不要通知你」是個看得懂的問題。
  Future<void> _askPushPermissionOnce() async {
    final prefs = await SharedPreferences.getInstance();
    if (prefs.getBool('asked_push_permission') == true) return;
    await prefs.setBool('asked_push_permission', true);

    final granted = await ref.read(pushRepositoryProvider).requestPermission();
    if (!granted) return;

    final uid = ref.read(authStateProvider).value?.uid;
    if (uid != null) await ref.read(pushRepositoryProvider).registerToken(uid);
  }
```

`_TaskPageState` **目前沒有 `initState`**，要新增一個。放在
`final Set<String> _collapsed = {};` 那一行後面：

```dart
  @override
  void initState() {
    super.initState();
    // 不 await —— 問權限不該擋住任務載入，而且對話框是系統畫的，
    // 跟這一頁的 build 沒有先後關係。
    _askPushPermissionOnce();
  }
```

`_TaskPageState` 已經是 `ConsumerState<TaskPage>`（`task_page.dart:32`），
所以 `ref` 直接可用，不用額外處理。

- [ ] **Step 6: Commit（標明未驗證）**

```bash
git add flutter_app/lib/state/pending_task.dart flutter_app/lib/main.dart flutter_app/lib/ui/task_list_page.dart flutter_app/lib/ui/task_page.dart
git commit -m "Open the trip the notification was about"
```

- [ ] **Step 7: 回家要驗的清單**

```bash
cd flutter_app && dart analyze && flutter run
```

Expected: analyzer 乾淨、App 起得來、第一次進任務會跳通知權限對話框。

---

## 收尾與實機驗證

前面的任務都做完之後：

- [ ] `cd functions && npm test && npm run build`
- [ ] `npm test && npm run check`（根目錄，確認沒被弄壞）
- [ ] `npm run test:rules`（**要有 JDK 21**）—— 特別確認既有的規則測試沒被弄壞
- [ ] `npm run deploy:rules`（**由使用者決定**）
- [ ] `npm run deploy:functions`（**由使用者決定**，要先部署規則）
- [ ] `cd flutter_app && dart analyze && flutter run`

**實機驗證需要兩台裝置**（或一台實機 + 一個模擬器），兩個帳號各登入一台：

1. A 記一筆 → **B 收到通知**，內容有任務名、A 的暱稱、項目、金額
2. A 記一筆 → **A 自己不會收到**
3. B 點通知 → 開到那個任務
4. **B 把 App 完全關掉**再點通知 → 一樣開到那個任務
5. B 登出 → A 再記一筆 → **B 這台不該再收到**
6. 拒絕通知權限 → App 其他功能完全正常，只是收不到通知
7. 金額格式跟 App 內顯示的**逐字相同**

文件更新：

- [ ] `todo.md` 加一段「已完成：新增支出推播通知（Android）」，註明
      **iOS 沒做**與原因、**金額格式化是第三份副本**這個已知負債
- [ ] `flutter_app/README.md` 的「已經搬過來的」清單加 `push_repository.dart`
- [ ] `flutter_app/README.md` 的「範圍」那節補一句：推播是原生獨有，網頁版不做
