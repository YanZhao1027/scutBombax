# Ubuntu authoritative activity server (synthetic-only)

The current Cloudflare Worker business logic is executed on Ubuntu using a
local SQLite D1-compatible adapter and local private-file R2-compatible adapter.
Live mode accepts direct event applications and private evidence uploads; student identities are self-declared.

- Service: 127.0.0.1:8790 only. No public or campus plaintext listener.
- Database: $HOME/.local/share/bombax-activity-origin/activity.sqlite,
  SQLite WAL + FULL synchronous + foreign keys; all five D1 migrations applied
  transactionally to a new database.
- Materials: $HOME/.local/share/bombax-activity-origin/materials/.
- Public URL: https://activity.10273055.xyz (Cloudflare Tunnel).
- LAN URL: https://activity-lan.10273055.xyz:8443 (independent TLS listener).
- No automatic import or dual-writing to
  Cloudflare D1/R2; existing Stage is untouched.
- Startup requires Node >=22 and activity-quickcheck/node_modules.
- Do not start two copies of the authoritative process simultaneously.
- Authentication, staff roles, read/write operations and receipt invalidation
  are handled by the existing Worker with a single SQLite writer.
- Offsite backups must include consistent SQLite snapshots and material files.
- Organizers use independent strong passwords, guests use private QR capabilities; see LIVE_OPERATIONS.md for privacy and AI controls.

### Campus direct routing

See SMART_ROUTE.md for the three campus IP allowlists, the independently
trusted :8443 HTTPS gateway, browser probe, certificate renewal and emergency
disable. campus-nginx.conf is versioned; the live config is outside Git.
