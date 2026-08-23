import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router";
import { logError } from "./utils/debugLog";
import { watchVisibility } from "./utils/visibility";
import { runStorageProbe } from "./utils/storageProbe";
import "./assets/styles.css";

const app = createApp(App);

/*
  預期外的錯誤只寫進錯誤清單，不彈任何 UI。

  這三個入口抓到的東西，照定義就是沒人接住的錯誤 —— 對使用者說不出有用的話，
  彈一個他看不懂的紅字只會把畫面弄壞。有話可講的錯誤，各自的 catch 已經在講了
  （那些走 firebaseErrorMessage，一樣會進清單）。

  Vue 的 errorHandler 一旦覆寫，它預設會做的 console 輸出就沒了，所以自己補一次；
  開發時那條堆疊仍然是最快的線索。
*/
app.config.errorHandler = (err, _instance, info) => {
  logError(`vue ${info}`, err);
  console.error(err);
};

// event.error 在跨來源的 script 錯誤會是 null，那時退回只有訊息的版本。
window.addEventListener("error", event => logError("window", event.error ?? event.message));
window.addEventListener("unhandledrejection", event => logError("promise", event.reason));

// 要在第一次導航之前就開始聽，不然第一次進背景的時間會漏掉。
watchVisibility();

// 排在 idle，量完之後每一筆效能樣本都會帶上。見 storageProbe.ts 的說明。
runStorageProbe();

app.use(createPinia()).use(router).mount("#app");
