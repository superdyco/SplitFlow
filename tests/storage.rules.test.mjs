/**
 * Cloud Storage Security Rules 測試。
 *
 * 跑法：npm run test:rules（會連 firestore 與 storage 兩個 emulator）
 * 需要 JDK 21 以上 —— firebase-tools 不再支援更舊的版本。
 */
import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";

const PROJECT_ID = "demo-splitflow";
const MEMBER = "uid_member";
const PATH = "tasks/task1/expenses/e1/receipt.jpg";
const MAP_PATH = "tasks/task1/reports/report1/map.png";

let testEnv;
let passed = 0;
let failed = 0;

function as(uid) {
  return testEnv.authenticatedContext(uid).storage();
}

function anon() {
  return testEnv.unauthenticatedContext().storage();
}

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL ${name}\n     ${err.message}`);
  }
}

/** 假的 JPEG：內容不重要，規則只看 size 與 contentType。 */
function jpeg(bytes = 1024) {
  return new Uint8Array(bytes);
}

const JPEG = { contentType: "image/jpeg" };
const PNG = { contentType: "image/png" };

async function main() {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    storage: { rules: readFileSync("storage.rules", "utf8"), host: "127.0.0.1", port: 9199 }
  });

  await test("登入的使用者可以上傳收據", async () => {
    await assertSucceeds(uploadBytes(ref(as(MEMBER), PATH), jpeg(), JPEG));
  });

  await test("沒登入不能上傳", async () => {
    await assertFails(uploadBytes(ref(anon(), PATH), jpeg(), JPEG));
  });

  await test("沒登入不能讀", async () => {
    await assertFails(getDownloadURL(ref(anon(), PATH)));
  });

  await test("超過 2MB 的檔案要被擋 —— 免得有人繞過前端把額度吃光", async () => {
    await assertFails(uploadBytes(ref(as(MEMBER), PATH), jpeg(2 * 1024 * 1024 + 1), JPEG));
  });

  await test("非 JPEG 的檔案要被擋", async () => {
    await assertFails(
      uploadBytes(ref(as(MEMBER), PATH), jpeg(), { contentType: "application/pdf" })
    );
  });

  await test("換照片是覆蓋同一個路徑，要放行", async () => {
    await assertSucceeds(uploadBytes(ref(as(MEMBER), PATH), jpeg(2048), JPEG));
  });

  await test("移除收據時刪得掉", async () => {
    await assertSucceeds(deleteObject(ref(as(MEMBER), PATH)));
  });

  await test("規則沒開的路徑一律擋住", async () => {
    await assertFails(uploadBytes(ref(as(MEMBER), "random/other.jpg"), jpeg(), JPEG));
  });

  // --- 旅費報告的地圖 ---
  await test("報告地圖登入後傳得上去", async () => {
    await assertSucceeds(uploadBytes(ref(as(MEMBER), MAP_PATH), jpeg(2048), PNG));
  });

  // 這條是整個公開報告功能的前提 —— 讀不到圖，報告頁就是壞的。
  await test("報告地圖未登入也讀得到 —— 公開報告的前提", async () => {
    await assertSucceeds(getDownloadURL(ref(anon(), MAP_PATH)));
  });

  await test("報告地圖不接受非 PNG", async () => {
    await assertFails(uploadBytes(ref(as(MEMBER), MAP_PATH), jpeg(2048), JPEG));
  });

  await test("報告地圖超過 1MB 要被擋", async () => {
    await assertFails(uploadBytes(ref(as(MEMBER), MAP_PATH), jpeg(1024 * 1024 + 1), PNG));
  });

  await test("未登入不能上傳報告地圖", async () => {
    await assertFails(uploadBytes(ref(anon(), MAP_PATH), jpeg(2048), PNG));
  });

  await testEnv.cleanup();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
