# MongoDB

Ce que tu vas apprendre : penser en documents plutôt qu'en tables. Quand imbriquer, quand référencer, le schéma de l'app fil rouge en MongoDB, les index composés (règle ESR), l'aggregation pipeline sur des cas réels, les transactions, la validation de schéma, et les pièges qui font regretter Mongo.

Exemples testés sur MongoDB 8 avec `mongosh` (`docker run -d mongo:8 --replSet rs0` puis `rs.initiate()` : les transactions exigent un replica set, même à un seul nœud).

## Le modèle document

Un document = un objet BSON (JSON binaire avec des types en plus : `Date`, `ObjectId`, `Decimal128`, `Int32/64`…), max **16 Mo**. Une collection = un ensemble de documents, sans schéma imposé par défaut.

La règle de conception est inversée par rapport au SQL :

- En SQL, tu modélises **les données** (3NF), puis tu écris les requêtes.
- En Mongo, tu modélises **les accès** : quelles pages, quelles API, quelles lectures sont les plus fréquentes ? Les données lues ensemble vivent ensemble.

L'atomicité est garantie **au niveau d'un document**. Si tout ce qui doit changer ensemble est dans un seul document, tu n'as pas besoin de transaction.

## Embed vs reference

| Imbriquer (embed) si… | Référencer si… |
|---|---|
| lu presque toujours avec le parent | lu indépendamment |
| relation 1-1 ou 1-quelques | 1-beaucoup ou N-N non bornée |
| borné (quelques dizaines max) | croît sans limite |
| pas mis à jour séparément | modifié souvent, par d'autres |
| copie historique voulue (prix payé) | doit refléter la valeur actuelle |

La question décisive : **est-ce que ce tableau peut grossir sans fin ?** Si oui, collection séparée.

## Le fil rouge en MongoDB

```js
// orders : la commande embarque ses lignes et ses paiements
{
  _id: ObjectId("…"),
  tenantId: 1,
  userId: 2,
  status: "paid",
  total: Decimal128("74.30"),
  currency: "EUR",
  createdAt: ISODate("2026-10-12T00:00:00Z"),
  items: [
    { productId: 1, sku: "MUG-01", name: "Mug isotherme",
      qty: 2, unitPrice: Decimal128("19.90") },
    { productId: 2, sku: "CAF-01", name: "Cafetiere italienne",
      qty: 1, unitPrice: Decimal128("34.50") }
  ],
  payments: [
    { provider: "stripe", ref: "pi_001",
      amount: Decimal128("74.30"), status: "succeeded" }
  ]
}
```

Les choix :

- **`items` imbriqués** : toujours lus avec la commande, bornés (un panier), et `sku`/`name`/`unitPrice` sont une **copie historique**, exactement comme `order_items.unit_price` en SQL.
- **`payments` imbriqués** : 1 à 3 tentatives par commande, lus avec elle.
- **`userId` référencé** : un client a des centaines de commandes, et son profil change.
- **`products`** : collection séparée, avec `categoryIds: [2, 3]` (tableau de références) et `attributes` libres. Le N-N SQL devient un tableau.
- **`events`** : collection séparée (croissance infinie), idéalement une *time series collection*.

```js
// products
{ _id: 1, tenantId: 1, sku: "MUG-01", name: "Mug isotherme",
  price: Decimal128("19.90"), stock: 120,
  categoryIds: [2, 3],
  attributes: { color: "noir", tags: ["cafe", "inox"] } }
```

`tenantId` dans **chaque** document et en tête de presque chaque index, comme en SQL. Mongo n'a pas de RLS : l'isolation repose sur ta couche d'accès (un repository qui ajoute toujours `tenantId` au filtre).

Pour l'argent : `Decimal128`, jamais un `double` (le type numérique par défaut en JS). Ou des centimes en `Int64`.

## Index

Mêmes principes qu'un B-tree SQL : sans index, `COLLSCAN` (scan complet). Quelques spécificités :

