# Lifetimes

Ce que tu vas apprendre : pourquoi Rust a besoin de lifetimes, ce qu'une annotation `'a` veut vraiment dire (une **relation**, pas une durée), quand tu peux t'en passer (élision), comment écrire des structs qui empruntent, ce que signifie `'static`, et comment écrire un parser **zero-copy**.

## Le problème que les lifetimes résolvent

En TS, ce code est impossible à casser : le GC garde l'objet en vie tant que quelqu'un le référence.

```ts
function firstTag(order: { tags: string[] }) {
  return order.tags[0]; // la string vit tant qu'on la référence
}
```

En Rust, pas de GC : une référence doit **toujours** pointer vers une valeur vivante. Le compilateur doit donc savoir, pour chaque référence, de quelle valeur elle dépend.

```rust
let r;
{
    let s = String::from("A-42");
    r = &s;            // E0597 : `s` does not live long enough
}                      // s est drop ici…
println!("{r}");       // …mais r serait encore utilisée
```

Une **lifetime** est le nom que le compilateur donne à la région de code où une référence est valide. La plupart du temps, il les infère tout seul. Tu n'écris des annotations que quand il ne peut pas deviner une **relation entre entrées et sortie**.

## Annoter : une relation, pas une durée

```rust
fn longest(a: &str, b: &str) -> &str { // E0106
    if a.len() >= b.len() { a } else { b }
}
```

Le compilateur refuse : le résultat emprunte-t-il `a` ou `b` ? Il ne regarde pas le corps de la fonction pour décider : **la signature est le contrat**. On l'annote :

```rust play
fn longest<'a>(a: &'a str, b: &'a str) -> &'a str {
    if a.len() >= b.len() { a } else { b }
}

fn main() {
    let x = String::from("paiement");
    let res;
    {
        let y = String::from("ok");
        res = longest(&x, &y);
        println!("{res}"); // OK : x et y vivent encore
    }
    // println!("{res}"); // erreur : y est mort, et res peut
    //                    // en dépendre d'après la signature
}
```

Lis `<'a>` comme : « il existe une région `'a` pendant laquelle `a` et `b` sont valides tous les deux ; le résultat est valide pendant cette région ». En pratique, `'a` devient l'**intersection** des deux durées de vie.

::: tip Une annotation ne change jamais la durée de vie d'une valeur
Elle décrit des contraintes au compilateur, qui vérifie qu'elles sont respectées. Tu ne peux pas « allonger » la vie d'une variable avec `'static`.
:::

Si le résultat ne dépend que d'**un** paramètre, dis-le :

```rust
// le résultat vient de `text`, jamais de `prefix`
fn strip<'a>(text: &'a str, prefix: &str) -> &'a str {
    text.strip_prefix(prefix).unwrap_or(text)
}
```

Ça laisse l'appelant libérer `prefix` dès l'appel terminé. Une signature trop large (`'a` partout) compile mais contraint inutilement les appelants.

## Élision : pourquoi tu n'écris presque jamais `'a`

Le compilateur applique 3 règles sur les signatures :

1. Chaque référence en entrée reçoit sa propre lifetime.
2. S'il y a **exactement une** lifetime en entrée, elle est donnée à toutes les sorties.
3. S'il y a `&self` ou `&mut self`, la lifetime de `self` est donnée aux sorties.

```rust
fn first_word(s: &str) -> &str
// devient (règles 1 + 2)
fn first_word<'a>(s: &'a str) -> &'a str

impl Order {
    fn tag(&self, key: &str) -> &str
    // devient (règle 3) : le résultat emprunte self, pas key
    fn tag<'a, 'b>(&'a self, key: &'b str) -> &'a str
}
```

Si les règles ne suffisent pas à déterminer les sorties, erreur E0106 et tu annotes. C'est tout.

## Structs qui empruntent

Une struct peut contenir des références, mais elle doit déclarer de quoi elle dépend :

```rust play
#[derive(Debug)]
struct Header<'a> {
    name: &'a str,
    value: &'a str,
}

// "une Header ne peut pas survivre au texte d'où elle vient"
fn parse_header(line: &str) -> Option<Header<'_>> {
    let (name, value) = line.split_once(':')?;
    Some(Header { name: name.trim(), value: value.trim() })
}

fn main() {
    let raw = String::from("Content-Type: application/json");
    let h = parse_header(&raw).unwrap();
    println!("{} = {}", h.name, h.value);
    // drop(raw); // interdit tant que h est utilisée ensuite
    println!("{h:?}");
}
```

