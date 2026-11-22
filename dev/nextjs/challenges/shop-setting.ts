import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "next-shop-setting",
  title: "Réglage boutique avec repli global",
  difficulty: "facile",
  entry: "resolveSetting",
  starter: `// Une table de réglages multi-boutique : shopId = 0 veut dire
// "valeur globale, partagée par toutes les boutiques".
type SettingRow = { name: string; shopId: number; value: string | null };

// Résout la valeur d'un réglage pour une boutique :
// 1. ligne (name, shopId) avec une value non nulle -> elle gagne ;
// 2. sinon ligne (name, 0) avec une value non nulle -> repli global ;
// 3. sinon fallback.
// value === null sur une ligne = "pas de surcharge", pas "vide".
// Une value "" est une vraie valeur (elle gagne).
// shopId = 0 demandé -> seule la ligne globale compte.
function resolveSetting(
  rows: SettingRow[],
  name: string,
  shopId: number,
  fallback: string | null,
): string | null {
  return fallback;
}`,
  solution: `type SettingRow = { name: string; shopId: number; value: string | null };

function resolveSetting(
  rows: SettingRow[],
  name: string,
  shopId: number,
  fallback: string | null,
): string | null {
  const find = (id: number) =>
    rows.find((r) => r.name === name && r.shopId === id && r.value !== null);
  const own = shopId === 0 ? undefined : find(shopId);
  return own?.value ?? find(0)?.value ?? fallback;
}`,
  cases: [
    {
      name: "surcharge de la boutique",
      args: [[
        { name: "free_shipping_from", shopId: 0, value: "100" },
        { name: "free_shipping_from", shopId: 2, value: "80" },
      ], "free_shipping_from", 2, null],
      expected: "80",
    },
    {
      name: "repli global",
      args: [[
        { name: "free_shipping_from", shopId: 0, value: "100" },
        { name: "free_shipping_from", shopId: 2, value: "80" },
      ], "free_shipping_from", 3, null],
      expected: "100",
    },
    {
      name: "null = pas de surcharge",
      args: [[
        { name: "currency", shopId: 0, value: "EUR" },
        { name: "currency", shopId: 2, value: null },
      ], "currency", 2, null],
      expected: "EUR",
    },
    {
      name: "chaîne vide = vraie valeur",
      args: [[
        { name: "banner", shopId: 0, value: "Soldes" },
        { name: "banner", shopId: 2, value: "" },
      ], "banner", 2, null],
      expected: "",
    },
    {
      name: "rien du tout -> fallback",
      args: [[{ name: "other", shopId: 0, value: "x" }], "banner", 2, "défaut"],
      expected: "défaut",
    },
    {
      name: "shopId 0 : global seul",
      args: [[
        { name: "currency", shopId: 0, value: "EUR" },
        { name: "currency", shopId: 2, value: "CHF" },
      ], "currency", 0, null],
      expected: "EUR",
    },
  ],
});
