# Terraform

Ce que tu vas apprendre : décrire ton infrastructure (VPS, DNS, bucket) en code avec Terraform ou OpenTofu, comprendre le state et son verrouillage, structurer en modules, lire un `plan` avant de l'appliquer, et éviter les pièges qui détruisent une base de prod.

## Pourquoi l'Infrastructure as Code

Créer un serveur dans une console web, c'est rapide la première fois. Six mois plus tard : personne ne sait quelles options ont été cochées, staging ne ressemble pas à la prod, et recréer l'ensemble après un incident prend une journée.

Avec l'IaC :

- l'infra est **versionnée** et **revue** en PR comme du code ;
- staging et prod sont créés par le **même code** avec des variables différentes ;
- le `plan` montre exactement ce qui va changer **avant** de le faire ;
- tout est **reproductible** (nouveau client, nouvelle région, reprise après sinistre).

Terraform est **déclaratif** : tu décris l'état voulu, il calcule les appels API pour y arriver. **OpenTofu** est le fork open source (licence MPL) créé quand HashiCorp est passé en licence BSL en 2023 : même langage (HCL), mêmes providers, commande `tofu` au lieu de `terraform`. Tout ce chapitre s'applique aux deux.

## Les briques

```hcl
terraform {
  required_version = ">= 1.10"
  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.50"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}

provider "hcloud" {}     # lit HCLOUD_TOKEN
provider "cloudflare" {} # lit CLOUDFLARE_API_TOKEN
```

- **Provider** : un plugin qui parle à une API (AWS, Hetzner, Cloudflare, GitHub, Postgres…). Versions épinglées avec `~>` (mineure libre, majeure bloquée).
- **Resource** : un objet géré (`hcloud_server`, `cloudflare_dns_record`).
- **Data source** : un objet **lu**, non géré (une zone DNS existante, une image).
- **Variable** / **output** / **local** : entrées, sorties, valeurs calculées.
- Les credentials passent par des **variables d'environnement**, jamais en dur dans le code.

`.terraform.lock.hcl` fige les versions exactes et les hashes des providers : **commite-le**.

## Le cycle de travail

```bash
terraform init          # télécharge providers, configure le backend
terraform fmt -recursive
terraform validate
terraform plan -out=tfplan
terraform apply tfplan  # applique EXACTEMENT ce plan
terraform output
terraform state list
terraform destroy       # rarement, et jamais en prod par réflexe
```

Lire un plan :

```text
  + create
  ~ update in-place
  - destroy
-/+ destroy and then create replacement

  # hcloud_server.api must be replaced
-/+ resource "hcloud_server" "api" {
      ~ image = "debian-12" -> "debian-13" # forces replacement
```

`forces replacement` sur un serveur ou une base = **destruction** puis recréation : données locales perdues, nouvelle IP. C'est la ligne à chercher dans chaque plan.

## Le state

Terraform garde dans un fichier **state** (`terraform.tfstate`) la correspondance entre ton code et les objets réels (IDs, attributs). Sans state, il ne sait pas que `hcloud_server.api` est le serveur `#4815162`.

Ce qu'il faut savoir :

- Le state contient des **secrets en clair** (mots de passe générés, clés, attributs sensibles). Il ne va **jamais** dans Git.
- En équipe et en CI, il doit être **distant** et **verrouillé** : deux `apply` simultanés sur le même state = corruption.

### Remote state avec verrouillage

Backend S3 (AWS ou compatible) avec verrouillage natif :

```hcl
terraform {
  backend "s3" {
    bucket       = "acme-tfstate"
    key          = "billing/prod/terraform.tfstate"
    region       = "eu-west-3"
    encrypt      = true
    use_lockfile = true
  }
}
```

- `use_lockfile = true` (Terraform ≥ 1.10, OpenTofu ≥ 1.10) crée un fichier `.tflock` dans le bucket. L'ancienne méthode via une table DynamoDB (`dynamodb_table`) est **dépréciée**.
- Active le **versioning** sur le bucket de state : un state corrompu se restaure depuis la version précédente.
- Alternatives : backend `gcs`, `azurerm`, HCP Terraform, ou les backends HTTP de GitLab.

