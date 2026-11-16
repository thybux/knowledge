# Linux essentiels

Ce que tu vas apprendre : les commandes et concepts Linux qu'un dev back utilise pour faire tourner et déboguer un service en prod (processus, signaux, systemd, logs, permissions, disque, SSH, outils de debug).

## Processus et signaux

Un processus a un **PID**, un parent (**PPID**), un user, et des descripteurs de fichiers (fd 0/1/2 = stdin/stdout/stderr, puis sockets, fichiers…).

```bash
ps aux --sort=-%mem | head      # top mémoire
ps -o pid,ppid,stat,etime,cmd -p 1234
pgrep -af node                  # PID + ligne de commande
pstree -p | less                # arbre des processus
```

Colonne `STAT` à connaître : `R` running, `S` sleep (attente normale), `D` **uninterruptible** (souvent I/O disque/NFS bloquée), `Z` **zombie** (fini, mais le parent n'a pas fait `wait`).

### Les signaux qui comptent

| Signal | N° | Usage |
|---|---|---|
| `SIGTERM` | 15 | « Arrête-toi proprement » (défaut de `kill`) |
| `SIGINT` | 2 | Ctrl+C |
| `SIGKILL` | 9 | Mort immédiate, **non interceptable** |
| `SIGHUP` | 1 | Terminal fermé / souvent « recharge la conf » |

`systemd`, Docker et Kubernetes envoient **SIGTERM**, attendent un délai (90 s par défaut pour systemd, 10 s pour `docker stop`, 30 s pour K8s), puis **SIGKILL**. Ton app doit donc gérer SIGTERM : arrêter d'accepter des connexions, finir les requêtes en cours, fermer le pool DB.

```ts
// Node : graceful shutdown
const server = app.listen(3000);
process.on("SIGTERM", () => {
  server.close(async () => {
    await db.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
});
```

```rust
// Rust/Axum : with_graceful_shutdown
use tokio::signal::unix::{signal, SignalKind};

async fn shutdown() {
    let mut term = signal(SignalKind::terminate()).unwrap();
    tokio::select! {
        _ = term.recv() => {},
        _ = tokio::signal::ctrl_c() => {},
    }
}
// axum::serve(listener, app)
//     .with_graceful_shutdown(shutdown()).await?;
```

::: warning PID 1
Dans un conteneur, ton process est PID 1. Le noyau n'applique **pas** l'action par défaut des signaux au PID 1 : si tu n'installes pas de handler SIGTERM, il est ignoré, et tu attends le SIGKILL. Lance `node` directement (pas via `npm start`, qui ne relaie pas toujours bien les signaux) ou utilise `docker run --init` / `tini`.
:::

## systemd : faire tourner un service

Sur un VPS sans conteneurs (ou pour Docker lui-même), c'est systemd qui démarre, redémarre et loggue tes services. Un **unit file** pour le binaire Rust `ingest` :

```ini
# /etc/systemd/system/ingest.service
[Unit]
Description=Ingest API
After=network-online.target
Wants=network-online.target

[Service]
User=ingest
Group=ingest
WorkingDirectory=/opt/ingest
EnvironmentFile=/etc/ingest/env
ExecStart=/opt/ingest/ingest
Restart=on-failure
RestartSec=2
TimeoutStopSec=20
LimitNOFILE=65536
# Durcissement
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/ingest

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload       # après chaque modif du unit
sudo systemctl enable --now ingest # démarre + au boot
systemctl status ingest            # état + dernières lignes de log
sudo systemctl restart ingest
systemctl cat ingest               # unit effectif (avec overrides)
sudo systemctl edit ingest         # crée un override drop-in
systemctl list-units --failed
```

Points clés :

- `Restart=on-failure` redémarre si code de sortie ≠ 0 ou signal. `always` redémarre même après un exit 0.
- Si ça redémarre trop vite (5 fois en 10 s par défaut, `StartLimitBurst`/`StartLimitIntervalSec`), systemd abandonne : état `failed`, `start request repeated too quickly`.
- `EnvironmentFile` : fichier `KEY=value`, à mettre en `chmod 600` (il contient des secrets).
- Pas besoin de rediriger stdout vers un fichier : systemd capture stdout/stderr dans le **journal**.

## journalctl : lire les logs

```bash
journalctl -u ingest -f              # suivre en direct
journalctl -u ingest --since "10 min ago"
journalctl -u ingest -b              # depuis le dernier boot
journalctl -u ingest -p err          # priorité err et pire
journalctl -u ingest -n 200 --no-pager
journalctl -u ingest -o json-pretty  # avec métadonnées
journalctl -k                        # noyau (OOM killer !)
journalctl --disk-usage
sudo journalctl --vacuum-size=500M   # purger
```

::: tip OOM killer
Ton service meurt sans log applicatif ? Cherche `journalctl -k | grep -i -E "oom|killed process"`. Côté systemd, `status` affiche `code=killed, signal=KILL` et `Result: oom-kill`.
:::

## Users, groupes, permissions

Chaque service tourne avec **son propre user système**, sans shell, sans home utile :

```bash
sudo useradd --system --no-create-home \
  --shell /usr/sbin/nologin ingest
id ingest
sudo usermod -aG docker deploy   # ajout à un groupe (reconnexion !)
```

Permissions `rwx` pour user / group / others :

```bash
ls -l /etc/ingest/env
# -rw------- 1 ingest ingest 312 ... env
chmod 600 /etc/ingest/env        # rw pour le proprio seulement
chmod 750 /opt/ingest            # rwx user, r-x groupe, rien autres
chown -R ingest:ingest /var/lib/ingest
```

| Octal | Droits | Typique |
|---|---|---|
| `600` | `rw-------` | secrets, clé SSH privée |
| `644` | `rw-r--r--` | fichiers de conf publics |
| `755` | `rwxr-xr-x` | binaires, dossiers |
| `700` | `rwx------` | `~/.ssh` |

Sur un dossier, `x` = droit de le **traverser**. Sans `x` sur `/opt`, même un fichier `644` dedans est inaccessible.

`sudo` : donne des droits root ponctuels. Ne fais jamais tourner une app en root « parce que ça marche ».

## Disque

```bash
df -h                     # espace par filesystem
df -i                     # inodes (plein même avec de l'espace !)
du -sh /var/* | sort -h   # qui prend la place
du -xh --max-depth=1 / 2>/dev/null | sort -h | tail
ncdu /var                 # interactif, si installé
lsblk                     # disques et partitions
```

Les suspects habituels sur un serveur d'app : `/var/log`, `/var/lib/docker` (images, conteneurs arrêtés, logs JSON des conteneurs), le journal systemd, des dumps de DB oubliés dans `/tmp` ou `/root`.

```bash
docker system df                 # ce que Docker occupe
docker system prune              # conteneurs arrêtés, images dangling
docker image prune -a --filter "until=168h"
```

## SSH : clés, config, tunnels

Génère une clé moderne (ed25519), une par machine :

```bash
ssh-keygen -t ed25519 -C "thomas@laptop"
ssh-copy-id deploy@203.0.113.10
```

Le fichier `~/.ssh/config` évite de retaper les options :

```ssh-config
Host prod
  HostName 203.0.113.10
  User deploy
  IdentityFile ~/.ssh/id_ed25519
  IdentitiesOnly yes

Host db-interne
  HostName 10.0.1.5
  User deploy
  ProxyJump prod
```

`ssh db-interne` passe par `prod` (bastion) automatiquement.

### Tunnels

```bash
# Local forward : localhost:5433 -> postgres du serveur
ssh -N -L 5433:localhost:5432 prod
psql "postgres://app@localhost:5433/billing"

# Remote forward : exposer ton localhost:3000 sur le serveur
ssh -N -R 8080:localhost:3000 prod

# SOCKS proxy (navigateur via le serveur)
ssh -N -D 1080 prod
```

Le local forward est **le** moyen propre d'accéder à un Postgres de prod qui n'écoute que sur `127.0.0.1` : aucun port DB exposé sur Internet.

Côté serveur, dans `/etc/ssh/sshd_config` (ou un fichier dans `sshd_config.d/`) :

```text
PasswordAuthentication no
PermitRootLogin no
KbdInteractiveAuthentication no
```

Puis `sudo sshd -t` (vérifie la syntaxe) et `sudo systemctl reload ssh` (le nom du service est `ssh` sur Debian/Ubuntu, `sshd` sur RHEL). **Garde une session ouverte** pendant le test : si tu te verrouilles dehors, tu as encore une porte.

## Outils de debug

### htop / top : CPU, mémoire, load

```bash
htop            # F6 pour trier, F4 pour filtrer
uptime          # load average 1/5/15 min
free -h         # "available" est la vraie mémoire libre
vmstat 1        # r = runqueue, wa = attente I/O
```

Le **load average** compte les processus en `R` **et** en `D`. Un load de 8 sur 4 cœurs avec CPU à 10 % = attente I/O, pas un problème CPU. Regarde `wa` dans `vmstat` ou `iostat -x 1` (paquet `sysstat`).

### ss : sockets et ports

```bash
ss -tlnp                 # TCP en écoute + process
ss -tnp state established '( dport = :5432 )'
ss -s                    # résumé (beaucoup de TIME-WAIT ?)
```

« Address already in use » au démarrage ? `ss -tlnp | grep :3000` te donne le coupable.

### lsof : fichiers ouverts

```bash
lsof -p 1234 | wc -l          # nb de fd ouverts
lsof -i :3000                 # qui utilise le port
lsof +L1                      # fichiers supprimés mais ouverts
cat /proc/1234/limits | grep "open files"
```

### strace : ce que fait vraiment le process

```bash
sudo strace -p 1234 -f -tt -e trace=network
sudo strace -c -p 1234         # stats des syscalls (Ctrl+C)
strace -f -e trace=openat ./ingest 2>&1 | grep -v ENOENT
```

Idéal pour « le process est bloqué mais ne loggue rien » : tu vois s'il attend sur un `connect`, un `read`, un `futex`… À utiliser avec parcimonie en prod : `strace` ralentit fortement le process tracé.

## Cas réel

### « Le serveur est lent »

Le support signale que `billing-api` répond en 5 s au lieu de 100 ms. Démarche, du plus large au plus précis :

```bash
uptime                       # load ?
free -h                      # swap utilisée ?
vmstat 1 5                   # CPU us/sy/wa, si/so (swap)
htop                         # quel process ?
iostat -x 1 3                # %util disque, await
df -h && df -i               # disque plein ?
journalctl -k --since "1h ago" | tail   # OOM, erreurs I/O
ss -s                        # explosion de connexions ?
```

Lecture :

- **CPU 100 % en `us`** sur `node` : boucle chaude, regex catastrophique, JSON énorme. Profiler (`node --cpu-prof`), cf. [Performance Node](/dev/typescript/09-performance-node).
- **`wa` élevé** : le disque sature, souvent Postgres sur le même VPS ou des logs verbeux.
- **`si/so` non nuls** : on swappe, la machine manque de RAM.
- **Tout est calme côté machine** : le problème est ailleurs (DB lente, API tierce, pool de connexions épuisé). Passe aux traces/métriques, cf. [Observabilité](/infra/08-observabilite).

### « Disque plein »

Postgres refuse les écritures : `could not extend file: No space left on device`.

```bash
df -h                              # / à 100 %
sudo du -xh --max-depth=1 / | sort -h | tail -5
# -> /var 38G
sudo du -xh --max-depth=2 /var | sort -h | tail -5
# -> /var/lib/docker/containers 30G
sudo find /var/lib/docker/containers \
  -name "*-json.log" -size +1G -exec ls -lh {} \;
```

Un conteneur loggue en debug, et le driver `json-file` de Docker n'a **pas de rotation par défaut**. Correctif immédiat : `truncate -s 0 <fichier>` (ne pas `rm` : le fichier resterait ouvert et l'espace ne serait pas libéré). Correctif durable dans `/etc/docker/daemon.json` :

