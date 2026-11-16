import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import LZString from "lz-string";
import { defineConfig, type DefaultTheme } from "vitepress";

const ROOT = join(import.meta.dirname, "..");
const IGNORED = new Set(["node_modules", ".vitepress", ".git", ".github", "public"]);

// Ordre des sections dans la barre du haut. Les dossiers non listés arrivent ensuite, par ordre alpha.
const NAV_ORDER = ["dev", "infra", "bdd", "interview"];

// "03-traits.md" -> "traits" (le prefixe numerique sert uniquement a trier).
const stripPrefix = (name: string) => name.replace(/^\d+[-_]/, "");

// Titre = premier "# ..." du fichier, sinon le nom du fichier.
function title(file: string): string {
  const h1 = readFileSync(file, "utf8").match(/^#\s+(.+)$/m);
  return h1 ? h1[1].trim() : stripPrefix(file.split("/").pop()!.replace(/\.md$/, ""));
}

const link = (file: string) =>
  "/" + relative(ROOT, file).replace(/\.md$/, "").replace(/(^|\/)index$/, "$1");

const entries = (dir: string) =>
  readdirSync(dir)
    .filter((n) => !n.startsWith(".") && !n.startsWith("_") && !IGNORED.has(n))
    .sort();

// Sidebar generee a partir de l'arborescence : un dossier = un groupe.
// Si le dossier contient un index.md, son "# Titre" devient le nom du groupe (cliquable).
function sidebar(dir: string): DefaultTheme.SidebarItem[] {
  return entries(dir).flatMap((name): DefaultTheme.SidebarItem[] => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      const items = sidebar(path);
      if (!items.length) return [];
      const index = join(path, "index.md");
      const hasIndex = existsSync(index);
      return [
        {
          text: hasIndex ? title(index) : stripPrefix(name),
          link: hasIndex ? link(index) : undefined,
          collapsed: true,
          items,
        },
      ];
    }
    if (!name.endsWith(".md") || name === "index.md") return [];
    return [{ text: title(path), link: link(path) }];
  });
}

// Une section = un dossier a la racine. Chacune a sa propre sidebar (plus lisible sur mobile).
const sections = entries(ROOT)
  .filter((n) => statSync(join(ROOT, n)).isDirectory())
  .sort((a, b) => {
    const ia = NAV_ORDER.indexOf(a), ib = NAV_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });

// Lien de la section : son index.md, sinon la premiere page trouvee.
function firstLink(items: DefaultTheme.SidebarItem[]): string | undefined {
  for (const i of items) {
    if (i.link) return i.link;
    const l = i.items && firstLink(i.items);
    if (l) return l;
  }
}
const sectionLink = (dir: string) =>
  existsSync(join(ROOT, dir, "index.md")) ? `/${dir}/` : firstLink(sidebar(join(ROOT, dir))) ?? "/";

const sectionTitle = (dir: string) => {
  const index = join(ROOT, dir, "index.md");
  return existsSync(index) ? title(index) : dir;
};

const sidebars: DefaultTheme.SidebarMulti = Object.fromEntries(
  sections.map((dir) => {
    const index = join(ROOT, dir, "index.md");
    const items = sidebar(join(ROOT, dir));
    const first: DefaultTheme.SidebarItem[] = existsSync(index)
      ? [{ text: "Introduction", link: link(index) }]
      : [];
    // On deplie le premier niveau pour la section courante.
    return [`/${dir}/`, [...first, ...items.map((i) => ({ ...i, collapsed: false }))]];
  }),
);

// ```rust play  /  ```ts play  -> ajoute un bouton "Executer" vers le playground officiel.
function playgroundUrl(lang: string, code: string): string | null {
  if (lang === "rust" || lang === "rs") {
    return `https://play.rust-lang.org/?version=stable&mode=debug&edition=2024&code=${encodeURIComponent(code)}`;
  }
  if (lang === "ts" || lang === "typescript") {
    return `https://www.typescriptlang.org/play#code/${LZString.compressToEncodedURIComponent(code)}`;
  }
  return null;
}

export default defineConfig({
  lang: "fr-FR",
  title: "Knowledge",
  description: "Base de connaissance perso — TS, Rust, Infra, BDD, Interview",
  base: "/knowledge/",
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: ["**/node_modules/**", "README.md"],
  head: [
    ["meta", { name: "theme-color", content: "#1b1b1f" }],
    ["meta", { name: "apple-mobile-web-app-capable", content: "yes" }],
  ],
  markdown: {
    config(md) {
      const fence = md.renderer.rules.fence!;
      md.renderer.rules.fence = (tokens, idx, options, env, self) => {
        const token = tokens[idx];
        const words = token.info.trim().split(/\s+/);
        if (!words.includes("play")) return fence(tokens, idx, options, env, self);
        token.info = words.filter((w) => w !== "play").join(" ");
        const lang = words[0].replace(/[:{].*$/, "");
        const url = playgroundUrl(lang, token.content);
        const html = fence(tokens, idx, options, env, self);
        if (!url) return html;
        const label = lang.startsWith("r") ? "Rust Playground" : "TS Playground";
        return `${html}<p class="play-link"><a href="${url}" target="_blank" rel="noreferrer">▶ Ouvrir dans ${label}</a></p>`;
      };
    },
  },
  themeConfig: {
    search: {
      provider: "local",
      options: {
        translations: {
          button: { buttonText: "Rechercher", buttonAriaLabel: "Rechercher" },
          modal: {
            noResultsText: "Aucun résultat pour",
            resetButtonTitle: "Effacer",
            footer: { selectText: "choisir", navigateText: "naviguer", closeText: "fermer" },
          },
        },
      },
    },
    nav: [
      { text: "Roadmap", link: "/roadmap" },
      ...sections.map((dir) => ({ text: sectionTitle(dir), link: sectionLink(dir), activeMatch: `^/${dir}/` })),
    ],
    sidebar: sidebars,
    outline: { level: [2, 3], label: "Sur cette page" },
    docFooter: { prev: "Page précédente", next: "Page suivante" },
    lastUpdated: { text: "Mis à jour" },
    returnToTopLabel: "Retour en haut",
    sidebarMenuLabel: "Menu",
    darkModeSwitchLabel: "Thème",
    socialLinks: [{ icon: "github", link: "https://github.com/thybux/knowledge" }],
  },
});
