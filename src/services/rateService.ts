/**
 * 匯率來源：open.er-api.com，免費且不需要 API key。
 *
 * 匯率只在記帳當下抓一次，換算結果會寫進支出文件，之後結算不再重抓。
 * 分帳記的是已經發生的事，金額不該因為今天匯率變了就跟著變。
 */
const ENDPOINT = "https://open.er-api.com/v6/latest";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

interface RateTable {
  /** 1 單位 base 幣別等於多少該幣別。 */
  rates: Record<string, number>;
  updatedAt: string;
  fetchedAt: number;
}

const memoryCache = new Map<string, RateTable>();

function storageKey(base: string) {
  return `splitflow:rates:${base}`;
}

function readCache(base: string): RateTable | null {
  const cached = memoryCache.get(base);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached;

  try {
    const raw = window.sessionStorage.getItem(storageKey(base));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RateTable;
    if (Date.now() - parsed.fetchedAt >= CACHE_TTL_MS) return null;
    memoryCache.set(base, parsed);
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(base: string, table: RateTable) {
  memoryCache.set(base, table);
  try {
    window.sessionStorage.setItem(storageKey(base), JSON.stringify(table));
  } catch {
    // sessionStorage 滿了或被關掉都不影響功能，記憶體快取還在。
  }
}

async function fetchTable(base: string): Promise<RateTable> {
  const cached = readCache(base);
  if (cached) return cached;

  const response = await fetch(`${ENDPOINT}/${encodeURIComponent(base)}`);
  if (!response.ok) throw new Error(`匯率服務回應 ${response.status}`);

  const payload = await response.json();
  if (payload.result !== "success" || !payload.rates) {
    throw new Error(payload["error-type"] || "匯率服務沒有回傳資料");
  }

  const table: RateTable = {
    rates: payload.rates,
    updatedAt: payload.time_last_update_utc || "",
    fetchedAt: Date.now()
  };
  writeCache(base, table);
  return table;
}

export interface RateQuote {
  /** 1 單位 from 幣別等於多少 to 幣別。 */
  rate: number;
  updatedAt: string;
}

export async function getRate(from: string, to: string): Promise<RateQuote> {
  if (from === to) return { rate: 1, updatedAt: "" };

  // 用 to 當 base 拿到的是「1 to 等於多少 from」，取倒數才是我們要的方向。
  const table = await fetchTable(to);
  const inverse = table.rates[from];
  if (!inverse || inverse <= 0) throw new Error(`匯率服務沒有 ${from} 的資料`);

  return { rate: 1 / inverse, updatedAt: table.updatedAt };
}