`'_` est la lifetime « anonyme » : « celle que l'élision donnerait ». Elle rend visible qu'il y a un emprunt (`Header<'_>`) sans avoir à le nommer.

Les méthodes :

```rust
impl<'a> Header<'a> {
    fn is_json(&self) -> bool {
        self.value.starts_with("application/json")
    }
    // renvoie une référence qui vit autant que le TEXTE source,
    // pas seulement autant que la Header elle-même
    fn name(&self) -> &'a str {
        self.name
    }
}
```

::: warning Quand ne PAS emprunter
Une struct qui emprunte est contrainte par sa source : tu ne peux pas la stocker dans un cache global, l'envoyer à un autre thread longue durée, ou la renvoyer d'un handler après que le buffer est libéré. Pour des structures de **domaine** (entités, DTO), utilise des types possédés (`String`, `Vec`). Les emprunts sont parfaits pour les **vues temporaires** : parsing, itération, formatage.
:::

## `'static`

Deux usages à ne pas confondre.

**1. `&'static T` : une référence valide pendant tout le programme.**

```rust
let s: &'static str = "toujours là"; // stocké dans le binaire
static VERSION: &str = "1.4.2";
```

**2. `T: 'static` (un bound) : le type ne contient aucune référence non-`'static`.**

```rust
fn spawn_job<T: Send + 'static>(job: T) { /* ... */ }
```

Ça ne veut **pas** dire que la valeur vit éternellement ! Ça veut dire qu'elle **pourrait** vivre aussi longtemps qu'on veut, parce qu'elle ne dépend de rien d'emprunté. `String`, `Vec<u8>`, `u64` sont `'static`. Un `&'a str` local ne l'est pas.

C'est pour ça que `std::thread::spawn` et `tokio::spawn` exigent `'static` : la tâche peut survivre à la fonction qui l'a lancée ; elle ne doit donc rien emprunter à sa pile.

```rust play
use std::thread;

fn main() {
    let order_id = String::from("A-42");
    // `move` transfère la String au thread : la closure
    // devient 'static, elle ne dépend plus de main.
    let h = thread::spawn(move || format!("traité {order_id}"));
    println!("{}", h.join().unwrap());
}
```

::: danger N'écris pas `'static` pour faire taire le compilateur
`fn get(&self) -> &'static str` sur une donnée qui vient de `self` ne compilera pas, et `Box::leak` pour obtenir du `'static` est une fuite mémoire volontaire. Si une erreur parle de `'static`, la vraie solution est presque toujours de **posséder** la donnée (`String`, `Arc<T>`, `move`).
:::

## Lifetimes et `impl Trait` (édition 2024)

En édition 2024, un `-> impl Trait` **capture automatiquement** toutes les lifetimes en scope :

```rust
fn active_ids(ids: &[u64]) -> impl Iterator<Item = u64> {
    ids.iter().copied().filter(|id| *id != 0)
}
// le type caché emprunte `ids` : c'est implicite en 2024
```

Si tu veux promettre que le type renvoyé n'emprunte **pas** un paramètre, la syntaxe `+ use<...>` (stable depuis 1.82) restreint les captures. Tu en auras rarement besoin.

## Cas réel : parser des logs en zero-copy

Un service d'ingestion lit des millions de lignes de logs par minute. Copier chaque champ en `String` = des millions d'allocations. Avec des slices, on ne fait **aucune allocation** par ligne :

```rust play
#[derive(Debug, PartialEq)]
struct LogLine<'a> {
    level: &'a str,
    tenant: &'a str,
    msg: &'a str,
}

// format : "LEVEL tenant=<id> <message...>"
fn parse(line: &str) -> Option<LogLine<'_>> {
    let (level, rest) = line.split_once(' ')?;
    let (tenant_kv, msg) = rest.split_once(' ')?;
    let tenant = tenant_kv.strip_prefix("tenant=")?;
    Some(LogLine { level, tenant, msg })
}

fn main() {
    let buffer = "ERROR tenant=acme paiement refusé\n\
                  INFO tenant=globex login ok\n\
                  garbage\n\
                  ERROR tenant=acme timeout DB";

    let errors_acme = buffer
        .lines()
        .filter_map(parse)
        .filter(|l| l.level == "ERROR" && l.tenant == "acme")
        .count();
    println!("{errors_acme} erreurs pour acme");

    let first = parse(buffer.lines().next().unwrap()).unwrap();
    println!("{first:?}");
}
```

