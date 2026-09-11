<script setup lang="ts">
/**
 * 可以打字搜尋的幣別選單。
 *
 * 原生 `<select>` 在 20 種幣別時不好找：電腦上只能打代碼開頭跳過去，手機上
 * 完全不能打字、只能滑。這裡打「US」「美元」「美國」都找得到 USD。
 *
 * 行為照 ARIA combobox：上下鍵移動、Enter 選定、Esc 關閉，選項的文字直接
 * 來自寫死的幣別清單，不經過 innerHTML。
 */
import { computed, nextTick, ref, watch } from "vue";
import { currencyLabel, searchCurrencies } from "@/utils/currency";

const props = defineProps<{
  modelValue: string;
  /** 置頂的幣別，通常是任務的主要幣別。 */
  pinned?: string;
  /** 欄位窄的時候，關起來只顯示代碼；打開的清單仍然是「代碼 中文」。 */
  compact?: boolean;
}>();

const emit = defineEmits<{ (e: "update:modelValue", value: string): void }>();

/** 同一頁可能有兩個選單，id 要各自獨立 aria-controls 才指得對。 */
const uid = `currency-${Math.random().toString(36).slice(2, 8)}`;
const open = ref(false);
const query = ref("");
const active = ref(0);

const results = computed(() => searchCurrencies(query.value, props.pinned));
const display = computed(() => (props.compact ? props.modelValue : currencyLabel(props.modelValue)));

/**
 * 輸入框在關起來時顯示目前選的幣別，打開時是搜尋字串。
 * 一開始打字就是在搜尋 —— 不必先清掉原本的字。
 */
const text = computed({
  get: () => (open.value ? query.value : display.value),
  set: value => {
    query.value = value;
    active.value = 0;
    open.value = true;
  }
});

function openList() {
  if (open.value) return;
  query.value = "";
  open.value = true;
  // 打開時停在目前選的那一個，按 Enter 不會意外換掉。
  active.value = Math.max(0, results.value.findIndex(item => item.code === props.modelValue));
}

function close() {
  open.value = false;
  query.value = "";
}

function choose(code: string) {
  emit("update:modelValue", code);
  close();
}

function onKeydown(event: KeyboardEvent) {
  if (!open.value) {
    if (event.key === "ArrowDown" || event.key === "Enter") {
      event.preventDefault();
      openList();
    }
    return;
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    active.value = Math.min(active.value + 1, results.value.length - 1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    active.value = Math.max(active.value - 1, 0);
  } else if (event.key === "Enter") {
    event.preventDefault();
    const item = results.value[active.value];
    if (item) choose(item.code);
  } else if (event.key === "Escape") {
    event.preventDefault();
    close();
  }
}

// 用鍵盤往下走到清單外時，把那一項捲進可見範圍。
watch(active, index => {
  void nextTick(() => document.getElementById(`${uid}-${index}`)?.scrollIntoView({ block: "nearest" }));
});
</script>

<template>
  <div class="picker">
    <input
      v-model="text"
      class="input select"
      role="combobox"
      autocomplete="off"
      spellcheck="false"
      aria-autocomplete="list"
      :aria-expanded="open"
      :aria-controls="`${uid}-list`"
      :aria-activedescendant="open && results.length ? `${uid}-${active}` : undefined"
      :placeholder="open ? '搜尋：USD、美元、美國' : ''"
      @focus="openList"
      @click="openList"
      @blur="close"
      @keydown="onKeydown"
    />
    <ul v-if="open" :id="`${uid}-list`" class="list" role="listbox">
      <!--
        mousedown 而不是 click：click 發生在 blur 之後，那時清單已經收起來了。
        prevent 讓焦點留在輸入框，選完還能繼續用鍵盤。
      -->
      <li
        v-for="(item, index) in results"
        :id="`${uid}-${index}`"
        :key="item.code"
        role="option"
        :aria-selected="item.code === modelValue"
        :class="{ active: index === active, selected: item.code === modelValue }"
        @mousedown.prevent="choose(item.code)"
        @mouseenter="active = index"
      >
        <strong>{{ item.code }}</strong>
        <span>{{ item.name }}</span>
      </li>
      <li v-if="!results.length" class="none" role="presentation">找不到「{{ query }}」</li>
    </ul>
  </div>
</template>

<style scoped>
.picker {
  position: relative;
}

/*
  靠右對齊輸入框：支出表單的幣別欄在畫面右側而且只有 110px，往右長出去
  會超出手機螢幕。寬度至少跟輸入框一樣，太窄時長到放得下「代碼 中文」。
*/
.list {
  position: absolute;
  z-index: 30;
  top: calc(100% + 4px);
  right: 0;
  min-width: 100%;
  width: max-content;
  max-width: min(280px, 90vw);
  max-height: 280px;
  overflow-y: auto;
  margin: 0;
  padding: 4px;
  list-style: none;
  background: var(--color-card);
  border: 1px solid var(--color-line);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-pop);
}

.list li {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.list li.active {
  background: var(--color-primary-soft);
}

.list strong {
  min-width: 3em;
  font-variant-numeric: tabular-nums;
}

.list li.selected strong {
  color: var(--color-primary-dark);
}

.list span {
  color: var(--color-muted);
}

.list li.none {
  color: var(--color-muted);
  cursor: default;
}
</style>
