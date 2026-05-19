# SafeCare cloud-dev Terraform

Provisions a single Hetzner Cloud box that runs the SafeCare stack. Box
setup itself happens via `cloud-init/init.yaml` baked in as `user_data`.

## One-time engineer setup

1. **Hetzner account.** https://console.hetzner.cloud → create a project.
   Under *Security → API tokens*, generate a read+write token. This is your
   `hcloud_token`.

2. **SSH key.** Generate one specifically for this box (don't reuse your
   personal key — different blast radius):
   ```
   ssh-keygen -t ed25519 -f ~/.ssh/safecare-cloud -C safecare-cloud-dev
   ```

3. **Configure.**
   ```
   cd infra/cloud/terraform
   cp terraform.tfvars.example terraform.tfvars
   # edit terraform.tfvars: paste your hcloud_token and ssh_public_key
   ```
   The example takes the SSH key as a literal string. If you prefer to
   read it from a file, replace that line with:
   ```hcl
   ssh_public_key = file("~/.ssh/safecare-cloud.pub")
   ```

4. **Apply.**
   ```
   terraform init
   terraform apply
   ```
   Outputs include the public IPv4 and an `ssh_command` for convenience.

## After `apply` succeeds

The box is up but the SafeCare stack is **not running yet**. cloud-init has
installed Docker, cloned the repo, generated `.env`, and prepared
`/opt/safecare-snapshots/`. Next steps (Phase 3 deploy workflow):

1. Point DNS at the IP — `dev`, `rideshare-dev`, `driver-dev` subdomains
   (or one wildcard `*.dev`).
2. Run the deploy workflow with the Caddy env vars (PRIMARY_HOST,
   RIDESHARE_HOST, DRIVER_HOST, ADMIN_BCRYPT, ACME_EMAIL).
3. The first deploy runs `docker compose up -d --build` and Let's Encrypt
   provisions TLS certs as soon as Caddy receives a request on each host.

## State

This module uses **local state** by default. Whoever runs `apply` owns the
`terraform.tfstate` file — gitignored, but losing it means you can't safely
re-apply or `destroy` without manual import.

When a second engineer needs to share the project, migrate to a shared
backend. The cheapest path:

```hcl
# in main.tf
terraform {
  cloud {
    organization = "your-org"
    workspaces { name = "safecare-cloud-dev" }
  }
}
```

HCP Terraform free tier (≤500 managed resources) is more than enough.

## Tearing down

```
terraform destroy
```

This removes the server, firewall, SSH key, and any other Hetzner
resources. **It does NOT touch DNS records** — those live wherever your DNS
provider is. It also does NOT remove map snapshots; those are local to the
box and die with it.
