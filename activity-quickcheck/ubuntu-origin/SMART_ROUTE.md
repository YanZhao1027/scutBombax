# Bombax Activity: campus direct routing (October 2026)

## Topology and single authority

Campus Wi-Fi (10.195/16, 10.196/16, 10.197/16)
  -> DNS-only activity-lan.10273055.xyz -> 110.64.88.48:8443
  -> isolated TLS Nginx -> 127.0.0.1:8790
  -> Ubuntu SQLite and private materials.

Off-campus -> activity.10273055.xyz Cloudflare Custom Domain
  -> stateless Worker + internal Service Binding
  -> authenticated Tailscale Funnel HTTPS -> same 127.0.0.1:8790.

One writer. There is no CF D1/R2 mirroring or dual-write.

## Browser route decision

- Production /__route/decision returns mode:probe with LAN HTTPS origin when
  CAMPUS_ROUTE_ENABLED=true.
- Cloudflare cannot see a user's private 10.x address through campus NAT.
  Instead the browser probes HTTPS /__lan/health with no credentials, with a
  1300ms timeout and exact CORS allow-origin, and only redirects when healthy.
- Nginx allowlists 10.195/16, 10.196/16, 10.197/16 plus one local machine
  operator test address. Other source IPs receive 403.
- If LAN probing fails, public page stays on Cloudflare. QR fragments, /my,
  /admin, organizer login and Android app vault do not auto-switch.
- Once the LAN page loads, LAN watchdog can fall back to Cloudflare when LAN
  health fails or pages reload repeatedly. A navigation failure before any
  LAN content loads cannot be recovered automatically by LAN JavaScript;
  revisit activity.10273055.xyz manually.
- Host-only cookies are kept separate; users may need to re-login after
  switching origins. Do not widen cookie Domain.
- QR bearer passes always contain public canonical
  https://activity.10273055.xyz/#pass=<token> so they work outside campus.
- Student identifiers remain self-declared, and screenshots are private with manual review.

## DNS and certificate

- Cloudflare DNS zone 10273055.xyz has DNS-only A activity-lan ->
  110.64.88.48, TTL Auto; public activity remains Worker Custom Domain.
- Gray-cloud DNS reveals the dorm IPv4, without CF WAF protections.
- Separate container bombax-activity-campus-https listens on IP:8443 only.
  No edits to audition HTTPS (443), its certificate, its process or its DB.
- Browser-trusted Let's Encrypt DNS-01 certificate is stored privately in
  ~/.config/bombax-activity-origin/certbot/etc and is never committed.
- A user-systemd timer checks renewal daily at 03:35 and renews when under
  30 days remain. The currently available Cloudflare DNS credential from
  an existing local host installation is mounted read-only solely to create
  DNS challenges. Prefer a separately issued least-privilege DNS Edit token.
- Campus TLS routing to the normal LE API host is broken by local network
  rules; certbot can use the official current DNS CNAME target of the LE
  API with TLS verification still enabled. Renewal discovers that CNAME
  afresh, rejecting any unrelated hostname or invalid certificate.
- The local Nginx configuration source copy is campus-nginx.conf; the live
  mounted copy is outside Git.

## Verification

Run Node tests:
  node --test tests/*.test.mjs ubuntu-origin/tests/*.test.mjs cf-relay/tests/*.test.mjs

From campus phone:
  https://activity-lan.10273055.xyz:8443/__lan/health
  https://activity.10273055.xyz/

From cellular:
  https://activity.10273055.xyz/
  LAN should be inaccessible; route stays public.

The campus Wi-Fi port 8443 has not yet been verified on a real mobile phone.
Only local server TLS/CORS and off-campus-source 403 have passed.

## Emergency disable

Set CAMPUS_ROUTE_ENABLED to false in cf-relay/wrangler.prod.jsonc and
redeploy production Worker. No database migration is needed. This switches
the public page to Cloudflare without affecting Ubuntu data. Local Nginx
can be stopped separately without touching auditorium/audition services.