```json
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "50m", "max-file": "3" }
}
```

(Ne s'applique qu'aux conteneurs **recréés**.) Puis une alerte « disque > 80 % ».

::: danger Fichier supprimé, espace pas libéré
`rm` d'un gros log encore ouvert par un process : `df` ne bouge pas. `lsof +L1` le montre. Il faut redémarrer le process, ou `truncate` le fichier via `/proc/<pid>/fd/<n>`.
:::

## Pièges classiques

- Lancer l'app en root, ou `chmod 777` pour « régler » un problème de permission.
- Oublier `daemon-reload` après avoir modifié un unit file.
- Ne pas gérer SIGTERM : chaque déploiement coupe des requêtes en cours.
- `kill -9` en premier réflexe : pas de flush, pas de fermeture propre des connexions.
- Confondre `free` (RAM vraiment vide) et `available` (récupérable, cache compris).
- Changer la conf SSH et fermer sa seule session avant de tester.
- Oublier `df -i` : un dossier de sessions/cache avec des millions de petits fichiers épuise les inodes.

## Défis

**1. Restart en boucle.** `systemctl status ingest` affiche :

```text
Active: failed (Result: exit-code)
Process: 4120 ExecStart=/opt/ingest/ingest (code=exited, status=203/EXEC)
ingest.service: Start request repeated too quickly.
```

