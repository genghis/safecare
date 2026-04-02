# Remote Access Deployment

SafeCare should not expose the full admin/dashboard surface to the public internet.

The safest practical split is:

- **Admins** reach SafeCare over a private tailnet.
- **Drivers** use a separate public hostname that exposes only the driver PWA, driver auth, driver route APIs, tiles, and required webhooks.

This document describes two workable deployment patterns:

1. **Recommended for most orgs:** Tailscale for admin access + Cloudflare Tunnel for the public driver host.
2. **Simplest all-in-one option:** Tailscale for admin access + Tailscale Funnel for the public driver host.

## Recommended Topology

Use two different hostnames:

- `admin.<org-domain>` or a private tailnet hostname for the dashboard
- `driver.<org-domain>` for drivers and inbound webhooks

The public driver host should expose only:

- `/`
- static PWA assets
- `/api/auth/driver/request-otp`
- `/api/auth/driver/verify-otp`
- `/api/driver/*`
- `/api/tiles/*`
- `/api/health`
- `/api/webhooks/twilio/sms`
- `/api/webhooks/jotform` if you use the public JotForm webhook

It should **not** expose:

- `/api/auth/admin/*`
- `/api/dashboard/*`
- `/api/recipients/*`
- `/api/drivers/*`
- `/api/deliveries/*`
- `/api/distribution/*`
- `/api/settings/*`
- any other admin-only API surface

## Required Environment Variables

For a split-host deployment, set these explicitly:

```env
# Public origin used for Twilio signature validation and route tile URLs
PUBLIC_BASE_URL=https://driver.example.org

# Admin dashboard frontend -> API base
NEXT_PUBLIC_API_URL=https://admin.example.org

# Driver PWA frontend -> API base
VITE_API_URL=https://driver.example.org
```

Notes:

- `PUBLIC_BASE_URL` is important. SafeCare uses it when reconstructing externally visible webhook URLs and when generating route tile URLs for the driver app.
- `NEXT_PUBLIC_TILE_URL_TEMPLATE` and `VITE_TILE_URL_TEMPLATE` can usually stay blank. The apps now derive tile URLs from the configured API base.
- `TILE_DOWNLOAD_URL_TEMPLATE` can usually stay blank too. SafeCare serves tiles from local storage by default; only set it if you intentionally want missing tiles to be backfilled from another tile source.

## Option A: Tailscale + Cloudflare Tunnel

This is the best fit if:

- the nonprofit wants a normal public URL like `driver.example.org`
- admins are comfortable installing Tailscale once on their laptops/phones
- you want the office SafeCare box to avoid inbound port-forwarding

### Admin Access

Put the SafeCare host and admin devices on the same Tailscale tailnet.

Admins then access the dashboard over Tailscale only. The dashboard does not need to be public.

### Driver Access

Run `cloudflared` on the SafeCare host and publish only `driver.example.org`.

Use ingress rules so Cloudflare sends only the driver surface to the backend and PWA.

Example `cloudflared` ingress:

```yaml
ingress:
  - hostname: driver.example.org
    path: /api/auth/driver/.*
    service: http://127.0.0.1:3001
  - hostname: driver.example.org
    path: /api/driver/.*
    service: http://127.0.0.1:3001
  - hostname: driver.example.org
    path: /api/tiles/.*
    service: http://127.0.0.1:3001
  - hostname: driver.example.org
    path: /api/health
    service: http://127.0.0.1:3001
  - hostname: driver.example.org
    path: /api/webhooks/twilio/sms
    service: http://127.0.0.1:3001
  - hostname: driver.example.org
    path: /api/webhooks/jotform
    service: http://127.0.0.1:3001
  - hostname: driver.example.org
    service: http://127.0.0.1:5173
  - service: http_status:404
```

This keeps the public hostname narrowly scoped and avoids exposing backend port `3001` directly.

### Why this is the preferred setup

- no router port-forwarding in the nonprofit office
- public TLS is handled by Cloudflare
- custom public hostname for drivers
- admin surface stays private on the tailnet

## Option B: Tailscale + Tailscale Funnel

This is the easiest option if:

- the org is fine using a `*.ts.net` public driver URL
- you want one vendor for both admin and public driver access

### Admin Access

Use Tailscale only. Admins access the SafeCare dashboard from the tailnet.

### Driver Access

Expose a **driver-only local listener** through Tailscale Funnel. Do not funnel the full dashboard/backend host.

The cleanest way is to put a small reverse proxy in front of the public driver surface and only publish that listener.

Example Caddyfile for a driver-only listener on `127.0.0.1:8443`:

```caddy
http://127.0.0.1:8443 {
  @driver_api path /api/auth/driver/* /api/driver/* /api/tiles/* /api/health /api/webhooks/twilio/sms /api/webhooks/jotform
  reverse_proxy @driver_api 127.0.0.1:3001
  reverse_proxy 127.0.0.1:5173
}
```

Then point Tailscale Funnel at that driver-only listener instead of the raw SafeCare services.

This preserves the same rule as the Cloudflare setup: public internet reaches only the driver surface, not the admin/dashboard surface.

## Admin Setup Checklist

For a non-technical org, the smoothest install flow is:

1. Boot SafeCare normally.
2. Complete local setup and unlock.
3. Install and sign in to Tailscale on the SafeCare host.
4. Add admin users to the tailnet.
5. Choose one:
   - Cloudflare Tunnel for `driver.example.org`
   - Tailscale Funnel for the public driver URL
6. Set `PUBLIC_BASE_URL`, `NEXT_PUBLIC_API_URL`, and `VITE_API_URL`.
   7. Restart the frontend/backend services.
8. Verify:
   - admin login works over the private admin hostname
   - driver login works over the public driver hostname
   - route download returns tile URLs on the public hostname
   - Twilio webhook validation works using the public hostname

## Merge / Release Checklist

Before calling networking "production ready", verify all of these:

- The public hostname exposes only the allowlisted driver and webhook paths.
- `PUBLIC_BASE_URL` matches the actual public driver origin.
- Admin login is not reachable from the public hostname.
- Driver route download on the public hostname returns `tileUrls` pointing back to the SafeCare host, not a third-party CDN.
- Twilio webhook requests succeed with signature validation enabled.
- JotForm webhook uses the shared secret and only if you truly need public intake.

## Frontend Behavior Behind a Reverse Proxy

The dashboard and driver PWA now prefer same-origin API requests automatically when served from a non-development port. That means:

- `https://admin.example.org` can proxy both dashboard and backend on the same hostname
- `https://driver.example.org` can proxy both PWA and backend on the same hostname

For split-host production deployments, still set `NEXT_PUBLIC_API_URL` and `VITE_API_URL` explicitly so the build output is unambiguous.

## Official References

- Tailscale Funnel: <https://tailscale.com/docs/features/tailscale-funnel>
- Tailscale Serve: <https://tailscale.com/docs/features/serve>
- Cloudflare Tunnel: <https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/>
- Caddy reverse proxy: <https://caddyserver.com/docs/caddyfile/directives/reverse_proxy>
