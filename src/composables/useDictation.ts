import { onBeforeUnmount, ref, type Ref } from "vue";

/**
 * 語音輸入，包在 Web Speech API 外面。
 *
 * 這個 API 到現在還掛著 `webkit` 前綴（Safari 與 Chrome 都是），而且沒有進
 * TypeScript 的 lib.dom，所以型別在下面自己宣告一份最小的 —— 只寫我們用到的部分，
 * 名字也刻意不叫 SpeechRecognition，免得哪天標準型別進了 lib.dom 撞在一起。
 *
 * 辨識是送到瀏覽器廠商的伺服器做的（不是在裝置上），所以：
 *   - 要安全來源（HTTPS 或 localhost），跟定位一樣
 *   - 要網路，離線時會直接吐 network 錯誤
 * 這兩件事都反映在 `error` 的訊息裡，因為使用者只會看到「按了沒反應」。
 */

/** 只宣告我們用得到的部分。 */
interface Recognizer {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: RecognizerEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

interface RecognizerEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}

type RecognizerCtor = new () => Recognizer;

function recognizerCtor(): RecognizerCtor | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as Record<string, RecognizerCtor | undefined>;
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

/**
 * 中文語音辨識很愛在句尾補標點（「晚餐。」），但支出名稱不需要。
 * 只削尾巴，中間的標點是使用者真的講出來的，留著。
 */
function tidy(text: string): string {
  return text.trim().replace(/[。、，．.,！!？?\s]+$/u, "");
}

function messageFor(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return window.isSecureContext
        ? "沒有麥克風權限，可以在網址列的權限設定裡改回來。"
        : "這個網址不是 HTTPS，瀏覽器不給用麥克風。請用正式網址或 localhost 開啟。";
    case "no-speech":
      return "沒有聽到聲音，再試一次。";
    case "audio-capture":
      return "找不到麥克風。";
    case "network":
      return "語音辨識需要連線，目前連不上。";
    case "aborted":
      // 使用者自己按停的，不是錯誤。
      return "";
    default:
      return `語音輸入失敗（${code}）`;
  }
}

export function useDictation(
  onText: (text: string) => void,
  lang = "zh-TW"
): {
  available: boolean;
  listening: Ref<boolean>;
  error: Ref<string | null>;
  toggle: () => void;
} {
  const ctor = recognizerCtor();
  const listening = ref(false);
  const error = ref<string | null>(null);
  let recognizer: Recognizer | null = null;

  function start() {
    if (!ctor) return;
    error.value = null;

    const instance = new ctor();
    instance.lang = lang;
    // 一次講一句就好：支出名稱是短句，continuous 會讓它一直等下一句不肯停。
    instance.continuous = false;
    // 只要最後定案的結果。中途的猜測會在欄位裡跳來跳去，看了很慌。
    instance.interimResults = false;
    instance.maxAlternatives = 1;

    instance.onresult = event => {
      const text = tidy(event.results[0]?.[0]?.transcript ?? "");
      if (text) onText(text);
    };
    instance.onerror = event => {
      const message = messageFor(event.error);
      if (message) error.value = message;
    };
    // 不管是講完了、逾時、還是出錯，最後都會走到 onend，狀態統一在這裡收。
    instance.onend = () => {
      listening.value = false;
      recognizer = null;
    };

    recognizer = instance;
    listening.value = true;
    try {
      instance.start();
    } catch (err) {
      // 連續快速按兩下會拋 InvalidStateError，那不是使用者需要知道的事。
      listening.value = false;
      recognizer = null;
      if (!(err instanceof DOMException)) throw err;
    }
  }

  function toggle() {
    if (listening.value) recognizer?.stop();
    else start();
  }

  // 離開頁面時要收掉，不然麥克風會繼續開著。
  onBeforeUnmount(() => recognizer?.abort());

  return { available: !!ctor, listening, error, toggle };
}
