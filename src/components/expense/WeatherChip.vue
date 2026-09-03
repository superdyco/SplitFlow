<script setup lang="ts">
import { computed } from "vue";
import type { ExpenseWeather } from "@/types/weather";
import { weatherKind } from "@/types/weather";

const props = defineProps<{ weather: ExpenseWeather }>();

const kind = computed(() => weatherKind(props.weather.code));

/**
 * 有 exact 就印單一溫度，沒有就印當日高低。
 *
 * 這不只是格式差異 —— 它讓畫面看得出這筆支出有沒有記時間，
 * 而且不假裝出沒有的精度。
 */
const temp = computed(() =>
  props.weather.exact === null
    ? `${props.weather.low}–${props.weather.high}°`
    : `${props.weather.exact}°`
);
</script>

<template>
  <span class="weather">
    <!--
      inline SVG 不是 emoji：emoji 在不同系統上長得不一樣，而且吃不到
      currentColor。八組各一個圖示，用 stroke 畫在 24 網格上。
    -->
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <template v-if="kind === 'clear'">
        <circle cx="12" cy="12" r="4" />
        <path
          d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
        />
      </template>
      <template v-else-if="kind === 'cloudy'">
        <circle cx="8" cy="8" r="3" />
        <path d="M17 19H8a4 4 0 0 1 0-8 5 5 0 0 1 9.6 1.3A3.4 3.4 0 0 1 17 19z" />
      </template>
      <template v-else-if="kind === 'overcast'">
        <path d="M16 17H7a4 4 0 0 1 0-8 5 5 0 0 1 9.6 1.3A3.4 3.4 0 0 1 16 17z" />
        <path d="M9 20h9" />
      </template>
      <template v-else-if="kind === 'fog'">
        <path d="M16 13H7a4 4 0 0 1 0-8 5 5 0 0 1 9.6 1.3A3.4 3.4 0 0 1 16 13z" />
        <path d="M5 17h14M7 21h11" />
      </template>
      <template v-else-if="kind === 'drizzle'">
        <path d="M16 14H7a4 4 0 0 1 0-8 5 5 0 0 1 9.6 1.3A3.4 3.4 0 0 1 16 14z" />
        <path d="M9 18v1M13 18v1M17 18v1" />
      </template>
      <template v-else-if="kind === 'rain'">
        <path d="M16 13H7a4 4 0 0 1 0-8 5 5 0 0 1 9.6 1.3A3.4 3.4 0 0 1 16 13z" />
        <path d="M8 17l-1 4M12 17l-1 4M16 17l-1 4" />
      </template>
      <template v-else-if="kind === 'snow'">
        <path d="M16 13H7a4 4 0 0 1 0-8 5 5 0 0 1 9.6 1.3A3.4 3.4 0 0 1 16 13z" />
        <path d="M8 18h.01M12 20h.01M16 18h.01" />
      </template>
      <template v-else>
        <path d="M16 12H7a4 4 0 0 1 0-8 5 5 0 0 1 9.6 1.3A3.4 3.4 0 0 1 16 12z" />
        <path d="M13 15l-3 4h4l-3 5" />
      </template>
    </svg>
    <span>{{ temp }}</span>
  </span>
</template>

<style scoped>
.weather {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--color-muted);
  font-size: var(--text-tiny);
}
</style>
