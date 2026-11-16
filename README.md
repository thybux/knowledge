# Knowledge

Base de connaissance perso (TS, Rust, Infra, BDD, coding interview), publiée sur GitHub Pages :
**https://thybux.github.io/knowledge/**

```bash
pnpm install
pnpm dev      # http://localhost:5173/knowledge/
pnpm check    # vérifie que chaque défi <Challenge> a une solution qui passe ses tests
pnpm build    # check + build statique dans .vitepress/dist
```

- Ajouter une page : créer un `.md` dans le bon dossier (préfixe numérique pour l'ordre). La navigation est générée automatiquement.
- Conventions de rédaction et format des défis : [.vitepress/AUTHORING.md](.vitepress/AUTHORING.md).
- Déploiement : automatique à chaque push sur `main` (`.github/workflows/deploy.yml`).
