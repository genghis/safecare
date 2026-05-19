variable "hcloud_token" {
  description = "Hetzner Cloud API token (read+write scope)."
  type        = string
  sensitive   = true
}

variable "ssh_public_key" {
  description = "SSH public key authorized for the `safecare` user."
  type        = string
}

variable "instance_name" {
  description = "Short identifier for this cloud instance (dev/staging/etc)."
  type        = string
  default     = "dev"
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{0,30}$", var.instance_name))
    error_message = "instance_name must match ^[a-z0-9][a-z0-9-]{0,30}$ (matches the script-level validator)."
  }
}

variable "server_type" {
  description = <<-EOT
    Hetzner server type. Common picks in US datacenters:
      cpx21 — 3 vCPU AMD / 4 GB / 80 GB SSD — ~€7.55/mo  (tight but works for RI-sized maps)
      cpx31 — 4 vCPU AMD / 8 GB / 160 GB SSD — ~€13.10/mo (comfortable; default)
      cpx41 — 8 vCPU AMD / 16 GB / 240 GB SSD — ~€25/mo  (room for several named instances later)
    Stick to the cpx (AMD) line — cax (ARM) lacks images for Nominatim.
  EOT
  type        = string
  default     = "cpx31"
}

variable "location" {
  description = <<-EOT
    Hetzner location. US: ash (Ashburn, VA) or hil (Hillsboro, OR).
    EU: fsn1 (Falkenstein), nbg1 (Nuremberg), hel1 (Helsinki).
  EOT
  type        = string
  default     = "hil"
}

variable "ssh_allowed_cidrs" {
  description = "CIDRs allowed to reach port 22. Default open; tighten for prod-ish use."
  type        = list(string)
  default     = ["0.0.0.0/0", "::/0"]
}

variable "repo_url" {
  description = "Git URL to clone on first boot."
  type        = string
  default     = "https://github.com/genghis/safecare.git"
}

variable "repo_branch" {
  description = "Branch to check out on first boot."
  type        = string
  default     = "main"
}
