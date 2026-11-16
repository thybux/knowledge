# Reverse proxy & TLS

Ce que tu vas apprendre : mettre Nginx ou Caddy devant ton API pour gérer TLS (Let's Encrypt), les headers de sécurité, les websockets, le rate limiting, la compression et le cache des fichiers statiques.

## Pourquoi un reverse proxy

Ton app Node ou Rust ne devrait pas être exposée directement sur Internet. Le reverse proxy :

- **termine TLS** (certificats, renouvellement, HTTP/2 et HTTP/3) ;
- **route** par domaine ou chemin (`api.` → API, `/` → front statique) ;
- **protège** : limites de taille de body, timeouts, rate limit, headers ;
- **compresse** et sert les fichiers statiques bien plus efficacement que Node ;
- permet le **blue/green** : changer d'upstream sans couper.

```text
Internet :443 -> Caddy/Nginx -> 127.0.0.1:3000 (billing-api)
                             -> 127.0.0.1:8080 (ingest)
                             -> /srv/front    (fichiers)
```

**Caddy** : config minimale, HTTPS automatique, HTTP/3 par défaut. Idéal pour un VPS. **Nginx** : partout, ultra-documenté, très fin, mais TLS et HTTP/3 demandent plus de travail. Il faut savoir lire les deux.

## Caddy : le minimum vital

```text
# /etc/caddy/Caddyfile
{
	email ops@exemple.fr
}

api.exemple.fr {
	encode zstd gzip
	reverse_proxy 127.0.0.1:3000
}
```

C'est tout. Au démarrage, Caddy :

1. obtient un certificat Let's Encrypt (ou ZeroSSL en secours) via le challenge HTTP-01 ou TLS-ALPN-01 ;
2. le **renouvelle** automatiquement (bien avant expiration) ;
3. redirige HTTP → HTTPS ;
4. active HTTP/2 et HTTP/3 ;
5. ajoute `X-Forwarded-For`, `X-Forwarded-Proto`, `X-Forwarded-Host` vers l'upstream.

Prérequis : le DNS pointe vers le serveur et les ports **80 et 443** (TCP, + UDP 443 pour HTTP/3) sont ouverts.

```bash
caddy fmt --overwrite /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy     # rechargement à chaud
journalctl -u caddy -f          # émission des certificats
```

### Une config Caddy de prod

```text
api.exemple.fr {
	encode zstd gzip

	request_body {
		max_size 10MB
	}

	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
		-Server
	}

	reverse_proxy 127.0.0.1:3000 {
		health_uri /health
		health_interval 10s
	}

	log {
		output file /var/log/caddy/api.log
		format json
	}
}
```

Le front statique (SPA) sur un autre domaine :

```text
app.exemple.fr {
	root * /srv/front
	encode zstd gzip
	file_server {
		precompressed br gzip
	}

	@assets path /assets/*
	header @assets Cache-Control "public, max-age=31536000, immutable"

	try_files {path} /index.html
}
```

- `precompressed br gzip` : sert `main.js.br` ou `main.js.gz` s'ils existent (générés au build). C'est ainsi qu'on fait du **brotli** avec Caddy : `encode` ne compresse qu'en `zstd` et `gzip` à la volée.
- `try_files … /index.html` : routes côté client d'une SPA.
- Les assets ont un hash dans leur nom (`main.3f2a1c.js`) : cache d'un an, `immutable`. `index.html`, lui, ne doit **pas** être caché longtemps.

### Websockets et SSE avec Caddy

Rien à faire : `reverse_proxy` gère l'upgrade websocket et le streaming automatiquement. Pour SSE, ajoute `flush_interval -1` si les événements arrivent par paquets.

### Rate limit avec Caddy

Pas inclus dans le binaire standard. Deux options : construire Caddy avec le module `caddy-ratelimit` (`xcaddy build --with github.com/mholt/caddy-ratelimit`), ou limiter **dans l'app** (souvent mieux : par clé API ou par tenant plutôt que par IP, cf. [Rate limiter](/interview/03-system-design/03-rate-limiter)).

## Nginx : reverse proxy

```nginx
# /etc/nginx/conf.d/api.conf
upstream billing_api {
    server 127.0.0.1:3000;
    keepalive 32;
}

server {
    listen 80;
    server_name api.exemple.fr;
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    location / {
        return 301 https://$host$request_uri;
    }
}
```

Le bloc HTTPS :

```nginx
server {
    listen 443 ssl;
    listen 443 quic reuseport;
    http2 on;
    server_name api.exemple.fr;

    ssl_certificate
        /etc/letsencrypt/live/api.exemple.fr/fullchain.pem;
    ssl_certificate_key
        /etc/letsencrypt/live/api.exemple.fr/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    client_max_body_size 10m;
    add_header Alt-Svc 'h3=":443"; ma=86400' always;

    location / {
        proxy_pass http://billing_api;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For
            $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 30s;
    }
}
```

- `http2 on;` : la syntaxe moderne (Nginx ≥ 1.25.1). `listen 443 ssl http2` est dépréciée.
- `listen 443 quic` : HTTP/3 (Nginx ≥ 1.25, compilé avec le module QUIC, ce qui est le cas des paquets officiels nginx.org).
- `fullchain.pem` (certificat **+ intermédiaires**), pas `cert.pem`.
- `proxy_http_version 1.1` + `Connection ""` : réutilise les connexions vers l'upstream (`keepalive`). Sans ça, Nginx ouvre une connexion TCP par requête.

```bash
sudo nginx -t                  # TOUJOURS avant reload
sudo systemctl reload nginx    # sans couper les connexions
```

### TLS Let's Encrypt avec certbot

```bash
sudo apt install certbot
sudo certbot certonly --webroot -w /var/www/certbot \
  -d api.exemple.fr --deploy-hook "systemctl reload nginx"
sudo certbot renew --dry-run
systemctl list-timers | grep certbot
```

Le paquet installe un **timer systemd** qui tente le renouvellement deux fois par jour ; `--deploy-hook` recharge Nginx après chaque renouvellement réussi. Le piège : un renouvellement qui échoue en silence (port 80 fermé, DNS changé) et le certificat qui expire 30 jours plus tard. Mets une alerte sur la date d'expiration.

### Websockets avec Nginx

Nginx ne transmet **pas** les headers `Upgrade`/`Connection` par défaut (hop-by-hop) :

```nginx
# dans le bloc http (conf.d/*.conf y est inclus)
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

# dans le server
location /ws/ {
    proxy_pass http://billing_api;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $host;
    proxy_read_timeout 1h;
}
```

Sans `proxy_read_timeout` élevé, Nginx coupe une websocket silencieuse après **60 s**. Envoie aussi des pings applicatifs.

Pour **SSE** : `proxy_buffering off;` sinon les événements sont bufferisés et arrivent par paquets.

### Rate limit avec Nginx

```nginx
# bloc http
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
limit_req_zone $binary_remote_addr zone=login:10m rate=5r/m;

# bloc server
location /auth/login {
    limit_req zone=login burst=5 nodelay;
    limit_req_status 429;
    proxy_pass http://billing_api;
}
location / {
    limit_req zone=api burst=20 nodelay;
    limit_req_status 429;
    proxy_pass http://billing_api;
}
```

- Algorithme **leaky bucket** : `rate` = débit moyen, `burst` = file d'attente tolérée, `nodelay` = traite le burst immédiatement au lieu de lisser.
- `10m` de zone ≈ 160 000 IP.
- Par défaut Nginx renvoie **503** : `limit_req_status 429` est plus correct.
- Derrière un LB ou Cloudflare, `$binary_remote_addr` est l'IP du LB : tout le monde partage le même bucket. Configure `set_real_ip_from` + `real_ip_header`.

### Compression et cache statique

```nginx
gzip on;
gzip_comp_level 5;
gzip_min_length 1024;
gzip_types application/json text/css application/javascript
           image/svg+xml text/plain;
gzip_vary on;

location /assets/ {
    root /srv/front;
    expires 1y;
    add_header Cache-Control "public, immutable";
    gzip_static on;
}
```

- `text/html` est toujours compressé, inutile de le lister.
- `gzip_static on` sert les `.gz` pré-générés. Le **brotli** demande le module `ngx_brotli` (non inclus dans le paquet standard) ; sinon pré-compresse et sers via Caddy ou un CDN.
- Ne compresse pas ce qui l'est déjà (images, PDF, zip).

::: warning Le piège `add_header`
En Nginx, un `add_header` dans un `location` **annule tous** les `add_header` hérités du `server`. Ton HSTS disparaît sur `/assets/`. Répète les headers, ou utilise un `include snippets/security-headers.conf;` dans chaque bloc. Et ajoute `always`, sinon le header n'est pas envoyé sur les réponses 4xx/5xx.
:::

## Headers de sécurité

À poser au niveau proxy (ou dans l'app, mais une seule fois) :

| Header | Rôle |
|---|---|
| `Strict-Transport-Security` | Force HTTPS pour la durée donnée |
| `X-Content-Type-Options: nosniff` | Pas de devinette du type MIME |
| `Content-Security-Policy` | Sources autorisées (front surtout) |
| `Referrer-Policy` | Limite les fuites d'URL |
| `frame-ancestors` (via CSP) | Anti-clickjacking |

Pour une API JSON pure, HSTS + `nosniff` + pas de header `Server`/`X-Powered-By` suffit. La CSP concerne surtout le front. HSTS avec `preload` est un engagement fort (difficile à retirer) : ne l'active que si **tous** tes sous-domaines sont en HTTPS.

## L'app derrière le proxy

Ton app doit savoir qu'elle est derrière un proxy, sinon `req.ip` vaut `127.0.0.1` et `req.protocol` vaut `http` :

```ts
// Fastify : ne faire confiance qu'au proxy local
const app = Fastify({ trustProxy: "127.0.0.1" });
```

```rust
// Axum : lire X-Forwarded-For seulement si la
// connexion vient du proxy (ConnectInfo<SocketAddr>),
// ou utiliser un extracteur dédié (axum-client-ip).
```

Et elle écoute sur `127.0.0.1` (ou le réseau Docker interne), **pas** sur `0.0.0.0` d'un serveur public : sinon on contourne le proxy, ses limites et ses headers en tapant `http://IP:3000`.

## Cas réel

`billing-api` et `ingest` sur le même VPS, derrière Caddy, avec bascule blue/green de l'API :

```text
api.exemple.fr {
	encode zstd gzip
	reverse_proxy {
		to 127.0.0.1:3001
		health_uri /health
		lb_try_duration 5s
	}
}

ingest.exemple.fr {
	request_body {
		max_size 1MB
	}
	reverse_proxy 127.0.0.1:8080
}
```

Le script de déploiement démarre la nouvelle version sur 3002, attend `/health`, réécrit `to 127.0.0.1:3002` puis `systemctl reload caddy`. Caddy recharge sans couper les connexions en cours, `lb_try_duration` absorbe les requêtes pendant la bascule. Rollback : remettre 3001.

Incidents vécus :

- Après une migration vers un nouveau serveur, le DNS pointait encore vers l'ancien : Caddy n'arrivait pas à obtenir de certificat et a fini par atteindre la **limite de taux** de Let's Encrypt. Pour tester, utilise l'environnement staging (`acme_ca https://acme-staging-v02.api.letsencrypt.org/directory`).
- Les uploads de PDF de 15 Mo échouaient en `413` : `max_size` côté proxy à monter **et** la limite du body parser de l'app.

## Pièges classiques

- Oublier `nginx -t` avant `reload` (avec `restart`, une erreur de syntaxe coupe tout).
- `cert.pem` au lieu de `fullchain.pem` : erreurs TLS sur les clients non-navigateurs.
- Websockets qui se coupent à 60 s, SSE bufferisés.
- `add_header` dans un `location` qui efface les headers de sécurité.
- App exposée sur `0.0.0.0:3000` en plus du proxy.
- Rate limit par IP derrière un LB sans `real_ip` : tout le monde est limité ensemble.
- Port 80 fermé « parce qu'on fait que du HTTPS » : plus de renouvellement HTTP-01.

## Défis

**1. 502 après déploiement.** Caddy renvoie `502 Bad Gateway`. Ses logs : `dial tcp 127.0.0.1:3000: connect: connection refused`. L'API tourne dans Docker : `docker ps` montre `0.0.0.0:3000->3000/tcp`, statut `Up`. Que vérifies-tu ?

::: details Solution
`connection refused` = rien ne répond sur ce port côté hôte, ou le conteneur accepte mais l'app derrière n'écoute pas. Le cas typique : l'app écoute sur `127.0.0.1` **dans** le conteneur, donc le port publié ne mène nulle part.

```bash
curl -v http://127.0.0.1:3000/health        # depuis l'hôte
docker exec api sh -c 'ss -tlnp || netstat -tlnp'
docker logs api --tail 50
```

Correctif : `host: "0.0.0.0"` dans l'app. Autres causes : app en train de démarrer (migrations), crash juste après le démarrage (vérifier `RestartCount`), mauvais port.
:::

**2. Trouve les 5 problèmes de cette conf Nginx.**

```nginx
server {
    listen 443 ssl http2;
    server_name api.exemple.fr;
    ssl_certificate /etc/letsencrypt/live/api.exemple.fr/cert.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.exemple.fr/privkey.pem;
    add_header Strict-Transport-Security "max-age=31536000";
    location /ws/ {
        add_header X-Frame-Options DENY;
        proxy_pass http://127.0.0.1:3000;
    }
    location / {
        proxy_pass http://127.0.0.1:3000;
    }
}
```

::: details Solution
1. `listen 443 ssl http2` : syntaxe dépréciée → `listen 443 ssl;` + `http2 on;`.
2. `cert.pem` sans la chaîne → `fullchain.pem`.
3. L'`add_header` dans `/ws/` annule le HSTS hérité sur ce location. Et pas de `always`.
4. Websocket : pas de `proxy_http_version 1.1`, pas d'`Upgrade`/`Connection`, `proxy_read_timeout` par défaut (60 s).
5. Aucun `proxy_set_header` (`Host`, `X-Forwarded-For`, `X-Forwarded-Proto`) : l'app voit `127.0.0.1` comme IP client et `http` comme schéma. Et pas de bloc `listen 80` pour la redirection et le challenge ACME.
:::

**3. Écris la config Caddy.** `exemple.fr` sert un front statique dans `/srv/front` (SPA), et tout ce qui commence par `/api/` est envoyé à l'API sur `127.0.0.1:3000` **sans** le préfixe `/api`.

::: details Solution
```text
exemple.fr {
	encode zstd gzip

	handle_path /api/* {
		reverse_proxy 127.0.0.1:3000
	}

	handle {
		root * /srv/front
		try_files {path} /index.html
		file_server
	}
}
```

`handle_path` retire le préfixe correspondant (`/api/invoices` → `/invoices`). `handle` exclusif : un seul bloc s'applique. Bonus : plus besoin de CORS, front et API sont sur la même origine.
:::

**4. Certificat expiré.** Lundi matin, toutes les apps mobiles plantent : `certificate has expired`. Le serveur utilise Nginx + certbot depuis 1 an. Que s'est-il probablement passé, et comment éviter que ça recommence ?

::: details Solution
Le renouvellement automatique échoue depuis ~30 jours (certbot renouvelle à J-30) sans que personne ne le voie. Causes fréquentes : port 80 fermé ou redirigé sans exception pour `/.well-known/acme-challenge/`, DNS modifié, webroot changé, timer désactivé, ou le certificat a été renouvelé mais Nginx jamais rechargé (pas de `--deploy-hook`).

Diagnostic : `sudo certbot renew --dry-run`, `journalctl -u certbot`, `openssl s_client … | openssl x509 -noout -dates`.

Prévention : `--deploy-hook "systemctl reload nginx"`, une **alerte** sur l'expiration (blackbox exporter Prometheus `probe_ssl_earliest_cert_expiry`, ou un monitoring externe), et/ou passer à Caddy.
:::

**5. Rate limit injuste.** Après avoir mis Cloudflare devant ton Nginx, les clients reçoivent des `429` en rafale alors que chacun fait 2 requêtes/s. La zone est `$binary_remote_addr`, `rate=10r/s`. Explique et corrige.

::: details Solution
Nginx voit l'IP des serveurs de Cloudflare comme `$remote_addr` : des milliers de clients partagent quelques buckets.

```nginx
# liste des plages IP de Cloudflare (à maintenir à jour)
set_real_ip_from 173.245.48.0/20;
# ...
real_ip_header CF-Connecting-IP;
```

Avec `ngx_http_realip_module`, `$remote_addr` (et `$binary_remote_addr`) devient l'IP réelle, **uniquement** si la requête vient d'une plage de confiance. Ne jamais faire confiance à `X-Forwarded-For` venant de n'importe où : un client le forge et contourne la limite.
:::

## À retenir

- Le proxy termine TLS, route, limite, compresse ; l'app écoute en local.
- Caddy : HTTPS + HTTP/3 + renouvellement automatiques, websockets sans config.
- Nginx : `nginx -t` avant `reload`, `fullchain.pem`, `http2 on;`, headers `Upgrade` pour les websockets.
- `add_header` ne s'hérite pas si tu en redéclares un ; utilise `always`.
- Rate limit par IP seulement avec la vraie IP client (`real_ip`).
- Surveille l'expiration des certificats : un renouvellement peut échouer en silence.
