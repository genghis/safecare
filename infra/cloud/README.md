# Cloud-dev scaffolding

Hosts a single shared "loaner" instance of SafeCare for product folks to
click through. Designed so that growing to multiple named instances on
one host is mechanical (every command takes `--instance <name>`,
defaulting to `dev`).

## Layout

```
infra/cloud/
├── README.md                  # this file
├── docker-compose.cloud.yml   # compose override (Caddy + drop host ports + namespace)
├── caddy/
│   └── Caddyfile              # TLS + basic auth + reverse proxy
├── scripts/
│   ├── _common.sh             # shared helpers (parse --instance, compose wrappers)
│   ├── reset-soft.sh          # wipe app data (postgres + redis); keep maps
│   ├── reset-hard.sh          # wipe everything; restore maps from snapshot if present
│   ├── snapshot-maps.sh       # tar nominatim + osrm volumes for fast restore
│   └── restore-maps.sh        # untar a previously-baked snapshot
├── terraform/                 # Phase 2: Hetzner box + firewall + DNS
└── cloud-init/                # Phase 2: first-boot setup (Docker, Caddy, repo clone)
```

## How an instance is laid out on disk

```
/opt/safecare/                     # the repo, cloned at first boot
/opt/safecare-snapshots/           # baked map tarballs (one per region we snapshot)
/var/lib/docker/volumes/           # docker manages all stateful volumes here;
                                   # named with the compose project prefix
                                   # (e.g. safecare-dev_pgdata)
```

## Quick reference

All scripts default `--instance dev` when omitted.

```bash
# Soft reset — keep map data, wipe app state
./scripts/reset-soft.sh

# Hard reset — wipe everything, restore maps from /opt/safecare-snapshots/maps-dev.tar.zst if present
./scripts/reset-hard.sh

# Bake a fresh map snapshot (run after the wizard finishes its provisioning)
./scripts/snapshot-maps.sh

# Restore from a snapshot file
./scripts/restore-maps.sh /opt/safecare-snapshots/maps-dev.tar.zst
```

## Running compose by hand

```bash
COMPOSE_PROJECT_NAME=safecare-dev \
  docker compose \
    -f docker/docker-compose.yml \
    -f infra/cloud/docker-compose.cloud.yml \
    --profile full \
    up -d
```

`COMPOSE_PROJECT_NAME` is what lets multiple named instances coexist on
one host — every volume and container name is prefixed by it.

## GitHub Actions workflows

All three are manual (`workflow_dispatch`). They serialize per-instance
via `concurrency.group: cloud-${instance}` so a reset can't stomp a
deploy mid-flight (or vice versa).

| Workflow | What it does |
|---|---|
| `cloud-deploy` | Waits for `bootstrap-ready`, writes `/etc/safecare/cloud-env`, checks out the chosen branch on the box, runs `deploy.sh`. |
| `cloud-reset-soft` | SSHes in and runs `reset-soft.sh`. Wipes app data, keeps maps. |
| `cloud-reset-hard` | SSHes in and runs `reset-hard.sh`. Wipes everything; restores from snapshot if present (toggle via input). |

## GitHub secrets you need to set

Settings → Secrets and variables → Actions → New repository secret:

| Secret | Value | Notes |
|---|---|---|
| `CLOUD_HOST` | IPv4 from `terraform output` | Or a DNS name pointing at it. |
| `CLOUD_SSH_PRIVATE_KEY` | contents of `~/.ssh/safecare-cloud` | The matching public key is in your `terraform.tfvars`. |
| `PRIMARY_HOST` | e.g. `dev.example.com` | Delivery dashboard hostname. DNS A record must point at `CLOUD_HOST`. |
| `RIDESHARE_HOST` | e.g. `rideshare-dev.example.com` | Rideshare dashboard hostname. |
| `DRIVER_HOST` | e.g. `driver-dev.example.com` | Driver PWA hostname (for phones). |
| `ADMIN_BCRYPT` | output of `docker run --rm caddy:2-alpine caddy hash-password --plaintext 'your-password'` | Bcrypt hash for the shared `admin` basic-auth user. |
| `ACME_EMAIL` | `you@example.com` | Let's Encrypt notification email. |

## End-to-end first deploy (the "tonight" path)

1. **Provision the box.**
   ```
   cd infra/cloud/terraform
   cp terraform.tfvars.example terraform.tfvars  # fill in
   terraform init && terraform apply
   ```
   Note the `ipv4_address` output.

2. **DNS.** Point `PRIMARY_HOST`, `RIDESHARE_HOST`, `DRIVER_HOST` at that
   IP. Wildcard `*.dev.<your-domain>` works too.

3. **GitHub secrets.** Set all seven secrets in the table above.

4. **Trigger `cloud-deploy`.** Actions tab → `cloud-deploy` → Run workflow,
   default branch `main`, default instance `dev`. First run takes longer
   (apt-upgrade + Docker images build); 10–15min is normal.

5. **Walk the wizard.** Visit `https://<PRIMARY_HOST>`, basic-auth as
   `admin` + your chosen password, complete the setup wizard.

6. **Bake a map snapshot** (optional but speeds up future hard-resets):
   ```
   ssh safecare@<box>
   cd /opt/safecare
   bash infra/cloud/scripts/snapshot-maps.sh
   ```

After that, the iteration loop is:
- Code change → `cloud-deploy` with that branch.
- App state weird → `cloud-reset-soft`.
- Want to test wizard end-to-end from a fresh DB → `cloud-reset-hard`.