```js
// composé
db.orders.createIndex({ tenantId: 1, status: 1, createdAt: -1 });

// unique composé
db.products.createIndex({ tenantId: 1, sku: 1 }, { unique: true });

// unique partiel (soft delete)
db.users.createIndex(
  { tenantId: 1, email: 1 },
  { unique: true,
    partialFilterExpression: { deletedAt: null } });

// multikey : indexe chaque élément d'un tableau
db.products.createIndex({ tenantId: 1, categoryIds: 1 });
db.products.find({ tenantId: 1, categoryIds: 3 });

// TTL : supprime les documents après expiration
db.sessions.createIndex({ createdAt: 1 },
  { expireAfterSeconds: 86400 });
```

### La règle ESR

Pour un index composé, ordonne les champs ainsi : **E**quality, **S**ort, **R**ange.

```js
db.orders.find({
  tenantId: 1,                       // Equality
  status: "paid",                    // Equality
  createdAt: { $gte: from }          // Range
}).sort({ createdAt: -1 });          // Sort
```

Testé avec `explain("executionStats")` :

| Index | Clés examinées | Docs renvoyés |
|---|---|---|
| `{ tenantId, status, createdAt }` | 2 | 2 |
| `{ tenantId, createdAt, status }` | 4 | 2 |

Avec la range avant l'égalité, Mongo parcourt toutes les dates du tenant et filtre `status` dans l'index. Sur 3 commandes, rien ; sur 3 millions, tout. C'est la même règle qu'en Postgres (« égalités, puis range/tri »), avec une subtilité : si le tri porte sur un autre champ que la range, mets le champ de tri **avant** celui de range, sinon Mongo trie en mémoire (`SORT` dans le plan, limité à 100 Mo par défaut avant de déborder sur disque).

Lis `totalKeysExamined`, `totalDocsExamined` et `nReturned` : l'idéal est 1 : 1 : 1.

## Aggregation pipeline

Une suite d'étapes, chaque étape transforme le flux de documents. L'équivalent de `WHERE`, `GROUP BY`, `JOIN`, window functions.

| Étape | Équivalent SQL |
|---|---|
| `$match` | `WHERE` (mets-le en premier : utilise les index) |
| `$project` / `$set` | `SELECT` / colonnes calculées |
| `$group` | `GROUP BY` |
| `$sort`, `$limit` | `ORDER BY`, `LIMIT` |
| `$unwind` | « déplier » un tableau en documents |
| `$lookup` | `LEFT JOIN` |
| `$setWindowFields` | window functions |
| `$facet` | plusieurs agrégations en parallèle |

### CA par tenant le mois dernier

```js
const to = new Date(); to.setUTCDate(1);
to.setUTCHours(0, 0, 0, 0);               // 1er du mois
const from = new Date(to);
from.setUTCMonth(from.getUTCMonth() - 1);

db.orders.aggregate([
  { $match: {
      status: { $in: ["paid", "shipped"] },
      createdAt: { $gte: from, $lt: to } } },
  { $group: {
      _id: "$tenantId",
      revenue: { $sum: "$total" },
      orders: { $sum: 1 } } },
  { $sort: { revenue: -1 } }
]);
// [{ _id: 1, revenue: Decimal128('251.30'), orders: 3 },
//  { _id: 2, revenue: Decimal128('140.49'), orders: 2 }]
```

### Top 3 produits par tenant

```js
db.orders.aggregate([
  { $match: {
      status: { $in: ["paid", "shipped"] },
      createdAt: { $gte: from, $lt: to } } },
  { $unwind: "$items" },
  { $group: {
      _id: { tenant: "$tenantId", sku: "$items.sku" },
      revenue: { $sum: {
        $multiply: ["$items.qty", "$items.unitPrice"] } } } },
  { $group: {
      _id: "$_id.tenant",
      top: { $topN: {
        n: 3, sortBy: { revenue: -1 },
        output: { sku: "$_id.sku", revenue: "$revenue" } } } } },
  { $sort: { _id: 1 } }
]);
```

Résultat identique au SQL du [chapitre 5](/bdd/05-postgres-avance) : MOU-01 177.00, MUG-01 39.80, CAF-01 34.50 pour acme. `$topN` (5.2+) évite le vieux combo `$sort` + `$push` + `$slice`.

### $lookup