Si un `apply` est tué en plein milieu, le verrou peut rester : `terraform force-unlock <LOCK_ID>`, **seulement** après avoir vérifié que personne d'autre ne tourne.

### Commandes de state

```bash
terraform state list
terraform state show hcloud_server.api
terraform import hcloud_server.api 4815162   # objet existant
terraform state rm cloudflare_dns_record.old # oublier sans détruire
```

Depuis Terraform 1.5, on préfère des blocs déclaratifs dans le code, revus en PR :

```hcl
import {
  to = hcloud_server.api
  id = "4815162"
}

moved {
  from = hcloud_server.api
  to   = module.app.hcloud_server.this
}
```

`moved` évite qu'un renommage ou un passage en module soit vu comme « détruire + créer ».

## Cas réel : VPS + DNS + bucket

L'infra de `billing-api` : un VPS Hetzner, l'enregistrement DNS chez Cloudflare, un bucket S3 pour les backups Postgres.

```hcl
# variables.tf
variable "env" {
  type = string
  validation {
    condition     = contains(["staging", "prod"], var.env)
    error_message = "env doit valoir staging ou prod."
  }
}

variable "server_type" {
  type    = string
  default = "cx23" # liste : hcloud server-type list
}

variable "ssh_public_key" { type = string }
variable "cloudflare_zone_id" { type = string }
```

Le serveur, avec firewall et une clé SSH :

```hcl
# server.tf
resource "hcloud_ssh_key" "deploy" {
  name       = "deploy-${var.env}"
  public_key = var.ssh_public_key
}

resource "hcloud_firewall" "web" {
  name = "web-${var.env}"
  dynamic "rule" {
    for_each = ["22", "80", "443"]
    content {
      direction  = "in"
      protocol   = "tcp"
      port       = rule.value
      source_ips = ["0.0.0.0/0", "::/0"]
    }
  }
  rule {
    direction  = "in"
    protocol   = "udp"
    port       = "443"
    source_ips = ["0.0.0.0/0", "::/0"]
  }
}
```

```hcl
resource "hcloud_server" "api" {
  name         = "billing-${var.env}"
  server_type  = var.server_type
  image        = "debian-13"
  location     = "fsn1"
  ssh_keys     = [hcloud_ssh_key.deploy.id]
  firewall_ids = [hcloud_firewall.web.id]
  user_data    = file("${path.module}/cloud-init.yaml")

  labels = { env = var.env, app = "billing" }

  lifecycle {
    prevent_destroy = true
    ignore_changes  = [user_data, image]
  }
}
```

- `user_data` (cloud-init) installe Docker, crée le user `deploy`, durcit SSH au **premier boot**. Le modifier ensuite forcerait un remplacement : `ignore_changes`.
- `prevent_destroy` : un plan qui voudrait le détruire **échoue**.

Le DNS :

```hcl
# dns.tf
resource "cloudflare_dns_record" "api" {
  zone_id = var.cloudflare_zone_id
  name    = var.env == "prod" ? "api" : "api-${var.env}"
  type    = "A"
  content = hcloud_server.api.ipv4_address
  ttl     = 300
  proxied = false
}

resource "cloudflare_dns_record" "api_v6" {
  zone_id = var.cloudflare_zone_id
  name    = cloudflare_dns_record.api.name
  type    = "AAAA"
  content = hcloud_server.api.ipv6_address
  ttl     = 300
  proxied = false
}
```

La référence `hcloud_server.api.ipv4_address` crée une **dépendance implicite** : Terraform crée le serveur avant le record.

Le bucket de backups (provider `aws`, configuré à part) :

```hcl
# backups.tf
resource "aws_s3_bucket" "backups" {
  bucket = "acme-billing-backups-${var.env}"
}

resource "aws_s3_bucket_versioning" "backups" {
  bucket = aws_s3_bucket.backups.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_public_access_block" "backups" {
  bucket                  = aws_s3_bucket.backups.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
```

```hcl
resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    id     = "expire-old-backups"
    status = "Enabled"
    filter {}
    expiration { days = 30 }
    noncurrent_version_expiration { noncurrent_days = 7 }
  }
}

output "server_ip" {
  value = hcloud_server.api.ipv4_address
}
```