Chaque `LogLine` est trois fat pointers dans `buffer`. Si tu dois **garder** certaines lignes après avoir libéré le buffer (les envoyer à une autre tâche, par exemple), tu les convertis à ce moment-là en une version possédée :

```rust
struct OwnedLogLine { level: String, tenant: String, msg: String }

impl From<LogLine<'_>> for OwnedLogLine {
    fn from(l: LogLine<'_>) -> Self {
        Self { level: l.level.into(), tenant: l.tenant.into(),
               msg: l.msg.into() }
    }
}
```

C'est le pattern de `serde` avec `#[serde(borrow)]` et de nombreux parsers (`httparse`, `nom`) : emprunter pendant le traitement, posséder pour stocker. `Cow<'a, str>` ([chapitre 7](/dev/rust/07-smart-pointers)) permet de mixer les deux.

## Pièges classiques

- **Croire que `'a` est une durée que tu choisis.** C'est une contrainte que le compilateur vérifie.
- **Mettre la même lifetime partout** (`&'a self, key: &'a str`) : ça lie des choses indépendantes et crée des erreurs plus loin.
- **Structs de domaine avec des références** : la lifetime « contamine » tout le code qui les utilise. Possède tes entités.
- **`T: 'static` = « vit pour toujours »** : faux, c'est « ne contient pas d'emprunt court ».
- **Renvoyer une référence vers une variable locale** : impossible, quelle que soit l'annotation. Renvoie une valeur possédée.
- **Question d'entretien** : « Pourquoi `thread::spawn` exige `'static` ? » → le thread peut survivre à l'appelant ; il ne peut pas emprunter sa pile.

## Défis

### 1. Pourquoi ça ne compile pas ?

```rust play
// ne compile pas : trouve pourquoi
fn pick(primary: &str, fallback: &str) -> &str {
    if primary.is_empty() { fallback } else { primary }
}

fn main() {
    println!("{}", pick("", "default"));
}
```

::: details Solution
E0106 : deux références en entrée, aucune `&self`, donc l'élision ne sait pas à laquelle rattacher la sortie. Comme le résultat peut venir des deux : `fn pick<'a>(primary: &'a str, fallback: &'a str) -> &'a str`.
:::

### 2. Pourquoi ça ne compile pas ?

```rust play
// ne compile pas : trouve pourquoi
#[derive(Debug)]
struct Token<'a> { value: &'a str }