```js
db.orders.aggregate([
  { $match: { tenantId: 1, status: "pending" } },
  { $lookup: {
      from: "users", localField: "userId",
      foreignField: "_id", as: "user",
      pipeline: [{ $project: { _id: 0, email: 1 } }] } },
  { $set: { user: { $first: "$user" } } }
]);
```

`$lookup` renvoie toujours un **tableau**. Il est utile pour un back-office ou un rapport, mais si une page fait un `$lookup` à chaque affichage, c'est souvent le signe que le modèle est relationnel (voir pièges).

## Écritures atomiques et transactions

Un `updateOne` est atomique sur le document : la réservation de stock se fait comme en SQL, avec un filtre conditionnel.

```js
const r = db.products.updateOne(
  { _id: 2, stock: { $gte: 1 } },
  { $inc: { stock: -1 } });
// r.modifiedCount === 0 → rupture de stock
```

Opérateurs à connaître : `$set`, `$inc`, `$push` (avec `$each`/`$slice` pour borner un tableau), `$addToSet`, `$pull`, et `findOneAndUpdate` (renvoie le document, ≈ `UPDATE … RETURNING`).

Transactions multi-documents (depuis 4.0, replica set requis) :

```js
const session = db.getMongo().startSession();
const s = session.getDatabase("shop");
session.withTransaction(() => {
  for (const it of cart) {
    const res = s.products.updateOne(
      { _id: it.productId, stock: { $gte: it.qty } },
      { $inc: { stock: -it.qty } });
    if (res.modifiedCount !== 1)
      throw new Error("out of stock " + it.productId);
  }
  s.orders.insertOne({ tenantId: 1, userId: 2,
    status: "pending", items: cart, createdAt: new Date() });
});
```

Testé : si un produit manque, l'exception annule **tout** (stock des autres produits et commande). `withTransaction` retente automatiquement sur les erreurs transitoires (`TransientTransactionError`).

Les transactions Mongo ont un coût et des limites : 60 s max par défaut, verrous de documents, pression sur le cache WiredTiger. Si ton modèle a besoin de transactions partout, il est probablement trop normalisé.

Durabilité : utilise `writeConcern: { w: "majority" }` (le défaut depuis 5.0) pour qu'une écriture confirmée survive à un failover. `readConcern: "majority"` pour ne lire que ce qui est durable.

## Validation de schéma

« Schemaless » ne veut pas dire « sans schéma » : sans validation, le schéma est implicite et dispersé dans le code de chaque service. Mongo sait valider côté serveur :

```js
db.createCollection("orders", { validator: { $jsonSchema: {
  bsonType: "object",
  required: ["tenantId", "userId", "status",
             "total", "items", "createdAt"],
  properties: {
    status: { enum: ["pending", "paid", "shipped",
                     "cancelled", "refunded"] },
    total: { bsonType: "decimal" },
    items: {
      bsonType: "array", minItems: 1, maxItems: 500,
      items: {
        bsonType: "object",
        required: ["productId", "sku", "qty", "unitPrice"],
        properties: {
          qty: { bsonType: "int", minimum: 1 } } } }
  } } },
  validationAction: "error"
});
```

Un document invalide est refusé (`code 121, Document failed validation`). Pour une collection existante : `collMod` avec `validationLevel: "moderate"` (n'applique les règles qu'aux documents déjà valides) pendant la migration. Côté app, double avec un schéma Zod / serde pour des erreurs lisibles ([Erreurs & validation](/dev/typescript/05-erreurs-et-validation)).

## Cas réel

**Contexte** : une startup a démarré son e-commerce sur MongoDB. Deux ans plus tard : documents `users` de 9 Mo, pages lentes, et un `$lookup` sur 4 collections dans l'endpoint le plus appelé.

Ce qu'on a trouvé :

