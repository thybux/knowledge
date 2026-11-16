# Réseau pour devs

Ce que tu vas apprendre : ce qui se passe entre `fetch("https://api.exemple.fr")` et ton handler (DNS, TCP, TLS, HTTP), plus NAT, firewall et CORS, et comment déboguer tout ça avec `dig` et `curl`.

## Le trajet d'une requête

```text
client
  1. DNS     api.exemple.fr -> 203.0.113.10
  2. TCP     SYN / SYN-ACK / ACK  (port 443)
  3. TLS     handshake, vérif du certificat
  4. HTTP    GET /invoices  (HTTP/2)
  -> load balancer / reverse proxy (Caddy, Nginx)
  -> ton app sur 127.0.0.1:3000
```

Chaque étape peut casser, et chaque étape a son outil. Le réflexe senior : **identifier l'étape** avant de toucher au code.

## TCP vs UDP

| | TCP | UDP |
|---|---|---|
| Connexion | Oui (handshake 3 temps) | Non |
| Fiabilité | Ordre + retransmission | Aucune garantie |
| Usage | HTTP/1.1, HTTP/2, Postgres, Redis | DNS, QUIC (HTTP/3), WireGuard |

Ce qu'un dev back doit retenir de TCP :

- **Handshake** = 1 aller-retour (RTT) avant d'envoyer quoi que ce soit. D'où l'intérêt du **keep-alive** et des **pools de connexions** (DB, HTTP sortant).
- **TIME_WAIT** : le côté qui ferme garde la socket ~60 s. Un client qui ouvre une connexion par requête peut épuiser les ports éphémères (`ss -s` montre des milliers de `timewait`).
- **RST** (`ECONNRESET`) : l'autre côté a tué la connexion brutalement (process mort, proxy qui coupe, idle timeout).
- **Connection refused** (`ECONNREFUSED`) : la machine répond, mais **rien n'écoute** sur ce port.
- **Timeout** : aucun retour, souvent un firewall qui **drop** les paquets.

::: tip Lire une erreur réseau
`ECONNREFUSED` = mauvais port / service down. `ETIMEDOUT` = firewall, route ou machine éteinte. `ENOTFOUND` / `EAI_AGAIN` = DNS. `ECONNRESET` = coupé en cours de route. Juste avec ça, tu gagnes 30 min de debug.
:::

## DNS

Le DNS traduit un nom en enregistrements. Les types à connaître :

| Type | Contient | Exemple |
|---|---|---|
| `A` / `AAAA` | IPv4 / IPv6 | `api → 203.0.113.10` |
| `CNAME` | Alias vers un autre nom | `www → exemple.fr` |
| `MX` | Serveurs mail | `10 mx1.mail.fr` |
| `TXT` | Texte libre | SPF, DKIM, vérif domaine |
| `NS` | Serveurs faisant autorité | `ns1.registrar.fr` |
| `CAA` | CA autorisées à émettre | `0 issue "letsencrypt.org"` |

Règles :

- Un `CNAME` ne peut pas coexister avec un autre record sur le même nom, donc **pas de CNAME à l'apex** (`exemple.fr`). Certains fournisseurs proposent `ALIAS`/`ANAME`/CNAME flattening.
- Le **TTL** (en secondes) dit combien de temps les résolveurs gardent la réponse en cache. Avant une migration, **baisse le TTL** (ex. 300 s) au moins un TTL complet à l'avance, puis bascule.
- Les résolveurs gardent aussi les réponses **négatives** (NXDOMAIN) en cache, selon le SOA. Tester un sous-domaine avant de le créer peut donc retarder sa visibilité.

### dig, ton meilleur ami

```bash
dig api.exemple.fr +short
dig api.exemple.fr A +noall +answer     # avec TTL
dig @1.1.1.1 api.exemple.fr             # via un résolveur précis
dig exemple.fr NS +short                # qui fait autorité
dig @ns1.registrar.fr api.exemple.fr    # réponse "à la source"
dig +trace api.exemple.fr               # toute la chaîne
dig TXT _acme-challenge.exemple.fr
dig -x 203.0.113.10 +short              # reverse
```

