/**
 * 動態載入 Maps JavaScript API。
 *
 * 用 script 標籤而不是 npm 套件，地圖程式碼才不會進主 bundle —— 沒開地圖的人不用付這個成本。
 * 只會載入一次，之後重複呼叫拿到同一個 promise。
 *
 * 需要 `VITE_GOOGLE_MAPS_API_KEY`，一樣會出現在前端原始碼裡，記得設 HTTP referrer 限制。
 */
const CALLBACK_NAME = "__splitflowMapsReady";
const LANGUAGE = "zh-TW";

let loadPromise: Promise<typeof google.maps> | null = null;

export function mapsEnabled(): boolean {
  return !!import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
}

export function loadMaps(): Promise<typeof google.maps> {
  if (loadPromise) return loadPromise;

  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!key) return Promise.reject(new Error("沒有設定地圖服務金鑰"));

  loadPromise = new Promise<typeof google.maps>((resolve, reject) => {
    const globalScope = window as unknown as Record<string, unknown>;

    globalScope[CALLBACK_NAME] = () => {
      delete globalScope[CALLBACK_NAME];
      resolve(google.maps);
    };

    const script = document.createElement("script");
    const params = new URLSearchParams({
      key,
      language: LANGUAGE,
      loading: "async",
      callback: CALLBACK_NAME
    });
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.async = true;
    script.onerror = () => {
      delete globalScope[CALLBACK_NAME];
      // 失敗就把 promise 清掉，使用者按重試才有機會重新載入。
      loadPromise = null;
      reject(new Error("地圖載入失敗，請確認金鑰是否允許目前的網域"));
    };

    document.head.appendChild(script);
  });

  return loadPromise;
}
