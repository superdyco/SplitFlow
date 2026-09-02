<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ExpensePlace } from "@/types/expense";
import { currentPlace, shouldSearchPlace } from "@/utils/placeSearch";
import {
  autocompletePlaces,
  getPlaceDetails,
  newSessionToken,
  placesEnabled,
  recallPlaceBias,
  rememberPlaceBias,
  type PlaceSuggestion
} from "@/services/placeService";
import { geolocationAvailable, getCurrentLatLng } from "@/services/geolocation";
import { biasFromPlaces, type LatLng } from "@/utils/placeBias";
import { mapsEnabled } from "@/services/mapsLoader";
import PlaceMap, { type MapMarker } from "@/components/map/PlaceMap.vue";

/** `taskId` 是位置偏好（recallPlaceBias / rememberPlaceBias）需要的。 */
const props = defineProps<{ taskId: string }>();
const place = defineModel<ExpensePlace | null>({ required: true });

/*
  初始值只讀一次，之後單向往外送 —— 跟 Flutter 版（lib/ui/place_field.dart）
  的 initial + onChanged 是同一個約定。不 watch model：使用者打字會 emit，
  emit 讓母元件更新，更新又觸發 watch 改回 placeQuery，那是一個環。

  只讀一次是安全的，因為母元件在 loading 為 false 之前就把地點設好了
  （load() 與 applyRepeatSource() 都是），這個元件掛載時已經有值。
*/
const placeQuery = ref(place.value?.name ?? "");
const selectedPlace = ref<ExpensePlace | null>(place.value);

const suggestions = ref<PlaceSuggestion[]>([]);
const placeLoading = ref(false);
const locating = ref(false);
const placeError = ref<string | null>(null);
const placeSearchable = placesEnabled();

/** 按下定位鍵抓到的座標。只用來在地圖上標出「你在這」，不會存進支出裡。 */
const myLocation = ref<LatLng | null>(null);

/**
 * 搜尋的位置偏好。沒有它的話「星巴克」會回傳全世界的分店 ——
 * 人在曼谷卻搜到台北那間。第一筆支出還沒有參考點，就退回原本的全球搜尋。
 *
 * 編輯既有支出時，它自己的座標比 localStorage 裡那個更能代表要找的區域，
 * 所以初始地點優先。
 */
const placeBias = ref<LatLng | null>(
  biasFromPlaces([place.value]) ?? recallPlaceBias(props.taskId)
);

const mapAvailable = mapsEnabled();

/**
 * 定位鍵的用途就是把「你在這」畫在下面那張地圖上，沒有地圖金鑰就沒有地圖可畫，
 * 按了不會有任何反應 —— 那種按鈕不如不要出現。
 */
const canLocate = mapAvailable && geolocationAvailable();

let placeSession = newSessionToken();
let placeTimer: number | undefined;

/**
 * 地圖上永遠只有一個標記，而且選好的地點優先。
 *
 * 定位只是還沒決定地點時的參考 —— 一旦選了店，地圖要標的就是那家店。
 * 兩個一起畫的話，地圖上兩顆紅點誰是誰看不出來，存進支出的又只有其中一個。
 *
 * 目前位置是「隱藏」不是「清掉」：把地點欄位清空或改字之後，
 * 那個參考點會自己回來，不用再按一次定位。
 * 只打名字沒選建議的地點沒有座標，畫不出來，那時也是回頭標目前位置。
 */
const placeMarkers = computed<MapMarker[]>(() => {
  const picked = selectedPlace.value;
  if (picked && picked.lat !== null && picked.lng !== null) {
    return [{ id: picked.placeId ?? "place", lat: picked.lat, lng: picked.lng, title: picked.name }];
  }
  const here = myLocation.value;
  return here ? [{ id: "me", lat: here.lat, lng: here.lng, title: "你目前的位置" }] : [];
});

/**
 * 這一格的值只有一個真相來源：輸入的字加上選過的那一份建議。
 * 兩者任一改變就往上送 —— 母元件不需要知道這裡面有九個 ref。
 */
watch([placeQuery, selectedPlace], () => {
  place.value = currentPlace(placeQuery.value, selectedPlace.value);
});

function onPlaceInput(value: string) {
  placeQuery.value = value;
  // 一改字就作廢選過的建議：改過的名字已經不是那個地點了，座標必須跟著丟掉。
  selectedPlace.value = null;
  placeError.value = null;
  if (!placeSearchable) return;

  window.clearTimeout(placeTimer);
  if (!shouldSearchPlace(value)) {
    suggestions.value = [];
    return;
  }
  // 每打一個字就打一次 API 太浪費，等使用者停下來再查。
  placeTimer = window.setTimeout(searchPlaces, 350);
}

async function searchPlaces() {
  placeLoading.value = true;
  placeError.value = null;
  try {
    suggestions.value = await autocompletePlaces(placeQuery.value, placeSession, placeBias.value);
  } catch (err) {
    suggestions.value = [];
    placeError.value = err instanceof Error ? err.message : String(err);
  } finally {
    placeLoading.value = false;
  }
}

async function pickPlace(suggestion: PlaceSuggestion) {
  placeLoading.value = true;
  placeError.value = null;
  try {
    const detail = await getPlaceDetails(suggestion.placeId, placeSession);
    selectedPlace.value = detail;
    placeQuery.value = detail.name;
    suggestions.value = [];
    // 這個任務接下來的搜尋就以這裡為中心。選到沒有座標的地點時保留原本的偏好。
    rememberPlaceBias(props.taskId, detail);
    placeBias.value = biasFromPlaces([detail]) ?? placeBias.value;
    // 一次 autocomplete + details 算一個 session，選完就換新的。
    placeSession = newSessionToken();
  } catch (err) {
    placeError.value = err instanceof Error ? err.message : String(err);
  } finally {
    placeLoading.value = false;
  }
}

