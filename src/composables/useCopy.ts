import { ref, type Ref } from "vue";

/**
 * 複製文字到剪貼簿，並在按鈕上留一小段「已複製」的回饋。
 *
 * `navigator.clipboard` 在非安全來源、或使用者拒絕權限時會拋錯。
 * 這裡把錯誤收進 `error` 而不是往外冒，複製失敗不該讓整個結算頁爆掉。
 */
export function useCopy(resetMs = 2000): {
  copied: Ref<boolean>;
  error: Ref<string | null>;
  copy: (text: string) => Promise<void>;
} {
  const copied = ref(false);
  const error = ref<string | null>(null);
  let timer: number | undefined;

  async function copy(text: string) {
    error.value = null;
    try {
      await navigator.clipboard.writeText(text);
      copied.value = true;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => (copied.value = false), resetMs);
    } catch {
      copied.value = false;
      error.value = "複製失敗，請手動選取文字";
    }
  }

  return { copied, error, copy };
}