Si la réponse de `@ns1` (autorité) est bonne mais pas celle de ton résolveur : c'est du **cache**, attends le TTL.

Dans un conteneur Docker ou K8s, la résolution passe par un DNS interne (`127.0.0.11` pour Docker, CoreDNS pour K8s). `postgres` résout vers le conteneur, pas vers Internet.

## HTTP/1.1 vs HTTP/2 vs HTTP/3

| | HTTP/1.1 | HTTP/2 | HTTP/3 |
|---|---|---|---|
| Transport | TCP | TCP | QUIC (UDP) |
| Multiplexage | Non (1 req/conn) | Oui (streams) | Oui |
| Headers | Texte | Binaires, HPACK | QPACK |
| HOL blocking | Requête | Paquet TCP | Non (par stream) |

- **HTTP/1.1** : une requête à la fois par connexion. Les navigateurs ouvrent ~6 connexions par origine.
- **HTTP/2** : une connexion, plein de streams en parallèle. Mais une perte de paquet TCP bloque **tous** les streams (head-of-line blocking au niveau TCP). En pratique, HTTP/2 exige TLS dans les navigateurs (négocié via **ALPN**).
- **HTTP/3** : sur QUIC/UDP, TLS 1.3 intégré, pas de HOL blocking entre streams, migration de connexion (Wi-Fi → 4G). Annoncé via le header `Alt-Svc`. Nécessite d'ouvrir **UDP 443** sur le firewall.

En pratique : ton reverse proxy parle HTTP/2 ou 3 aux clients, et **HTTP/1.1 à ton app** sur localhost. Ton app Node/Rust n'a pas besoin de gérer HTTP/2 elle-même (sauf gRPC).

## TLS : le handshake

TLS 1.3 (le standard en 2026, TLS 1.2 toléré, 1.0/1.1 morts) :

```text
Client                          Serveur
ClientHello  ----------------->
 (versions, ciphers, SNI,
  ALPN h2, key share)
             <-----------------  ServerHello (key share)
                                 Certificat + signature
                                 Finished
Finished     ----------------->
HTTP chiffré ----------------->   (1 RTT au total)
```

Ce qu'il faut savoir :

- **SNI** : le client envoie le nom de domaine en clair dans le ClientHello, ce qui permet d'héberger plusieurs domaines sur une IP.
- **Chaîne de certificats** : le serveur envoie son certificat **et les intermédiaires**. Oublier l'intermédiaire = marche dans Chrome (qui le récupère parfois), casse dans `curl`, Node ou les SDK mobiles.
- Le certificat doit couvrir le nom (champ SAN), ne pas être expiré, et être signé par une CA de confiance.
- Let's Encrypt : certificats de 90 jours (et la durée maximale des certificats publics baisse progressivement les années suivantes) : **le renouvellement doit être automatique**.

```bash
openssl s_client -connect api.exemple.fr:443 \
  -servername api.exemple.fr </dev/null 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates -ext subjectAltName
```

## Ports et adresses

- Ports < 1024 : privilégiés (root ou `CAP_NET_BIND_SERVICE`). Ton app écoute sur 3000/8080, le proxy sur 80/443.
- `127.0.0.1` : joignable **uniquement depuis la machine**. `0.0.0.0` : toutes les interfaces, donc potentiellement Internet.
- Dans un conteneur, une app qui écoute sur `127.0.0.1` est **injoignable** depuis l'extérieur du conteneur, même avec `-p`. Écoute sur `0.0.0.0` dans le conteneur.

```ts
app.listen({ port: 3000, host: "0.0.0.0" }); // Fastify
```

```rust
let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await?;
```

Plages privées (RFC 1918) : `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`. Notation CIDR : `/24` = 256 adresses, `/32` = une seule.

## NAT

Le **NAT** réécrit les adresses. Deux cas qui te concernent :

