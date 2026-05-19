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
