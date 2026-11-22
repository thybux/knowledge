import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "next-safe-return-to",
  title: "Anti open redirect sur ?suite=",
  difficulty: "moyen",
  entry: "safeReturnTo",
  starter: `// Après connexion, on renvoie le visiteur vers ?suite=... .
// Sans contrôle, /connexion?suite=https://evil.example devient
// un tremplin de phishing (open redirect).
//
// Renvoie value si c'est un chemin INTERNE sûr, sinon fallback :
// - value doit être une string (une valeur forgée peut être autre chose) ;
// - longueur 1..512 ;
// - commence par "/" ;
// - le 2e caractère n'est pas "/" ("//evil.example" = URL absolue) ;
// - aucun antislash (code 92) : le navigateur le lit comme "/" ;
// - aucun caractère de contrôle (code < 32 ou 127) : le parseur
//   d'URL les supprime, "/<TAB>/evil.example" devient "//evil...".
function safeReturnTo(value: unknown, fallback: string): string {
  return fallback;
}`,
  solution: `function safeReturnTo(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  if (value.length === 0 || value.length > 512) return fallback;
  if (value[0] !== "/" || value[1] === "/") return fallback;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 32 || c === 127 || c === 92) return fallback;
  }
  return value;
}`,
  cases: [
    {
      name: "chemin interne",
      args: ["/compte/commandes?page=2", "/compte"],
      expected: "/compte/commandes?page=2",
    },
    { name: "URL absolue", args: ["https://evil.example", "/compte"], expected: "/compte" },
    { name: "protocol-relative", args: ["//evil.example", "/compte"], expected: "/compte" },
    { name: "antislash", args: ["/\\evil.example", "/compte"], expected: "/compte" },
    { name: "tabulation", args: ["/\t/evil.example", "/compte"], expected: "/compte" },
    { name: "retour ligne", args: ["/a\nb", "/compte"], expected: "/compte" },
    { name: "pas une string", args: [42, "/compte"], expected: "/compte" },
    { name: "vide", args: ["", "/compte"], expected: "/compte" },
    { name: "relatif", args: ["compte", "/compte"], expected: "/compte" },
    { name: "trop long", args: ["/" + "a".repeat(600), "/compte"], expected: "/compte" },
    { name: "racine", args: ["/", "/compte"], expected: "/" },
  ],
});
