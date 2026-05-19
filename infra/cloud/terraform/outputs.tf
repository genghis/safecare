output "ipv4_address" {
  value       = hcloud_server.main.ipv4_address
  description = "Public IPv4. Point your DNS A records at this."
}

output "ipv6_address" {
  value       = hcloud_server.main.ipv6_address
  description = "Public IPv6."
}

output "server_name" {
  value = hcloud_server.main.name
}

output "ssh_command" {
  value       = "ssh safecare@${hcloud_server.main.ipv4_address}"
  description = "Convenience handle for shelling into the box."
}

output "dns_setup_hint" {
  value = <<-EOT

    Point three A records (or one wildcard) at ${hcloud_server.main.ipv4_address}:
      dev.<your-domain>            → delivery dashboard
      rideshare-dev.<your-domain>  → rideshare dashboard
      driver-dev.<your-domain>     → driver PWA
    Or one wildcard:
      *.dev.<your-domain>          → everything (recommended for Shape B later)

    Then run the deploy workflow with these values set as the PRIMARY_HOST,
    RIDESHARE_HOST, DRIVER_HOST secrets.

  EOT
}
