# WireGuard — Ajouter un nouveau client (Windows)

> Tout se fait **sur le serveur**, en root. On génère la conf du client sur le serveur puis on l'importe dans l'application WireGuard sous Windows.

## Variables à adapter

| Variable      | Exemple               | Description                              |
|---------------|-----------------------|------------------------------------------|
| `CLIENT`      | `pc-thomas`           | Nom du client                            |
| `IFACE`       | `wg0`                 | Interface WireGuard du serveur           |
| `CLIENT_IP`   | `10.0.0.5`            | IP libre dans le sous-réseau VPN         |
| `ENDPOINT`    | `vpn.exemple.fr:51820`| IP publique / domaine + port du serveur  |

```bash
CLIENT=pc-thomas
IFACE=wg0
CLIENT_IP=10.0.0.5
ENDPOINT=vpn.exemple.fr:51820
```

## 1. Trouver une IP libre

```bash
wg show $IFACE allowed-ips        # IP déjà utilisées
grep -E 'Address|ListenPort' /etc/wireguard/$IFACE.conf   # sous-réseau + port du serveur
```

## 2. Générer les clés du client

```bash
mkdir -p /etc/wireguard/clients && cd /etc/wireguard/clients
umask 077
wg genkey | tee $CLIENT.key | wg pubkey > $CLIENT.pub
wg genpsk > $CLIENT.psk           # optionnel mais recommandé
```

## 3. Déclarer le client sur le serveur

Ajouter à la fin de `/etc/wireguard/$IFACE.conf` :

```bash
cat >> /etc/wireguard/$IFACE.conf <<EOF

[Peer]
# $CLIENT
PublicKey = $(cat $CLIENT.pub)
PresharedKey = $(cat $CLIENT.psk)
AllowedIPs = $CLIENT_IP/32
EOF
```

Appliquer **sans couper** les autres clients :

```bash
wg syncconf $IFACE <(wg-quick strip $IFACE)
```

> Alternative brutale : `systemctl restart wg-quick@$IFACE` (coupe tout le monde quelques secondes).

## 4. Créer le fichier de conf du client

```bash
cat > $CLIENT.conf <<EOF
[Interface]
PrivateKey = $(cat $CLIENT.key)
Address = $CLIENT_IP/32
DNS = 1.1.1.1

[Peer]
PublicKey = $(wg show $IFACE public-key)
PresharedKey = $(cat $CLIENT.psk)
Endpoint = $ENDPOINT
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
EOF
```

> ⚠️ **Ne pas confondre les deux `PublicKey`** : chaque côté met dans son `[Peer]` la clé publique **de l'autre**.
> - `wg0.conf` (serveur) → `PublicKey` = `$CLIENT.pub`
> - `$CLIENT.conf` (Windows) → `PublicKey` = `wg show $IFACE public-key` (clé du **serveur**)

**`AllowedIPs` côté client :**
- `0.0.0.0/0, ::/0` → **tout** le trafic passe par le VPN (full tunnel)
- `10.0.0.0/24, 192.168.1.0/24` → seulement les réseaux listés (split tunnel)

## 5. Installer sur Windows

1. Installer WireGuard : <https://www.wireguard.com/install/>
2. Récupérer `$CLIENT.conf` de façon sécurisée (ex. `scp root@serveur:/etc/wireguard/clients/pc-thomas.conf .`)
3. WireGuard → **Importer un tunnel depuis un fichier** → choisir le `.conf`
4. **Activer**
5. Supprimer le `.conf` du PC une fois importé (il contient la clé privée)

> Avec `AllowedIPs = 0.0.0.0/0`, Windows propose « Bloquer le trafic hors tunnel » (kill-switch).

## 6. Vérifier

Sur le serveur :
```bash
wg show $IFACE      # le peer doit avoir un "latest handshake" récent
```
Sur Windows (PowerShell) :
```powershell
ping 10.0.0.1                  # IP du serveur dans le VPN
curl.exe ifconfig.me           # doit renvoyer l'IP du serveur (si full tunnel)
```

## Dépannage rapide

| Symptôme                      | Piste                                                        |
|-------------------------------|--------------------------------------------------------------|
| Pas de handshake              | Port UDP fermé (firewall serveur / box), mauvais `Endpoint`, mauvaise clé publique |
| Handshake OK mais pas d'internet | `net.ipv4.ip_forward=1` + règle NAT/MASQUERADE manquante sur le serveur |
| Pas de résolution DNS         | Changer `DNS =` dans la conf client                          |
| Conflit d'IP                  | Deux peers avec la même `AllowedIPs` → vérifier l'étape 1   |

## Révoquer un client

```bash
wg set $IFACE peer $(cat /etc/wireguard/clients/$CLIENT.pub) remove
# puis supprimer le bloc [Peer] correspondant dans /etc/wireguard/$IFACE.conf
rm /etc/wireguard/clients/$CLIENT.*
```
