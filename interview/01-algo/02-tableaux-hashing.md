# Tableaux & hashing

<script setup>
import twoSum from "./challenges/two-sum";
import validAnagram from "./challenges/valid-anagram";
import groupAnagrams from "./challenges/group-anagrams";
import productExceptSelf from "./challenges/product-except-self";
import subarraySumK from "./challenges/subarray-sum-k";
import longestConsecutive from "./challenges/longest-consecutive";
</script>

<Progress :ids="['two-sum', 'valid-anagram', 'group-anagrams', 'product-except-self', 'subarray-sum-k', 'longest-consecutive']" />

Ce que tu vas apprendre : le pattern le plus rentable des entretiens — remplacer une recherche O(n) par une `Map`/`Set` O(1) —, les sommes de préfixes, les clés « signature », et quand un simple tableau de compteurs suffit.

## Le pattern : mémoire contre temps

La brute force typique compare chaque élément à tous les autres : O(n²). Dans 80 % des cas, la boucle interne **cherche** quelque chose (« ai-je déjà vu le complément ? », « combien de fois ce mot ? »). Une table de hachage répond en O(1) en moyenne.

Le schéma : **une seule passe**, et à chaque élément :

1. **interroger** la table (ce que je cherche est-il déjà là ?) ;
2. **mettre à jour** la table avec l'élément courant.

L'ordre « interroger puis insérer » évite d'apparier un élément avec lui-même.

```ts
// Template : une passe, une Map d'état
function onePass(nums: number[]): number {
  const seen = new Map<number, number>(); // valeur -> info (indice, compte…)
  let answer = 0;
  for (let i = 0; i < nums.length; i++) {
    const x = nums[i];
    // 1. interroger : ce dont j'ai besoin est-il déjà vu ?
    if (seen.has(x)) answer++;
    // 2. mettre à jour avec l'élément courant
    seen.set(x, (seen.get(x) ?? 0) + 1);
  }
  return answer;
}
```

En Rust, l'API `entry` fait « lire ou créer » en une seule recherche :

```rust play
use std::collections::HashMap;

fn word_freq(text: &str) -> Vec<(String, usize)> {
    let mut freq: HashMap<String, usize> = HashMap::new();
    for w in text.split_whitespace() {
        *freq.entry(w.to_lowercase()).or_insert(0) += 1;
    }
    let mut v: Vec<_> = freq.into_iter().collect();
    // tri par fréquence décroissante, puis alphabétique
    v.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    v
}

fn main() {
    println!("{:?}", word_freq("le chat et le chien et LE rat"));
}
```

## Map, Set, objet ou tableau ?

| Besoin | TS | Rust |
|---|---|---|
| « déjà vu ? » | `Set` | `HashSet` |
| valeur → info | `Map` | `HashMap` |
| clés petites et bornées (a–z) | `number[26]` | `[u32; 26]` |
| ordre trié des clés | (trier à la fin) | `BTreeMap` |

- Préfère `Map` à un objet `{}` : pas de clés héritées du prototype (`"constructor"`, `"__proto__"`), les clés ne sont pas converties en chaîne, et `size` est O(1).
- Un **tableau de 26 compteurs** bat une map quand l'alphabet est petit : pas de hash, et la comparaison de deux compteurs est O(26) = O(1).
- Une `Map` JS compare les clés **objets par référence** : `map.set([1, 2], x)` puis `map.get([1, 2])` → `undefined`. Pour une clé composite, construis une chaîne (`` `${a}:${b}` ``) ou une clé numérique.

## Sommes de préfixes

`prefix[i]` = somme des `i` premiers éléments. La somme d'un sous-tableau `[j, i)` vaut alors `prefix[i] - prefix[j]` en O(1).

```ts
const nums = [3, 1, 4, 1, 5];
const prefix = [0];
for (const x of nums) prefix.push(prefix[prefix.length - 1] + x);
// prefix = [0, 3, 4, 8, 9, 14]
const sum = (j: number, i: number) => prefix[i] - prefix[j];
sum(1, 4); // 1 + 4 + 1 = 6
```

Combiné à une map, ça résout « combien de sous-tableaux somment à k ? » en une passe : on cherche les préfixes passés égaux à `prefix - k` (défi 5). C'est le même raisonnement que Two Sum, appliqué aux préfixes.