Que signifie `203/EXEC` et que vérifies-tu ?

::: details Solution
`203/EXEC` : systemd n'a **pas pu exécuter** le binaire (le process n'a jamais démarré). Causes : chemin faux, fichier sans bit `x`, mauvaise architecture (binaire compilé pour x86_64 sur un serveur ARM : erreur `Exec format error`), ou user `ingest` sans droit de traverser `/opt/ingest`.

```bash
ls -l /opt/ingest/ingest     # existe ? +x ?
file /opt/ingest/ingest      # architecture
sudo -u ingest /opt/ingest/ingest   # tester en tant que le user
journalctl -u ingest -n 20   # message exact
```

Après correction : `systemctl reset-failed ingest && systemctl start ingest`.
:::

**2. Port occupé.** Au démarrage : `Error: listen EADDRINUSE: address already in use :::3000`. Écris les commandes pour trouver et arrêter proprement le coupable.

::: details Solution
```bash
ss -tlnp | grep ':3000'
# LISTEN 0 511 *:3000 *:* users:(("node",pid=8812,fd=21))
ps -o pid,user,etime,cmd -p 8812
kill 8812          # SIGTERM d'abord
sleep 5; kill -0 8812 && kill -9 8812   # SIGKILL en dernier
```

Souvent c'est une ancienne instance lancée à la main (`nohup node dist/main.js &`) en plus du service systemd. Retiens : un seul gestionnaire de process.
:::