/**
 * 定位鍵：抓現在的座標，標在下面那張地圖上。
 *
 * 定位抓到的座標不會存進支出。那顆鍵只回答「我在哪」，不去猜你人在哪家店 ——
 * 它只做兩件事：換掉搜尋的位置偏好，以及在還沒選地點時讓地圖有東西可以顯示。
 *
 * 順帶把偏好換成這裡：人就在這，比上一筆支出的座標更準，
 * 而且這是 autocomplete 請求上的一個欄位，不會多花錢。
 */
async function useCurrentLocation() {
  locating.value = true;
  placeError.value = null;
  try {
    const here = await getCurrentLatLng();
    myLocation.value = here;
    placeBias.value = here;
  } catch (err) {
    placeError.value = err instanceof Error ? err.message : String(err);
  } finally {
    locating.value = false;
  }
}

function clearPlace() {
  window.clearTimeout(placeTimer);
  placeQuery.value = "";
  selectedPlace.value = null;
  suggestions.value = [];
  placeError.value = null;
  // 目前位置不清掉：那是「我在哪」，跟這一格填了什麼地點無關。
}
</script>

<template>
  <div class="field">
    <div class="spread">
      <span class="label">地點（選填）</span>
      <button v-if="placeQuery" type="button" class="link" @click="clearPlace">清除</button>
    </div>
    <div class="place">
      <div class="row">
        <input
          :value="placeQuery"
          class="input grow"
          :placeholder="placeSearchable ? '輸入店名或地址，從清單選一個' : '輸入地點名稱'"
          autocomplete="off"
          @input="onPlaceInput(($event.target as HTMLInputElement).value)"
        />
        <!--
          只有一個圖示，所以 aria-label 是它唯一的名字，不能省。
          title 讓滑鼠停著也看得到說明。
        -->
        <button
          v-if="canLocate"
          type="button"
          class="btn icon-btn"
          :class="{ working: locating }"
          :disabled="locating"
          aria-label="標出我目前的位置"
          title="標出我目前的位置"
          @click="useCurrentLocation"
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
            <circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width="2" />
            <circle cx="12" cy="12" r="2.5" fill="currentColor" />
            <path
              d="M12 1.5v3.5M12 19v3.5M1.5 12h3.5M19 12h3.5"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </div>
      <ul v-if="suggestions.length" class="suggestions">
        <li v-for="item in suggestions" :key="item.placeId">
          <button type="button" class="suggestion" @click="pickPlace(item)">
            <strong>{{ item.primary }}</strong>
            <span v-if="item.secondary" class="tiny">{{ item.secondary }}</span>
          </button>
        </li>
      </ul>
    </div>
    <span v-if="locating" class="tiny">正在取得目前位置...</span>
    <span v-else-if="placeLoading" class="tiny">搜尋中...</span>
    <span v-else-if="placeError" class="tiny warn">{{ placeError }}</span>
    <span v-else-if="selectedPlace?.address" class="tiny">{{ selectedPlace.address }}</span>
    <span v-else-if="!placeSearchable" class="tiny">
      沒有設定地點服務金鑰，目前只會存你打的名稱，不會有地址與座標。
    </span>
    <!--
      180px。規格本來要壓成 120px（理由是這張圖只用來「確認選對地方了」，
      不是拿來看的），實際做出來太扁 —— 圖釘周邊能認出「是不是這條街」的
      資訊少一截，而省下的 60px 相對於這次三張卡與固定送出列省下的捲動
      距離佔比很小。收益換不到代價，維持原本的高度。
    -->
    <PlaceMap v-if="mapAvailable && placeMarkers.length" :markers="placeMarkers" height="180px" />
  </div>
</template>

<style scoped>
.grow {
  flex: 1;
  min-width: 0;
}

.row {
  align-items: flex-start;
  flex-wrap: wrap;
}

.place {
  position: relative;
}

.link {
  border: 0;
  background: none;
  padding: 0;
  color: var(--color-primary-dark);
  font-size: var(--text-tiny);
  font-weight: 700;
}

/* 只有圖示的方形按鈕（定位），高度對齊旁邊的輸入框（.input 是 52px）。 */
.icon-btn {
  flex: none;
  width: 52px;
  min-height: 52px;
  padding: 0;
  color: var(--color-primary-dark);
}

/*
  進行中的回饋：這種按鈕上沒有文字可以改成「定位中...」，只好讓圖示自己動。
  抓 GPS 動輒好幾秒，沒有任何動靜的話會被當成沒反應而一直重按。
*/
.icon-btn.working {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
}

.icon-btn.working svg {
  animation: icon-pulse 1s ease-in-out infinite;
}

@keyframes icon-pulse {
  50% {
    opacity: 0.25;
  }
}

/* 會暈車的人不需要這個提示，顏色的變化已經說明狀態了。 */
@media (prefers-reduced-motion: reduce) {
  .icon-btn.working svg {
    animation: none;
  }
}

.suggestions {
  position: absolute;
  z-index: 5;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  margin: 0;
  padding: 6px;
  list-style: none;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-md);
  background: var(--color-card);
  box-shadow: var(--shadow-pop);
  max-height: 260px;
  overflow-y: auto;
}

.suggestion {
  display: flex;
  flex-direction: column;
  gap: var(--space-text);
  width: 100%;
  padding: 10px 12px;
  border: 0;
  border-radius: var(--radius-md);
  background: none;
  text-align: left;
}

.suggestion:hover {
  background: var(--color-primary-soft);
}

.suggestion .tiny {
  line-height: 1.4;
}

.warn {
  color: var(--color-danger);
}
</style>
