<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type { ChallengeDef } from "../challenge";
import { runChallenge, type CaseResult } from "../runner";
import { isSolved, markSolved } from "../progress";

const props = defineProps<{ data: ChallengeDef }>();
const key = computed(() => `challenge:${props.data.id}:code`);

const code = ref(props.data.starter);
const running = ref(false);
const fatal = ref<string | null>(null);
const results = ref<CaseResult[] | null>(null);
const solved = ref(false);
const showSolution = ref(false);

function toggleSolution() {
  if (showSolution.value || solved.value || confirm("Sûr ? Essaie encore un peu avant de regarder 😉")) {
    showSolution.value = !showSolution.value;
  }
}

onMounted(() => {
  try {
    const saved = localStorage.getItem(key.value);
    if (saved) code.value = saved;
  } catch {}
  solved.value = isSolved(props.data.id);
});

let saveTimer: ReturnType<typeof setTimeout> | undefined;
watch(code, (v) => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(key.value, v);
    } catch {}
  }, 300);
});

const passed = computed(() => results.value?.filter((r) => r.ok).length ?? 0);

async function run() {
  running.value = true;
  fatal.value = null;
  results.value = null;
  const out = await runChallenge(props.data, code.value);
  fatal.value = out.fatal ?? null;
  results.value = out.results ?? null;
  if (out.results && out.results.every((r) => r.ok)) {
    markSolved(props.data.id);
    solved.value = true;
  }
  running.value = false;
}

function reset() {
  if (confirm("Remettre le code de départ ? Ton code actuel sera perdu.")) code.value = props.data.starter;
}

// Tab = 2 espaces, Entrée garde l'indentation (pratique sur clavier physique, sans gêner le mobile).
function onKeydown(e: KeyboardEvent) {
  const el = e.target as HTMLTextAreaElement;
  const { selectionStart: s, selectionEnd: end, value } = el;
  if (e.key === "Tab") {
    e.preventDefault();
    code.value = value.slice(0, s) + "  " + value.slice(end);
    requestAnimationFrame(() => (el.selectionStart = el.selectionEnd = s + 2));
  } else if (e.key === "Enter") {
    const line = value.slice(value.lastIndexOf("\n", s - 1) + 1, s);
    const indent = line.match(/^\s*/)![0] + (/[{[(]\s*$/.test(line) ? "  " : "");
    if (!indent) return;
    e.preventDefault();
    code.value = value.slice(0, s) + "\n" + indent + value.slice(end);
    requestAnimationFrame(() => (el.selectionStart = el.selectionEnd = s + 1 + indent.length));
  }
}

const rustUrl = computed(() =>
  props.data.rust
    ? `https://play.rust-lang.org/?version=stable&mode=debug&edition=2024&code=${encodeURIComponent(props.data.rust)}`
    : null,
);
const rows = computed(() => Math.min(24, Math.max(8, code.value.split("\n").length + 1)));
</script>

<template>
  <div class="challenge" :class="{ solved }">
    <div class="ch-head">
      <span class="ch-title">{{ data.title }}</span>
      <span class="ch-badge" :class="data.difficulty">{{ data.difficulty }}</span>
      <span v-if="solved" class="ch-badge done">✓ réussi</span>
    </div>

    <textarea
      v-model="code"
      class="ch-editor"
      :rows="rows"
      spellcheck="false"
      autocapitalize="off"
      autocomplete="off"
      autocorrect="off"
      @keydown="onKeydown"
    />

    <div class="ch-actions">
      <button class="ch-btn primary" :disabled="running" @click="run">
        {{ running ? "…" : `▶ Lancer les ${data.cases.length} tests` }}
      </button>
      <button class="ch-btn" @click="reset">Réinitialiser</button>
      <button v-if="data.solution" class="ch-btn" @click="toggleSolution">
        {{ showSolution ? "Cacher la solution" : "Solution" }}
      </button>
      <a v-if="rustUrl" class="ch-btn rust" :href="rustUrl" target="_blank" rel="noreferrer">🦀 Version Rust</a>
    </div>

    <div v-if="showSolution && data.solution" class="ch-solution">
      <pre><code>{{ data.solution }}</code></pre>
      <button class="ch-btn" @click="code = data.solution!">Copier dans l'éditeur</button>
    </div>

    <p v-if="fatal" class="ch-fatal">{{ fatal }}</p>

    <div v-if="results" class="ch-results">
      <p class="ch-summary" :class="{ ok: passed === results.length }">
        {{ passed === results.length ? "🎉 Tous les tests passent !" : `${passed} / ${results.length} tests OK` }}
      </p>
      <details v-for="r in results" :key="r.label" class="ch-case" :class="{ ok: r.ok }" :open="!r.ok">
        <summary>{{ r.ok ? "✅" : "❌" }} {{ r.label }} <small>({{ r.ms.toFixed(1) }} ms)</small></summary>
        <div><b>Attendu :</b> <code>{{ r.expected }}</code></div>
        <div><b>Obtenu :</b> <code>{{ r.got }}</code></div>
        <div v-if="r.error" class="ch-error">{{ r.error }}</div>
      </details>
    </div>
  </div>
</template>