## Deux passes gauche/droite

Quand chaque `out[i]` dépend de « tout ce qui est à gauche » et « tout ce qui est à droite », calcule les deux en deux balayages au lieu de recalculer pour chaque `i` (défi 4). Même idée pour « pluie piégée » ou « prochaine occurrence ».

## Comment le reconnaître

- « Trouve deux éléments qui… », « le complément », « une paire telle que ».
- « Fréquence », « compte », « le plus fréquent », « doublon », « unique ».
- « Anagramme », « même ensemble de lettres » → clé = signature.
- « Sous-tableau **contigu** dont la somme vaut k », avec des **négatifs** → préfixes + map (la sliding window ne marche pas avec des négatifs).
- Contraintes `n ≤ 10⁵` et la brute force est une double boucle de recherche.

## Cas réel

Réconciliation de paiements : chaque nuit, un worker compare les 50 000 transactions d'un export bancaire avec les paiements enregistrés dans ta base (référence + montant). Version naïve : pour chaque ligne bancaire, `payments.find(...)` → O(n·m), 2,5·10⁹ comparaisons.

```ts
type Payment = { ref: string; amountCents: number; id: string };
type BankLine = { ref: string; amountCents: number };

function reconcile(payments: Payment[], bank: BankLine[]) {
  // clé composite en chaîne : une Map compare les objets par référence
  const key = (ref: string, cents: number) => `${ref}|${cents}`;
  const byKey = new Map<string, Payment[]>();
  for (const p of payments) {
    const k = key(p.ref, p.amountCents);
    byKey.set(k, [...(byKey.get(k) ?? []), p]);
  }
  const unmatched: BankLine[] = [];
  for (const line of bank) {
    const bucket = byKey.get(key(line.ref, line.amountCents));
    if (bucket?.length) bucket.pop(); // consomme un paiement
    else unmatched.push(line);
  }
  return unmatched; // à envoyer à la compta
}
```