fn main() {
    let tok;
    {
        let input = String::from("Bearer abc123");
        tok = Token { value: &input[7..] };
    }
    println!("{tok:?}");
}
```

::: details Solution
E0597 : `input` est détruite à la fin du bloc intérieur alors que `tok` (qui l'emprunte) est utilisée après. Le `'a` de `Token<'a>` lie `tok` à `input`. Corrections : déclarer `input` dans le scope extérieur, ou faire posséder la donnée (`value: String`).
:::

### 3. Exercice : parser clé=valeur zero-copy

Parse une chaîne `"k1=v1;k2=v2"` en paires empruntées. Ignore les segments vides et ceux sans `=`. Espaces autour des clés/valeurs supprimés.

```rust play
pub fn parse_kv(input: &str) -> Vec<(&str, &str)> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basic() {
        assert_eq!(parse_kv("plan=pro; seats = 12;"),
                   vec![("plan", "pro"), ("seats", "12")]);
    }
    #[test]
    fn garbage() {
        assert_eq!(parse_kv(";;oops;a=1"), vec![("a", "1")]);
        assert!(parse_kv("").is_empty());
    }
    #[test]
    fn borrows_input() {
        let s = String::from("x=1");
        let v = parse_kv(&s);
        // la slice pointe DANS s : zéro copie
        assert_eq!(v[0].0.as_ptr(), s.as_ptr());
    }
}
```

::: details Solution
```rust play
pub fn parse_kv(input: &str) -> Vec<(&str, &str)> {
    input
        .split(';')
        .filter_map(|seg| seg.split_once('='))
        .map(|(k, v)| (k.trim(), v.trim()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basic() {
        assert_eq!(parse_kv("plan=pro; seats = 12;"),
                   vec![("plan", "pro"), ("seats", "12")]);
    }
    #[test]
    fn garbage() {
        assert_eq!(parse_kv(";;oops;a=1"), vec![("a", "1")]);
        assert!(parse_kv("").is_empty());
    }
    #[test]
    fn borrows_input() {
        let s = String::from("x=1");
        let v = parse_kv(&s);
        assert_eq!(v[0].0.as_ptr(), s.as_ptr());
    }
}
```

L'élision fait le travail : une seule référence en entrée → toutes les `&str` de la sortie empruntent `input`. `split_once` renvoie `None` pour les segments sans `=`, que `filter_map` élimine.
:::

### 4. Exercice : chercher un header

Implémente la recherche **insensible à la casse** d'un header. Observe la signature : pourquoi `name` n'a-t-il pas la lifetime `'a` ?

```rust play
pub fn header<'a>(
    headers: &'a [(String, String)],
    name: &str,
) -> Option<&'a str> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn h() -> Vec<(String, String)> {
        vec![("Content-Type".into(), "text/csv".into()),
             ("X-Tenant".into(), "acme".into())]
    }

    #[test]
    fn found() {
        let hs = h();
        assert_eq!(header(&hs, "x-tenant"), Some("acme"));
    }
    #[test]
    fn not_found() {
        assert_eq!(header(&h(), "Authorization"), None);
    }
    #[test]
    fn name_can_die_early() {
        let hs = h();
        let v = {
            let n = String::from("content-type");
            header(&hs, &n)
        }; // n est drop ici, v reste valide
        assert_eq!(v, Some("text/csv"));
    }
}
```

::: details Solution
```rust play
pub fn header<'a>(
    headers: &'a [(String, String)],
    name: &str,
) -> Option<&'a str> {
    headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case(name))
        .map(|(_, v)| v.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn h() -> Vec<(String, String)> {
        vec![("Content-Type".into(), "text/csv".into()),
             ("X-Tenant".into(), "acme".into())]
    }

    #[test]
    fn found() {
        let hs = h();
        assert_eq!(header(&hs, "x-tenant"), Some("acme"));
    }
    #[test]
    fn not_found() {
        assert_eq!(header(&h(), "Authorization"), None);
    }
    #[test]
    fn name_can_die_early() {
        let hs = h();
        let v = {
            let n = String::from("content-type");
            header(&hs, &n)
        };
        assert_eq!(v, Some("text/csv"));
    }
}
```

Le résultat vient uniquement de `headers`. Si on avait écrit `name: &'a str`, le test `name_can_die_early` ne compilerait plus : `v` serait liée à `n`, détruite à la fin du bloc. Une signature précise rend l'API plus souple.
:::

### 5. Question : `'static` ou pas ?

Parmi ces types, lesquels satisfont le bound `T: 'static` ? `String`, `&'static str`, `&'a str` (avec `'a` local), `Vec<&'static str>`, `Arc<Mutex<Vec<u8>>>`, `Header<'a>` (du cours).

::: details Solution
Satisfont `'static` : `String`, `&'static str`, `Vec<&'static str>`, `Arc<Mutex<Vec<u8>>>`. Ne le satisfont pas : `&'a str` local et `Header<'a>`, qui empruntent une donnée à durée limitée.

Tous les types **possédés** sans référence interne sont `'static`. C'est pourquoi la solution classique à « `borrowed value does not live long enough` » dans un `spawn` est de passer des données possédées avec `move`.
:::

## À retenir

- Une lifetime est la région où une référence est valide ; l'annotation décrit une **relation** entre entrées et sorties.
- Grâce à l'élision, tu n'annotes que quand une sortie peut venir de plusieurs entrées.
- Annote précisément : ne lie la sortie qu'aux paramètres dont elle dépend vraiment.
- Struct qui emprunte (`Foo<'a>`) = vue temporaire ; entités de domaine = données possédées.
- `T: 'static` = « ne contient pas d'emprunt court », requis par `thread::spawn` / `tokio::spawn`.
- Zero-copy : parse avec des `&str`, convertis en possédé seulement ce que tu gardes.
