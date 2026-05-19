terraform {
  required_version = ">= 1.6.0"

  required_providers {
    hcloud = {
      source = "hetznercloud/hcloud"
      # `~> 1.50` accepts any 1.x ≥ 1.50, so minor bumps slip in on init.
      # Fine for cloud-dev; if you ever need this more stable, pin exact
      # (`version = "= 1.50.0"`) and keep .terraform.lock.hcl committed.
      version = "~> 1.50"
    }
  }
}

provider "hcloud" {
  token = var.hcloud_token
}

# ---- SSH key ---------------------------------------------------------------
# Heads-up: hcloud_ssh_key and hcloud_firewall names are scoped to the
# Hetzner *account*, not the project. Two `terraform apply`s with the same
# instance_name in the same account will collide on the second. The
# convention for Shape B is "one Hetzner project per instance" — or pick a
# unique instance_name each time.
resource "hcloud_ssh_key" "main" {
  name       = "safecare-cloud-${var.instance_name}"
  public_key = var.ssh_public_key
}

# ---- Firewall --------------------------------------------------------------
# 22 / 80 / 443 inbound. SSH is open by default; tighten via
# ssh_allowed_cidrs once you have a real allowlist.
resource "hcloud_firewall" "main" {
  name = "safecare-cloud-${var.instance_name}"

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = var.ssh_allowed_cidrs
  }

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "80"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "443"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  rule {
    direction  = "in"
    protocol   = "icmp"
    source_ips = ["0.0.0.0/0", "::/0"]
  }
}

# ---- Server ----------------------------------------------------------------
resource "hcloud_server" "main" {
  name        = "safecare-cloud-${var.instance_name}"
  image       = "ubuntu-24.04"
  server_type = var.server_type
  location    = var.location

  ssh_keys     = [hcloud_ssh_key.main.id]
  firewall_ids = [hcloud_firewall.main.id]

  # cloud-init is templated at apply time so the SSH public key + repo
  # source are baked into the user_data without committing them to the
  # repo verbatim.
  user_data = templatefile("${path.module}/../cloud-init/init.yaml", {
    ssh_public_key = var.ssh_public_key
    repo_url       = var.repo_url
    repo_branch    = var.repo_branch
  })

  labels = {
    project  = "safecare"
    instance = var.instance_name
    role     = "cloud-dev"
  }

  # Don't recreate the box just because cloud-init contents changed —
  # cloud-init only runs on first boot anyway, and rebuilding a server
  # loses any in-flight state. Forced recreation is opt-in via
  # `terraform taint hcloud_server.main`.
  lifecycle {
    ignore_changes = [user_data]
  }
}