1. **`users.orders: [...]`** : toutes les commandes du client imbriquées dans son document. Un gros client B2B approchait la limite de 16 Mo ; chaque connexion relisait et réécrivait 9 Mo (le document entier transite à chaque lecture). → commandes en collection séparée, avec `userId` et un index `{ tenantId: 1, userId: 1, createdAt: -1 }`.
2. **`products.viewLog: [...]`** : chaque vue de produit faisait un `$push`. Tableau non borné, index multikey gigantesque. → `product_stats` en **bucket pattern** (un document par produit et par jour, `$inc: { views: 1 }`), et le détail des vues dans une time series collection.
3. **Page commande = `$lookup` users + products + categories + shipping** : le modèle avait été copié depuis un schéma SQL normalisé. → dénormaliser dans la commande ce qui est lu à l'affichage (nom et prix du produit au moment de l'achat, adresse de livraison copiée), garder les références pour le reste.
4. **Validation** : ajout d'un `$jsonSchema` en `moderate`, puis script de nettoyage, puis passage en `strict`.

Leçon : en Mongo, le schéma se dessine à partir des requêtes, et chaque tableau imbriqué doit avoir une borne.

## Pièges classiques

- **Tableaux non bornés** (`comments`, `logs`, `orders` dans un parent) : document qui grossit, limite de 16 Mo, réécritures coûteuses.
- **`$lookup` partout** : tu as réinventé le SQL, sans ses jointures optimisées ni ses contraintes. Soit tu dénormalises, soit c'est que Postgres était le bon choix.
- Dénormaliser **sans** stratégie de mise à jour (le nom du client copié dans 10 000 commandes : faut-il le mettre à jour ? Pour une facture, non ; pour un affichage, peut-être).
- `double` pour l'argent.
- Oublier `tenantId` dans un filtre (pas de RLS pour te rattraper).
- Index non ESR, ou trop d'index (chaque index multikey coûte cher en écriture).
- Pas de validation : trois formats de date différents dans la même collection après 2 ans.
- Faire des `find()` avec `skip()` profond : même problème que l'`OFFSET` ; pagine par `_id` ou `createdAt`.
- Lire sur un secondaire avec `readPreference: secondary` et s'étonner de ne pas voir sa propre écriture.

## Défis

**1. Embed ou reference ?** Pour chacun, choisis et justifie : a) les lignes d'une commande ; b) les avis clients d'un produit (certains en ont 40 000) ; c) l'adresse de livraison d'une commande ; d) les catégories d'un produit ; e) les sessions de connexion d'un utilisateur.

::: details Solution
- a) **Embed** : lues avec la commande, bornées, copie historique.
- b) **Reference** : collection `reviews` avec `productId` (non borné). Option : embarquer dans le produit les **5 derniers** avis et la note moyenne (*subset pattern*), mis à jour à chaque nouvel avis avec `$push` + `$slice: -5`.
- c) **Embed (copie)** : l'adresse au moment de la commande est un fait historique ; si le client déménage, la commande passée ne change pas.
- d) **Tableau de références** `categoryIds` (+ index multikey) : N-N, mais petit côté produit. Les catégories elles-mêmes dans leur collection (nom modifiable).
- e) **Reference** : collection `sessions` avec index TTL ; croissance continue, expiration automatique.
:::

**2. Index ESR.** Propose l'index pour cette requête de back-office, et explique pourquoi `{ tenantId: 1, createdAt: -1, status: 1 }` est moins bon.

```js
db.orders.find({ tenantId: 1, status: "paid",
                 createdAt: { $gte: from } })
  .sort({ createdAt: -1 }).limit(50);
```

::: details Solution
`{ tenantId: 1, status: 1, createdAt: -1 }` : deux égalités, puis `createdAt` qui sert à la fois au tri et à la range. Le plan est un `IXSCAN` sans `SORT`, qui s'arrête après 50 clés.

Avec `createdAt` avant `status`, l'index parcourt toutes les dates du tenant depuis `from` et filtre le statut sur chaque clé (testé : 4 clés examinées au lieu de 2 pour 2 résultats). La proportion empire avec la part de commandes non payées.
:::

**3. Pipeline : panier moyen par mois.** Pour le tenant 1, calcule le nombre de commandes payées et le panier moyen par mois calendaire.