- **SNAT/masquerade** : tes conteneurs (IP `172.17.x.x`) sortent sur Internet avec l'IP du serveur. Idem pour les clients d'un VPN WireGuard.
- **DNAT/port forwarding** : `docker run -p 8080:3000` crée une règle qui redirige le port 8080 de l'hôte vers le conteneur.

Conséquence : derrière un proxy ou un NAT, l'IP source que voit ton app n'est pas celle du client. Il faut lire `X-Forwarded-For` **uniquement si** la requête vient d'un proxy de confiance (`trustProxy` dans Fastify, `app.set("trust proxy", ...)` dans Express).

## Firewall : nftables et ufw

Principe : **tout refuser en entrée**, ouvrir le strict nécessaire (22, 80, 443, éventuellement UDP 443 et le port WireGuard).

Avec **ufw** (Ubuntu), frontend simple :

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80,443/tcp
sudo ufw allow 443/udp           # HTTP/3
sudo ufw enable
sudo ufw status verbose
```

Avec **nftables** directement (`/etc/nftables.conf`) :

```text
table inet filter {
  chain input {
    type filter hook input priority 0; policy drop;
    ct state established,related accept
    iif lo accept
    tcp dport { 22, 80, 443 } accept
    udp dport { 443, 51820 } accept
    icmp type echo-request accept
    icmpv6 type { echo-request, nd-neighbor-solicit,
      nd-neighbor-advert, nd-router-advert } accept
  }
}
```

```bash
sudo nft -c -f /etc/nftables.conf   # vérifier
sudo nft -f /etc/nftables.conf
sudo nft list ruleset
```

::: danger Docker contourne ufw
`docker run -p 5432:5432` ajoute ses propres règles dans la chaîne `DOCKER`, **avant** ufw : ton Postgres est exposé sur Internet même avec `ufw deny 5432`. Publie sur localhost : `-p 127.0.0.1:5432:5432`, ou ne publie pas du tout et utilise le réseau Docker interne.
:::

Pense aussi au firewall du **cloud provider** (security groups) : une règle bloquée là-haut ne se voit pas avec `nft list ruleset`.

## CORS

CORS est une protection **du navigateur**, pas du serveur. Quand une page sur `https://app.exemple.fr` appelle `https://api.exemple.fr`, le navigateur :

1. Pour une requête « non simple » (`PUT`, `DELETE`, `Content-Type: application/json`, header `Authorization`…), envoie d'abord un **preflight** `OPTIONS`.
2. Vérifie que la réponse contient les bons headers, sinon bloque la lecture de la réponse.

```text
OPTIONS /invoices
Origin: https://app.exemple.fr
Access-Control-Request-Method: POST
Access-Control-Request-Headers: content-type, authorization

204 No Content
Access-Control-Allow-Origin: https://app.exemple.fr
Access-Control-Allow-Methods: GET, POST, PUT, DELETE
Access-Control-Allow-Headers: content-type, authorization
Access-Control-Allow-Credentials: true
Access-Control-Max-Age: 600
Vary: Origin
```

Règles :

- `Access-Control-Allow-Origin: *` est **interdit** avec `credentials: "include"` (cookies). Renvoie l'origine exacte depuis une **allowlist**, plus `Vary: Origin`.
- Ne reflète jamais aveuglément l'`Origin` reçu : c'est l'équivalent de `*` avec cookies.
- `curl` et Postman ignorent CORS : « ça marche dans curl » ne prouve rien.
- Le preflight ne doit pas exiger d'authentification ni répondre 404/401.

```ts
// Fastify + @fastify/cors
await app.register(cors, {
  origin: ["https://app.exemple.fr"],
  credentials: true,
  maxAge: 600,
});
```

Meilleure option quand c'est possible : servir front et API sur la **même origine** (`exemple.fr` et `exemple.fr/api` via le proxy) : plus de CORS du tout.

## Debug avec curl

