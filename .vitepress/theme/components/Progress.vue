<script setup lang="ts">
// Affiche "X / N défis réussis" pour une liste d'ids (ou tous les défis passés en props).
import { onMounted, ref } from "vue";
import { solvedIds } from "../progress";

const props = defineProps<{ ids: string[] }>();
const done = ref(0);
onMounted(() => {
  const s = new Set(solvedIds());
  done.value = props.ids.filter((id) => s.has(id)).length;
});
</script>

<template>
  <div class="progress">
    <div class="progress-bar"><div :style="{ width: `${(done / Math.max(1, ids.length)) * 100}%` }" /></div>
    <span>{{ done }} / {{ ids.length }} défis réussis</span>
  </div>
</template>