::: details Solution
```js
db.orders.aggregate([
  { $match: { tenantId: 1,
              status: { $in: ["paid", "shipped"] } } },
  { $group: {
      _id: { $dateTrunc: { date: "$createdAt",
                           unit: "month" } },
      orders: { $sum: 1 },
      avgBasket: { $avg: "$total" } } },
  { $sort: { _id: 1 } }
]);
```

`$match` d'abord pour utiliser l'index `{ tenantId, status, … }`. `$dateTrunc` (5.0+) ≈ `date_trunc` de Postgres ; ajoute `timezone: "Europe/Paris"` si les mois doivent suivre l'heure locale du marchand. Sur les données de test : un groupe pour le mois dernier, 3 commandes, panier moyen 83.77.
:::

**4. Le document qui explose.** Un dev stocke l'historique des prix dans le produit : `$push: { priceHistory: { price, at } }` à chaque changement. Un import automatique change les prix toutes les heures. Quel est le problème, et que proposes-tu ?

::: details Solution
`priceHistory` croît sans borne : ~8 760 entrées par an et par produit. Chaque lecture du produit (page catalogue, panier) transfère tout l'historique, chaque `$push` réécrit un document de plus en plus gros, et la limite de 16 Mo finira par être atteinte.

Solutions : collection `price_history { productId, price, from, to }` avec index `{ productId: 1, from: -1 }` ; éventuellement garder les 10 derniers prix dans le produit (`$push` avec `$each` et `$slice: -10`). Et n'écrire une entrée que si le prix a **vraiment** changé (filtre `price: { $ne: newPrice }`).
:::

**5. Survente.** Ce code de checkout survend en vente flash. Pourquoi, et comment corriger sans transaction ?

```js
const p = await products.findOne({ _id: id });
if (p.stock < qty) throw new OutOfStock();
await products.updateOne({ _id: id },
  { $set: { stock: p.stock - qty } });
```

::: details Solution
Lost update, exactement comme en SQL ([chapitre 4](/bdd/04-transactions-isolation)) : deux requêtes lisent le même stock, chacune écrit sa valeur calculée. L'atomicité d'un document ne protège que l'opération **elle-même**, pas un read-modify-write côté app.

```js
const r = await products.updateOne(
  { _id: id, stock: { $gte: qty } },
  { $inc: { stock: -qty } });
if (r.modifiedCount === 0) throw new OutOfStock();
```

Filtre conditionnel + `$inc` : la vérification et la décrémentation sont une seule opération atomique sur le document. Pour plusieurs produits : transaction, ou réservation produit par produit avec compensation en cas d'échec.
:::

**6. Mongo ou Postgres ?** Pour le SaaS e-commerce fil rouge, liste deux arguments pour MongoDB et trois pour Postgres. Que choisirais-tu ?

::: details Solution
Pour Mongo : attributs produits très variables selon le type (mais JSONB le fait), et scaling horizontal natif par sharding si le volume explose.

Pour Postgres : le domaine est **relationnel** (users, orders, products, payments, avec des contraintes fortes : FK, unicité par tenant, `CHECK (stock >= 0)`) ; reporting ad hoc en SQL (top N, cohortes, réconciliations) ; RLS pour l'isolation multi-tenant ; transactions sans coût particulier ; JSONB pour la partie flexible.

Choix raisonnable : **Postgres**, avec JSONB pour `attributes`. Mongo se justifie mieux pour des données nativement documentaires (CMS, catalogues très hétérogènes, profils, contenus générés) où les accès se font surtout par document entier. Voir le tableau de [Choisir & scaler](/bdd/09-choisir-et-scaler).
:::

## À retenir

- Modélise à partir des accès : ce qui est lu ensemble vit ensemble.
- Embed si borné et lu avec le parent (ou copie historique) ; reference si non borné ou modifié indépendamment.
- Index composés en ordre **ESR** ; vérifie keys/docs/returned avec `explain`.
- Aggregation : `$match` d'abord ; `$unwind` + `$group` + `$topN` pour les classements ; `$lookup` avec parcimonie.
- Atomique par document : filtre conditionnel + `$inc` ; transactions multi-documents possibles mais à garder rares.
- `$jsonSchema` côté serveur, `Decimal128` pour l'argent, `tenantId` dans chaque filtre.