Depuis le provider AWS v4, versioning, lifecycle et accès public sont des **ressources séparées** du bucket : les vieux exemples avec tout dans `aws_s3_bucket` ne marchent plus.

## Modules

Un **module** = un dossier de `.tf` avec des variables en entrée et des outputs. Pour ne pas dupliquer staging et prod :

```text
infra/
  modules/
    app-server/   # serveur + firewall + DNS
      main.tf variables.tf outputs.tf
  envs/
    staging/main.tf   # backend + module "app"
    prod/main.tf
```

```hcl
# envs/prod/main.tf
module "app" {
  source             = "../../modules/app-server"
  env                = "prod"
  server_type        = "cx33"
  ssh_public_key     = file("~/.ssh/deploy.pub")
  cloudflare_zone_id = "0123456789abcdef"
}

output "ip" { value = module.app.server_ip }
```

- Un **state par environnement** (dossiers séparés avec leur `key` de backend) : un `apply` raté en staging ne peut pas toucher la prod. Les **workspaces** CLI existent, mais le dossier par env est plus explicite et plus sûr.
- Modules publics : registry Terraform/OpenTofu. Épingle la version (`version = "~> 5.0"`) et lis ce qu'ils créent.
- Ne crée pas un module pour une seule ressource : l'abstraction doit apporter quelque chose.

## Terraform en CI

Le flux courant :

1. Sur PR : `fmt -check`, `validate`, `plan`, et le plan est posté en commentaire de la PR.
2. Revue humaine du plan, en cherchant `destroy` et `forces replacement`.
3. Merge sur `main` : `apply` du plan, derrière un environment GitHub protégé.
4. Credentials cloud via **OIDC** (cf. [CI/CD](/infra/05-ci-cd-github-actions)), pas de clés longues.

