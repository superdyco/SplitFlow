<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { loadMaps } from "@/services/mapsLoader";

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  title: string;
}

const props = withDefaults(
  defineProps<{
    markers: MapMarker[];
    height?: string;
    /** 只有一個標記時的縮放層級。多個標記會自動框住全部，不看這個值。 */
    zoom?: number;
  }>(),
  { height: "220px", zoom: 16 }
);

const container = ref<HTMLDivElement | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

let map: google.maps.Map | null = null;
let markers: google.maps.Marker[] = [];
let info: google.maps.InfoWindow | null = null;

function clearMarkers() {
  for (const marker of markers) marker.setMap(null);
  markers = [];
}

function draw(maps: typeof google.maps) {
  if (!map || !props.markers.length) return;
  clearMarkers();

  const bounds = new maps.LatLngBounds();
  for (const item of props.markers) {
    const position = { lat: item.lat, lng: item.lng };
    // google.maps.Marker 已標記為 deprecated，但仍可用且不需要額外建立 Map ID。
    // 之後要換 AdvancedMarkerElement 的話得先在 Console 開一個 Map ID。
    const marker = new maps.Marker({ position, map, title: item.title });
    marker.addListener("click", () => {
      if (!info) return;
      info.setContent(`<strong>${item.title}</strong>`);
      info.open({ anchor: marker, map: map ?? undefined });
    });
    markers.push(marker);
    bounds.extend(position);
  }

  if (props.markers.length === 1) {
    map.setCenter({ lat: props.markers[0].lat, lng: props.markers[0].lng });
    map.setZoom(props.zoom);
  } else {
    map.fitBounds(bounds, 48);
  }
}

async function init() {
  loading.value = true;
  error.value = null;
  try {
    const maps = await loadMaps();
    if (!container.value) return;

    map = new maps.Map(container.value, {
      center: { lat: props.markers[0]?.lat ?? 25.033, lng: props.markers[0]?.lng ?? 121.5654 },
      zoom: props.zoom,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false
    });
    info = new maps.InfoWindow();
    draw(maps);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.markers,
  async () => {
    if (!map) return;
    draw(await loadMaps());
  },
  { deep: true }
);

onMounted(init);

onBeforeUnmount(() => {
  clearMarkers();
  info?.close();
  info = null;
  map = null;
});
</script>

<template>
  <div class="map-wrap">
    <div ref="container" class="map" :style="{ height }"></div>
    <div v-if="loading" class="overlay tiny">地圖載入中...</div>
    <div v-else-if="error" class="overlay tiny warn">{{ error }}</div>
  </div>
</template>

<style scoped>
.map-wrap {
  position: relative;
  border-radius: var(--radius-md);
  overflow: hidden;
  border: 1px solid var(--color-line);
}

.map {
  width: 100%;
  background: var(--color-surface);
}

.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  text-align: center;
  background: var(--color-surface);
}

.warn {
  color: var(--color-danger);
}
</style>