O(n + m). Détails qui comptent en vrai : les montants en **centimes entiers** (jamais de flottants pour de l'argent), une liste par clé car deux paiements identiques peuvent exister, et on « consomme » le paiement pour ne pas l'apparier deux fois. (Le spread dans `set` copie la liste : acceptable ici car les buckets font 1–2 éléments ; sinon `push` sur la liste existante.)

## Pièges classiques

- Insérer **avant** d'interroger : Two Sum renvoie `[i, i]` pour `target = 2 * nums[i]`.
- Utiliser un objet `{}` comme dictionnaire avec des clés venant de l'utilisateur (`"__proto__"`).
- Clé composite en tableau dans une `Map` JS : elle ne sera jamais retrouvée.
- Clé « signature » ambiguë : `[1, 10]` et `[11, 0]` donnent tous les deux `"110"` avec `join("")`. Mets un séparateur.
- Sliding window sur un tableau avec des négatifs : la somme n'est plus monotone, il faut les préfixes.
- Oublier `seen.set(0, 1)` pour les préfixes : rate les sous-tableaux qui commencent à l'indice 0.
- En Rust : `map[&k]` panique si la clé est absente. Utilise `get`, `entry`, ou `get(..).copied().unwrap_or(0)`.

## Défis

### 1. Two Sum

Étant donné `nums` et `target`, retourne les indices `[i, j]` (i < j) des deux nombres dont la somme vaut `target`. Il y a exactement une solution, et on ne peut pas utiliser deux fois le même élément.

- `nums = [2, 7, 11, 15], target = 9` → `[0, 1]`
- `nums = [3, 3], target = 6` → `[0, 1]`

Problème équivalent sur LeetCode : Two Sum.

<Challenge :data="twoSum" />

::: details Explication
Pour chaque `x`, on cherche `target - x` parmi les éléments **déjà vus**. Une `Map` valeur → indice rend la recherche O(1). On interroge avant d'insérer : ça évite d'apparier `x` avec lui-même, et ça gère `[3, 3]` (le premier 3 est dans la map quand on traite le second).

Temps O(n), espace O(n). L'alternative « trier + two pointers » est O(n log n) et perd les indices d'origine (il faut trier des paires `(valeur, indice)`).

```rust
fn two_sum(nums: &[i32], target: i32) -> (usize, usize) {
    let mut seen: HashMap<i32, usize> = HashMap::new();
    for (i, &x) in nums.iter().enumerate() {
        if let Some(&j) = seen.get(&(target - x)) {
            return (j, i);
        }
        seen.insert(x, i);
    }
    unreachable!("l'énoncé garantit une solution")
}
```
:::

### 2. Valid Anagram

Retourne `true` si `t` est un anagramme de `s` (mêmes caractères, mêmes nombres d'occurrences).

- `s = "anagram", t = "nagaram"` → `true`
- `s = "rat", t = "car"` → `false`
- `s = "aacc", t = "ccac"` → `false`

Problème équivalent sur LeetCode : Valid Anagram.

<Challenge :data="validAnagram" />

::: details Explication
Longueurs différentes → `false` tout de suite. Sinon on compte les caractères de `s` (+1) et ceux de `t` (−1) ; tout doit revenir à 0. Avec une map : O(n) temps, O(k) espace (k = taille de l'alphabet). Avec un tableau fixe de 26 ou 256 compteurs : O(1) espace.

Trier les deux chaînes et comparer marche aussi, mais en O(n log n). Question de suivi fréquente : « et en Unicode ? » → map sur les caractères (attention en JS : `for...of` itère par point de code, `s[i]` par unité UTF-16).

```rust
fn is_anagram(s: &str, t: &str) -> bool {
    if s.len() != t.len() {
        return false;
    }
    let mut count = [0i32; 256]; // un compteur par octet
    for (a, b) in s.bytes().zip(t.bytes()) {
        count[a as usize] += 1;
        count[b as usize] -= 1;
    }
    count.iter().all(|&c| c == 0)
}
```
:::

### 3. Group Anagrams

Regroupe les mots qui sont anagrammes entre eux. L'ordre des groupes et des mots dans un groupe est libre. Mots en minuscules a–z.

- `["eat", "tea", "tan", "ate", "nat", "bat"]` → `[["bat"], ["nat", "tan"], ["ate", "eat", "tea"]]`
- `[""]` → `[[""]]`

Problème équivalent sur LeetCode : Group Anagrams.

<Challenge :data="groupAnagrams" />

::: details Explication
Deux mots sont anagrammes ssi ils ont la même **signature**. Deux signatures possibles :

- le mot trié (`"aet"`) : O(L log L) par mot ;
- les 26 compteurs : O(L) par mot. En JS, joins-les **avec un séparateur** (`"1#0#2…"`), sinon `b×1, d×10` et `b×10, c×1` donnent la même chaîne (c'est le dernier test). En Rust, `[u8; 26]` est directement une clé de `HashMap` (les tableaux implémentent `Hash` et `Eq`).

Total O(n · L) temps et espace, n mots de longueur max L.

```rust
fn group_anagrams(strs: &[&str]) -> Vec<Vec<String>> {
    // clé = signature : nombre d'occurrences de chaque lettre
    let mut groups: HashMap<[u8; 26], Vec<String>> = HashMap::new();
    for s in strs {
        let mut key = [0u8; 26];
        for b in s.bytes() {
            key[(b - b'a') as usize] += 1;
        }
        groups.entry(key).or_default().push(s.to_string());
    }
    groups.into_values().collect()
}
```
:::

### 4. Product of Array Except Self

Retourne `out` où `out[i]` est le produit de tous les éléments sauf `nums[i]`. En O(n), **sans division** (pense à `nums` contenant un zéro).

- `[1, 2, 3, 4]` → `[24, 12, 8, 6]`
- `[-1, 1, 0, -3, 3]` → `[0, 0, 9, 0, 0]`

Problème équivalent sur LeetCode : Product of Array Except Self.

<Challenge :data="productExceptSelf" />

::: details Explication
`out[i] = (produit à gauche de i) × (produit à droite de i)`. Première passe de gauche à droite : `out[i]` reçoit le produit des éléments avant `i`. Seconde passe de droite à gauche avec un accumulateur `right` : on multiplie `out[i]` par le produit des éléments après `i`, puis on met à jour `right`.

Temps O(n), espace O(1) en plus de la sortie. La division (« produit total / nums[i] ») est interdite justement parce qu'elle casse avec les zéros.

```rust
fn product_except_self(nums: &[i32]) -> Vec<i32> {
    let n = nums.len();
    let mut out = vec![1; n];
    // passe 1 : out[i] = produit de tout ce qui est à gauche
    for i in 1..n {
        out[i] = out[i - 1] * nums[i - 1];
    }
    // passe 2 : on multiplie par le produit de droite
    let mut right = 1;
    for i in (0..n).rev() {
        out[i] *= right;
        right *= nums[i];
    }
    out
}
```
:::

### 5. Subarray Sum Equals K

Compte les sous-tableaux **contigus** dont la somme vaut `k`. Les valeurs peuvent être négatives.

- `nums = [1, 1, 1], k = 2` → `2`
- `nums = [1, -1, 0], k = 0` → `3` (`[1, -1]`, `[1, -1, 0]`, `[0]`)

Problème équivalent sur LeetCode : Subarray Sum Equals K.

<Challenge :data="subarraySumK" />

::: details Explication
Un sous-tableau `(j, i]` somme à `k` ssi `prefix[i] - prefix[j] = k`, soit `prefix[j] = prefix[i] - k`. En parcourant, on garde une map « valeur de préfixe → nombre d'occurrences » ; à chaque `i`, on ajoute `seen[prefix - k]` au compteur. On initialise `seen = {0: 1}` pour compter les sous-tableaux qui commencent au début.

Temps O(n), espace O(n). La sliding window ne marche **pas** ici : avec des négatifs, agrandir la fenêtre peut faire baisser la somme. Le test des 3000 zéros vérifie qu'on ne fait pas O(n³) (O(n²) passe encore à cette taille).

```rust
fn subarray_sum(nums: &[i32], k: i32) -> usize {
    // nombre de fois où chaque somme de préfixe a été vue
    let mut seen: HashMap<i32, usize> = HashMap::from([(0, 1)]);
    let (mut prefix, mut count) = (0, 0);
    for &x in nums {
        prefix += x;
        count += seen.get(&(prefix - k)).copied().unwrap_or(0);
        *seen.entry(prefix).or_insert(0) += 1;
    }
    count
}
```
:::

### 6. Longest Consecutive Sequence

Retourne la longueur de la plus longue suite d'entiers consécutifs présents dans `nums` (l'ordre dans le tableau n'importe pas). En O(n) : le tri est interdit.

- `[100, 4, 200, 1, 3, 2]` → `4` (`1, 2, 3, 4`)
- `[0, 3, 7, 2, 5, 8, 4, 6, 0, 1]` → `9`

Problème équivalent sur LeetCode : Longest Consecutive Sequence.

<Challenge :data="longestConsecutive" />

::: details Explication
On met tout dans un `Set`. Un nombre `x` est le **début** d'une séquence ssi `x - 1` n'est pas dans le set. On ne compte qu'à partir des débuts : `x, x+1, x+2…` tant qu'ils sont présents.

Pourquoi O(n) malgré le `while` imbriqué ? Chaque nombre est visité par le `while` au plus une fois — uniquement depuis le début de sa séquence. Total : O(n) pour la boucle externe + O(n) pour toutes les boucles internes. Itérer sur le `Set` (et pas sur `nums`) évite de recompter les doublons. Espace O(n).

```rust
fn longest_consecutive(nums: &[i32]) -> usize {
    let set: HashSet<i32> = nums.iter().copied().collect();
    let mut best = 0;
    for &x in &set {
        if set.contains(&(x - 1)) {
            continue; // x n'est pas le début d'une séquence
        }
        let mut len = 1;
        while set.contains(&(x + len as i32)) {
            len += 1;
        }
        best = best.max(len);
    }
    best
}
```
:::

## À retenir

- La boucle interne qui **cherche** se remplace presque toujours par une `Map`/`Set` : O(n²) → O(n).
- Une passe : **interroger, puis insérer**.
- Alphabet petit → tableau de compteurs ; clé composite → chaîne avec séparateur (JS) ou tuple/tableau (Rust).
- Somme de sous-tableau contigu avec négatifs → sommes de préfixes + map, initialisée à `{0: 1}`.
- « Gauche × droite » → deux balayages, pas de recalcul.
- En Rust : `entry().or_insert()` / `or_default()` pour compter, `get().copied().unwrap_or(0)` pour lire.