```bash
curl -sv https://api.exemple.fr/health        # handshake + headers
curl -sI https://api.exemple.fr               # HEAD
curl --http2 -sI https://api.exemple.fr | head -1
curl --http3 -sI https://api.exemple.fr       # si curl compilé avec
curl -s -o /dev/null -w '%{http_code}\n' URL

# Forcer l'IP (tester un nouveau serveur avant le DNS)
curl --resolve api.exemple.fr:443:198.51.100.7 \
  https://api.exemple.fr/health

# Simuler un preflight CORS
curl -si -X OPTIONS https://api.exemple.fr/invoices \
  -H 'Origin: https://app.exemple.fr' \
  -H 'Access-Control-Request-Method: POST'
```

Le décompte du temps par étape, très utile :

```bash
curl -s -o /dev/null -w @- https://api.exemple.fr/health <<'EOF'
dns:      %{time_namelookup}
connect:  %{time_connect}
tls:      %{time_appconnect}
ttfb:     %{time_starttransfer}
total:    %{time_total}
EOF
```

Si `dns` vaut 2 s : problème de résolveur. Si `ttfb - tls` vaut 2 s : c'est ton app (ou ta DB).

Autres outils : `nc -vz host 5432` (le port répond ?), `mtr host` (route + pertes), `tcpdump -i any port 5432 -nn` (voir les paquets).

## Cas réel

Migration de `billing-api` d'un vieux VPS vers un nouveau, sans coupure :

1. **J-2** : baisser le TTL du record `api` de 3600 à 300 s.
2. Monter le nouveau serveur, tester avec `curl --resolve api.exemple.fr:443:<nouvelle-ip>` (le certificat doit être émis : avec Caddy, utilise le challenge DNS ou émets après bascule).
3. **J** : changer le `A` record. Les deux serveurs tournent en parallèle pendant au moins un TTL (l'ancien pointe sur la **même** DB).
4. Surveiller les logs de l'ancien : quand le trafic tombe à ~0, l'éteindre.
5. Remonter le TTL à 3600.

Pièges rencontrés en vrai : un client B2B qui avait **hardcodé l'IP**, un firewall de partenaire qui filtrait par IP source (webhooks sortants) : prévenir avant.

## Pièges classiques

- App qui écoute sur `127.0.0.1` dans un conteneur : `connection refused` depuis l'extérieur.
- `-p 5432:5432` qui expose la DB malgré ufw.
- Croire que CORS protège l'API : un attaquant appelle l'API sans navigateur. CORS protège **les utilisateurs**.
- Changer un record DNS avec TTL 86400 et s'étonner que ça mette une journée.
- Faire confiance à `X-Forwarded-For` sans proxy de confiance : n'importe qui spoofe son IP (et contourne ton rate limit).
- Oublier le certificat intermédiaire : marche dans le navigateur, casse dans Node (`unable to verify the first certificate`).
- Désactiver la vérification TLS (`NODE_TLS_REJECT_UNAUTHORIZED=0`, `danger_accept_invalid_certs`) « temporairement ».

## Défis

**1. Diagnostic express.** Ton worker Node loggue trois erreurs différentes à trois moments. Pour chacune, quelle couche et quelle première action ?

- a) `getaddrinfo ENOTFOUND smtp.mailprovider.io`
- b) `connect ECONNREFUSED 10.0.1.5:5432`
- c) `connect ETIMEDOUT 52.18.4.9:443`

::: details Solution
- a) **DNS** : le nom ne résout pas (faute de frappe, résolveur du conteneur cassé, domaine expiré). `dig smtp.mailprovider.io` depuis le conteneur (`docker exec … getent hosts …`).
- b) **TCP, machine joignable mais rien n'écoute** sur 5432 : Postgres down, ou `listen_addresses = 'localhost'`. Sur 10.0.1.5 : `ss -tlnp | grep 5432`.
- c) **Paquets droppés** : firewall (le tien en sortie, celui du provider, ou un security group), route. `nc -vz 52.18.4.9 443`, vérifier les règles egress.
:::