Outils complémentaires : `tflint` (règles par provider), `trivy config` ou `checkov` (mauvaises pratiques de sécurité : bucket public, SSH ouvert…), et un `plan` planifié chaque nuit pour détecter la **dérive** (quelqu'un a modifié quelque chose à la main).

## Pièges classiques

- Commiter `terraform.tfstate` ou `*.tfvars` contenant des secrets.
- State local en équipe : deux personnes, deux states, des ressources en double.
- `apply` sans relire le plan : le `-/+` sur la base de données.
- Modifier à la main dans la console : dérive, puis le prochain `apply` annule la modif.
- Renommer une ressource sans bloc `moved` : destruction + recréation.
- Providers non épinglés : une nouvelle majeure (Cloudflare v4 → v5, avec des ressources renommées) casse le `plan`.
- `count` sur une liste : retirer l'élément du milieu décale les index et recrée tout ce qui suit. Préfère `for_each` sur une map ou un set.
- Tout mettre dans un seul state géant : plans lents, rayon d'explosion énorme.

## Défis

**1. Lis ce plan.** Tu as juste ajouté un label `team = "billing"` sur le serveur, et le plan affiche :

```text
  # hcloud_server.api must be replaced
-/+ resource "hcloud_server" "api" {
      ~ labels    = { + "team" = "billing" }
      ~ user_data = "a3f…" -> "9c1…" # forces replacement
    }
Plan: 1 to add, 0 to change, 1 to destroy.
```

Que se passe-t-il et que fais-tu ?

::: details Solution
**Ne pas appliquer.** Le label serait un update in-place, mais `user_data` a changé (quelqu'un a modifié `cloud-init.yaml`) et ce champ force le remplacement : le serveur serait détruit et recréé, avec une nouvelle IP et sans les données locales.

Options : annuler la modif de `cloud-init.yaml` si elle n'était pas voulue, ou ajouter `lifecycle { ignore_changes = [user_data] }` puisque cloud-init ne sert qu'au premier boot. Relancer `plan` : il doit montrer `1 to change, 0 to destroy`. Et ajouter `prevent_destroy = true` sur la ressource.
:::

**2. Verrou bloqué.** `terraform plan` en CI échoue : `Error acquiring the state lock … Lock Info: ID: 7c1e…, Who: runner@fv-az123, Created: il y a 3 h`. Que fais-tu, dans l'ordre ?

::: details Solution
1. Vérifier qu'**aucun** job Terraform ne tourne (Actions en cours sur ce repo, collègue en local). Le verrou a 3 h : probablement un job tué (timeout, annulation).
2. Regarder si cet `apply` interrompu a laissé des ressources à moitié créées : `terraform plan` après déverrouillage le montrera.
3. `terraform force-unlock 7c1e…`.
4. Prévention : `concurrency` sur le workflow Terraform, `timeout-minutes` raisonnable, et ne jamais annuler un `apply` en cours.
:::

**3. Trouve les 5 problèmes.**

```hcl
provider "aws" {
  access_key = "AKIA..."
  secret_key = "wJalr..."
  region     = "eu-west-3"
}
resource "aws_s3_bucket" "backups" {
  bucket = "backups"
  acl    = "public-read"
}
resource "aws_instance" "web" {
  count         = length(var.names)
  ami           = "ami-0abc"
  instance_type = "t3.micro"
  tags          = { Name = var.names[count.index] }
}
```

::: details Solution
1. Clés AWS en dur dans le code : à révoquer **immédiatement** si c'est commité. → variables d'environnement, profil, ou OIDC en CI.
2. Pas de `terraform { required_providers }` : version du provider non épinglée.
3. Bucket de backups en `public-read` : données exposées. → `aws_s3_bucket_public_access_block` + pas d'ACL. Et l'argument `acl` inline est déprécié (ressource `aws_s3_bucket_acl`, et les ACL sont désactivées par défaut sur les nouveaux buckets).
4. Nom de bucket `backups` : les noms S3 sont **globaux** à tous les comptes AWS, il est forcément pris. → préfixe d'organisation + env.
5. `count` sur une liste de noms : retirer un nom au milieu décale les index et recrée les instances suivantes. → `for_each = toset(var.names)`.

Bonus : pas de backend distant, pas de versioning sur le bucket de backups.
:::

**4. Importer l'existant.** Le record DNS `status.exemple.fr` a été créé à la main dans Cloudflare. Tu veux le gérer en Terraform sans le recréer. Écris le code.

::: details Solution
```hcl
import {
  to = cloudflare_dns_record.status
  id = "<zone_id>/<dns_record_id>"
}

resource "cloudflare_dns_record" "status" {
  zone_id = var.cloudflare_zone_id
  name    = "status"
  type    = "CNAME"
  content = "statuspage.exemple-provider.io"
  ttl     = 300
  proxied = false
}
```

`terraform plan` doit afficher `1 to import, 0 to add, 0 to change`. S'il affiche un `change`, aligne ton code sur l'existant. `terraform plan -generate-config-out=generated.tf` peut écrire un premier jet du bloc `resource`. Le format exact de l'`id` dépend de la ressource : il est indiqué en bas de sa page de doc, section *Import*.
:::

**5. Staging a cassé la prod.** Un dev a lancé `terraform apply` dans `envs/staging`, et c'est la prod qui a été modifiée. Les deux dossiers ont le même bloc `backend "s3"`. Explique et corrige la structure.

::: details Solution
Même `bucket` **et** même `key` dans les deux backends → les deux dossiers partagent **un seul state**. Le code de staging a été appliqué sur les ressources de prod enregistrées dans ce state.

Correctif : une `key` distincte par env (`billing/staging/terraform.tfstate`, `billing/prod/terraform.tfstate`), idéalement des credentials distincts (le rôle de staging ne peut pas toucher aux ressources de prod), et la prod appliquée uniquement en CI derrière validation. Pour réparer : restaurer la version précédente du state depuis le versioning S3, puis `plan` des deux côtés.
:::

## À retenir

- IaC = infra versionnée, revue, reproductible ; Terraform et OpenTofu partagent le même langage.
- Le state est la source de vérité de Terraform : distant, verrouillé (`use_lockfile`), versionné, jamais dans Git.
- Lis chaque plan en cherchant `destroy` et `forces replacement` ; `prevent_destroy` sur ce qui est précieux.
- `import` et `moved` déclaratifs plutôt que des manipulations de state à la main.
- Un state par environnement, providers épinglés, `.terraform.lock.hcl` commité.
- `for_each` plutôt que `count` pour des collections nommées.
