<script setup lang="ts">
import { computed } from "vue";
import type { ExpenseWeather } from "@/types/weather";
import { WEATHER_LABELS, weatherColor, weatherKind } from "@/types/weather";

const props = withDefaults(
  defineProps<{
    weather: ExpenseWeather;
    /**
     * `chip` 是表單裡的那一格 —— 你剛選完地點，這是動作的回饋，要看得見。
     * `inline` 是列表與報告上的一行小字，不該搶走分類圖示的注意力。
     */
    variant?: "chip" | "inline";
    /** 顯示天氣名稱。小尺寸下兩個字比圖示好認，但列表那一行已經很擠。 */
    showLabel?: boolean;
  }>(),
  { variant: "inline", showLabel: false }
);

const kind = computed(() => weatherKind(props.weather.code));
const label = computed(() => WEATHER_LABELS[kind.value]);
const color = computed(() => weatherColor(kind.value));

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

const iconSize = computed(() => (props.variant === "chip" ? 22 : 14));
</script>

<template>
  <span class="weather" :class="variant" :style="{ '--w': color }" :title="`${label} ${temp}`">
    <!--
      inline SVG 不是 emoji：emoji 在不同系統上長得不一樣，而且吃不到顏色。
      八組各一個圖示，用 stroke 畫在 24 網格上。
    -->
    <svg
      viewBox="0 0 24 24"
      :width="iconSize"
      :height="iconSize"
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
    <span v-if="showLabel" class="name">{{ label }}</span>
    <span class="temp num">{{ temp }}</span>
  </span>
</template>

<style scoped>
.weather {
  display: inline-flex;
  align-items: center;
  color: var(--w);
}

/*
  列表與報告上的一行小字。溫度用 muted 而不是天氣色：那一行旁邊還有地點與
  金額，整串都上色會變成三種顏色搶同一列。有顏色的只有圖示。
*/
.weather.inline {
  gap: 4px;
  font-size: var(--text-tiny);
}

.weather.inline .temp {
  color: var(--color-muted);
}

/*
  表單裡的那一格。跟旁邊的定位鍵同高同框 —— 使用者剛選完地點，
  這是那個動作的回饋，跟它並排才看得出是同一件事的兩半。
*/
.weather.chip {
  flex: none;
  gap: var(--space-2);
  min-height: 52px;
  padding: 0 14px;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-md);
  background: #fff;
  font-size: var(--text-control);
}

.weather.chip .name {
  color: var(--color-ink);
}

.weather.chip .temp {
  font-weight: 700;
  color: var(--color-ink);
}
</style>