**2. CORS qui casse.** Le front sur `https://app.exemple.fr` reçoit dans la console : *« The value of the 'Access-Control-Allow-Origin' header in the response must not be the wildcard '\*' when the request's credentials mode is 'include' »*. Explique et corrige côté API.

::: details Solution
Le front envoie des cookies (`credentials: "include"`). Avec credentials, la spec interdit `*` : il faut l'origine exacte et `Access-Control-Allow-Credentials: true`.

```ts
const allowed = new Set(["https://app.exemple.fr"]);
// dans un hook onRequest
const origin = req.headers.origin;
if (origin && allowed.has(origin)) {
  reply.header("Access-Control-Allow-Origin", origin);
  reply.header("Access-Control-Allow-Credentials", "true");
}
reply.header("Vary", "Origin");
```

Ou plus simple : `@fastify/cors` avec `origin: [...]` et `credentials: true`.
:::

**3. DNS qui « ne se met pas à jour ».** Tu as changé `api.exemple.fr` vers une nouvelle IP il y a 20 min. Chez toi ça pointe encore vers l'ancienne. Écris les commandes pour savoir si c'est ton DNS ou un cache.

::: details Solution
```bash
dig exemple.fr NS +short          # trouver l'autorité
dig @ns1.registrar.fr api.exemple.fr +short   # vérité
dig api.exemple.fr +noall +answer # ton résolveur, regarde le TTL
dig @1.1.1.1 api.exemple.fr +short
```

Si l'autorité renvoie la nouvelle IP : c'est du cache, le TTL restant indique quand il expire. Si l'autorité renvoie l'ancienne : la modif n'est pas publiée (mauvaise zone, mauvais registrar, DNSSEC…). Penser aussi au cache de l'OS / du navigateur.
:::

**4. Postgres exposé.** Un scan externe (Shodan) liste ton IP avec le port 5432 ouvert. Pourtant `ufw status` montre seulement 22, 80, 443. Explique et corrige.

::: details Solution
Le conteneur est lancé avec `ports: ["5432:5432"]`. Docker insère ses règles de DNAT/forward avant les règles ufw : le trafic vers le conteneur ne passe pas par la chaîne `INPUT` d'ufw.

Correctif : retirer la publication (l'API joint Postgres par le réseau Docker interne `postgres:5432`), ou publier sur loopback `127.0.0.1:5432:5432` pour l'accès admin via tunnel SSH. Puis **changer le mot de passe** : considère-le compromis, et vérifie les logs de connexion.
:::

**5. Lenteur par étape.** Ce `curl -w` sur `/health` donne `dns: 0.004 connect: 0.020 tls: 0.050 ttfb: 2.310 total: 2.311`. Où est le problème ? Et si c'était `dns: 5.012` ?

::: details Solution
Le réseau et TLS prennent 50 ms ; **2,26 s entre fin de TLS et premier octet** : c'est le serveur (proxy ou app). Ton `/health` fait probablement une requête DB lente, ou l'event loop est bloquée. Regarde les traces/logs de l'app.

`dns: 5.012` = timeout DNS de 5 s puis succès sur un second serveur : un résolveur listé dans `/etc/resolv.conf` est mort, ou requête AAAA qui timeout. Corrige le résolveur.
:::

## À retenir

- Identifie la couche : DNS → TCP → TLS → HTTP → app. Chaque erreur (`ENOTFOUND`, `ECONNREFUSED`, `ETIMEDOUT`, `ECONNRESET`) pointe une couche.
- Baisse le TTL **avant** une migration DNS.
- Le proxy fait HTTP/2/3 + TLS, l'app reste en HTTP/1.1 sur le réseau interne.
- Firewall : deny par défaut, et attention à Docker qui publie des ports en contournant ufw.
- CORS est une règle du navigateur : allowlist d'origines, jamais `*` avec cookies.
- `curl -v`, `curl --resolve`, `curl -w` et `dig @serveur` règlent 90 % des enquêtes.
