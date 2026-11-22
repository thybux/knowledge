# Dev

Les deux langages du book, lus côte à côte, puis leur usage en production.

- **[TypeScript](/dev/typescript/)** — le langage du quotidien : APIs, front, outillage. L'objectif est de maîtriser le système de types et l'asynchrone au point de concevoir des APIs robustes.
- **[Rust](/dev/rust/)** — le langage qui t'oblige à comprendre ce que fait la machine : mémoire, concurrence, erreurs. Chaque chapitre fait le pont avec ce que tu connais déjà en TS.
- **[Next.js](/dev/nextjs/)** — le front en production : Server Components, cache, Server Actions, SEO, performance et sécurité. À lire après le chapitre React de la section TypeScript.
- **[Rust en service](/dev/rust-service/)** — Rust hors du tutoriel : jobs planifiés qui parlent HTTP et RabbitMQ, état incrémental, observabilité, déploiement en CronJob. À lire après la section Rust.

## Comment lire cette section

1. Alterne : un chapitre TS, un chapitre Rust. Les notions se répondent (erreurs typées ↔ `Result`, unions discriminées ↔ `enum`, génériques ↔ traits).
2. Chaque chapitre finit par des **défis**. Les blocs marqués **▶ Ouvrir dans Rust/TS Playground** s'exécutent directement depuis ton téléphone.
3. Les sections **Cas réel** sont les plus importantes : c'est ce qui sépare « je connais la syntaxe » de « je sais construire une app ».

::: tip Sur mobile
Dans le Rust Playground, le bouton **Run** a un menu déroulant : choisis **Test** pour lancer les `#[test]`.
:::
