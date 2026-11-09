import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { defineConfig, type DefaultTheme } from "vitepress";

const ROOT = join(import.meta.dirname, "..");
const IGNORED = new Set(["node_modules", ".vitepress", ".git"]);

// Titre = premier "# ..." du fichier, sinon le nom du fichier.
function title(file: string): string {
  const h1 = readFileSync(file, "utf8").match(/^#\s+(.+)$/m);
  return h1 ? h1[1].trim() : file.split("/").pop()!.replace(/\.md$/, "");
}

// Sidebar generee a partir de l'arborescence : un dossier = un groupe.
function sidebar(dir: string): DefaultTheme.SidebarItem[] {
  return readdirSync(dir)
    .filter((n) => !n.startsWith(".") && !IGNORED.has(n))
    .sort()
    .flatMap((name): DefaultTheme.SidebarItem[] => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        const items = sidebar(path);
        return items.length ? [{ text: name, collapsed: false, items }] : [];
      }
      if (!name.endsWith(".md") || path === join(ROOT, "index.md")) return [];
      return [{ text: title(path), link: "/" + relative(ROOT, path).replace(/\.md$/, "") }];
    });
}

export default defineConfig({
  lang: "fr-FR",
  title: "Knowledge",
  description: "Base de connaissance perso",
  cleanUrls: true,
  srcExclude: ["**/node_modules/**", "README.md"],
  themeConfig: {
    search: { provider: "local" },
    outline: { level: [2, 3], label: "Sur cette page" },
    docFooter: { prev: "Page precedente", next: "Page suivante" },
    sidebar: sidebar(ROOT),
  },
});
