import { defineChallenge } from "../../../.vitepress/theme/challenge";

export default defineChallenge({
  id: "prat-ts-template",
  title: "Mini moteur de templates",
  difficulty: "moyen",
  entry: "render",
  starter: `// render("Salut {{ user.name }} !", { user: { name: "Ana" } })
//   -> "Salut Ana !"
// Règles :
// - {{ path }} : chemin pointé, espaces autour ignorés
// - valeur échappée HTML : & < > " '  ->  &amp; &lt; &gt; &quot; &#39;
// - {{{ path }}} : valeur brute, sans échappement
// - chemin absent ou null -> "" ; nombres/booléens -> String(v)
// - le texte hors balises est recopié tel quel
function render(tpl: string, data: Record<string, unknown>): string {
  return tpl;
}`,
  solution: `function render(tpl: string, data: Record<string, unknown>): string {
  const lookup = (path: string): string => {
    let cur: any = data;
    for (const k of path.split(".")) {
      if (cur == null) return "";
      cur = cur[k];
    }
    return cur == null ? "" : String(cur);
  };
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;")
     .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
     .replace(/'/g, "&#39;");
  const re = /\\{\\{\\{\\s*([\\w.]+)\\s*\\}\\}\\}|\\{\\{\\s*([\\w.]+)\\s*\\}\\}/g;
  return tpl.replace(re, (_, raw, escaped) =>
    raw !== undefined ? lookup(raw) : esc(lookup(escaped)),
  );
}`,
  cases: [
    { args: ["Bonjour", {}], expected: "Bonjour", name: "sans balise" },
    { args: ["Salut {{name}} !", { name: "Ana" }], expected: "Salut Ana !", name: "simple" },
    {
      args: ["{{ user.name }} a {{user.unread}} messages", { user: { name: "Léo", unread: 3 } }],
      expected: "Léo a 3 messages",
      name: "chemin pointé + nombre",
    },
    { args: ["[{{missing}}] [{{a.b.c}}]", { a: null }], expected: "[] []", name: "absent / null" },
    {
      args: ["<p>{{comment}}</p>", { comment: '<script>alert("x")</script>' }],
      expected: "<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>",
      name: "échappement XSS",
    },
    {
      args: ["{{{html}}}", { html: "<b>Promo</b>" }],
      expected: "<b>Promo</b>",
      name: "triple moustache brute",
    },
    { args: ["{{a}}{{a}}-{{b}}", { a: "x", b: false }], expected: "xx-false", name: "répétitions et booléen" },
    {
      args: ["Tom & {{who}}", { who: "Jerry's" }],
      expected: "Tom & Jerry&#39;s",
      name: "texte hors balise non échappé",
    },
  ],
});