**3. Accès DB de prod.** Postgres tourne sur le VPS `prod` et n'écoute que sur `127.0.0.1:5432`. Tu veux lancer DBeaver sur ton laptop. Écris la commande, sans ouvrir de port sur le serveur.

::: details Solution
```bash
ssh -N -L 5433:127.0.0.1:5432 prod
```

DBeaver se connecte à `localhost:5433`. `-N` : pas de shell distant. Le `127.0.0.1` est résolu **côté serveur**. Ajoute `-f` pour passer en arrière-plan. Pour un accès d'équipe permanent, un VPN (WireGuard) est plus propre que des tunnels SSH individuels.
:::

**4. Trouve les 4 problèmes de ce unit file.**

```ini
[Unit]
Description=Billing API

[Service]
User=root
ExecStart=npm start
Environment=DATABASE_URL=postgres://app:S3cr3t@localhost/billing
Restart=always
```

::: details Solution
1. `User=root` : tourne en root. Crée un user système dédié.
2. `ExecStart=npm start` : chemin non absolu (systemd exige un chemin absolu ou cherche dans un PATH restreint) et `npm` ajoute un process intermédiaire qui relaie mal SIGTERM. Mets `ExecStart=/usr/bin/node /opt/billing/dist/main.js`.
3. Secret en clair dans le unit, lisible par tous via `systemctl show`/`systemctl cat`. Utilise `EnvironmentFile=/etc/billing/env` en `600` (ou `LoadCredential=`).
4. Pas de `WorkingDirectory`, pas de `[Install]` (donc `enable` ne marchera pas) ni de `After=network-online.target`. Bonus : aucun durcissement (`NoNewPrivileges`, `ProtectSystem`).
:::

**5. Lenteur mystère.** `uptime` : load average `9.8` sur 2 vCPU. `htop` : CPU à 15 %. Que se passe-t-il et quelles commandes lances-tu ?

::: details Solution
Load élevé avec CPU bas = processus en état `D` (attente I/O). Le disque (ou un montage réseau) sature.

```bash
vmstat 1 5          # colonne wa élevée, b > 0
iostat -x 1 3       # %util ~100 %, await élevé
ps -eo stat,pid,cmd | awk '$1 ~ /^D/'
sudo iotop -o       # qui écrit (si installé)
```

Coupables courants : Postgres qui fait un gros `VACUUM`/checkpoint sur le même disque, logs debug, backup qui tourne en journée, swap.
:::

## À retenir

- Ton service doit gérer SIGTERM ; SIGKILL arrive après le délai de grâce.
- systemd + journalctl suffisent pour faire tourner un binaire proprement, avec un user dédié et un `EnvironmentFile` en `600`.
- Diagnostic : `uptime` → `vmstat` → `htop` → `iostat` → `df -h`/`df -i` → `journalctl -k`.
- `ss -tlnp` et `lsof` répondent à « qui écoute / qui tient ce fichier ».
- SSH : clés ed25519, `~/.ssh/config`, `ProxyJump`, tunnels `-L` pour accéder aux services internes.
- Logs Docker sans rotation = disque plein garanti un jour.
