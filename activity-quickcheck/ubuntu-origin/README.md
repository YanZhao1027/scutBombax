# Ubuntu authoritative activity server (synthetic-only)

The current Cloudflare Worker business logic is executed on Ubuntu using a
local SQLite D1-compatible adapter and local private-file R2-compatible adapter.
This is an isolated development deployment; **NO real student data**.

- Service: 127.0.0.1:8790 only. No public or campus plaintext listener.
- Database: $HOME/.local/share/bombax-activity-origin/activity.sqlite,
  SQLite WAL + FULL synchronous + foreign keys; all five D1 migrations applied
  transactionally to a new database.
- Materials: $HOME/.local/share/bombax-activity-origin/materials/.
- Public URL: https://activity.10273055.xyz (Cloudflare Tunnel).
- LAN URL: https://activity-lan.10273055.xyz:8443 (independent TLS listener).
- All student data is synthetic. No automatic import or dual-writing to
  Cloudflare D1/R2; existing Stage is untouched.
- Startup requires Node >=22 and activity-quickcheck/node_modules.
- Do not start two copies of the authoritative process simultaneously.
- Authentication, staff roles, read/write operations and receipt invalidation
  are handled by the existing Worker with a single SQLite writer.
- Offsite backups must include consistent SQLite snapshots and material files.
- Real student usage requires verified authentication and a separate review.
