# Coding interview

Trois parties, du plus « LeetCode » au plus « vraie vie » :

1. **[Algorithmes](/interview/01-algo/)** — les patterns qui reviennent dans 90 % des entretiens techniques, chacun avec des défis exécutables.
2. **[Entretien pratique](/interview/02-pratique/)** — les exercices qu'on donne vraiment à un dev mid : `retry`, `promisePool`, parsers, machines à états… plus 60+ questions de cours en flashcards.
3. **[System design](/interview/03-system-design/)** — concevoir un URL shortener, un rate limiter, un système de notifications, des paiements idempotents.

## Comment marchent les défis

Les défis TypeScript se font **directement dans la page**, même sur téléphone :

1. Écris ton code dans l'éditeur (il est sauvegardé automatiquement dans ton navigateur).
2. **▶ Lancer les tests** exécute ta fonction contre tous les cas, cas limites compris.
3. Un défi réussi est marqué ✓ et compte dans la barre de progression.
4. **🦀 Version Rust** ouvre le même problème dans le Rust Playground, avec ses tests (menu **Run → Test**).

Essaie avec un classique :

<script setup>
import twoSum from "./01-algo/challenges/two-sum";
</script>

<Challenge :data="twoSum" />

::: tip La méthode en 20 secondes
Reformule → exemples à la main → brute force + complexité → optimise → code → teste les cas limites → donne la complexité finale. Détail dans [Méthode & Big-O](/interview/01-algo/01-methode-big-o).
:::
