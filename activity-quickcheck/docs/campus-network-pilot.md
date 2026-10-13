# HuaGongMuMian Activity Campus LAN Pilot

Status: network feasibility verified; no real-student campus activity backend has
been deployed. Do not reuse the admissions website database, private key,
business hostname, storage, or login cookies.

## Hardware/network verification (October 2026)

- Ubuntu is connected via authenticated SCUT wired Ethernet with static IPv4.
- A test Android 14 phone connects via SCUT student campus Wi-Fi.
- Phone-to-Ubuntu ICMP succeeded, with approximately 5 ms average latency.
- Phone reached the existing campus-only HTTPS site: HTTP 200 and valid TLS.
- The admissions HTTPS server disables camera and geolocation via
  Permissions-Policy. Those headers must NOT be copied into the activity site.
- Android Beta 2.0.0-beta.1 opens the separate HTTPS activity portal and
  correctly returns with Android Back.
- Browser geolocation currently fails indoors although the Android location
  toggle and Via browser's location permission are enabled. Keep the manual lane.
- Via Browser lacks Chrome Custom Tabs, but the Android intent fallback works.
  Camera permission is currently not granted to Via, and a physical optical
  QR camera scan has not passed yet.

## Recommended independent campus architecture

    Student + staff devices on campus Wi-Fi
                    |
            TLS, isolated hostname,
            campus-IP allowlist and rate limits
                    |
      activity-campus.<owned-domain>:443
                    |
           Dedicated HTTPS reverse proxy
                    |
          127.0.0.1:<independent-port>
                    |
       Node activity API / SQLite WAL / private
       evidence storage / staff audit / CSV

Never mount activities under the admissions website hostname. Browser cookies
are shared by hostname even when ports differ, so this would risk credential
mixing. Create an independent subdomain and properly issued TLS certificate.
Isolate the activity process and storage, without changing admissions services.

A campus IP allowlist does not replace identity confirmation. Browsers require
an HTTPS secure context for camera and geolocation. The activity-specific
Permissions-Policy can allow camera=(self) and geolocation=(self), with
frame-ancestors none, same-origin requests and CSRF protection.

## Business and consistency requirements

- Registration and picture review can continue while the event is in progress.
- Manual staff can witness arrival before proof is complete; later approval
  does not require a second queue or second scan.
- Scanner and reviewer permissions are separated; the scanner cannot fetch images.
- A 256-bit random QR token expires after 45 seconds, bound to one event and
  registration. Only a SHA-256 digest is persisted.
- Atomic unique attendance insert rejects simultaneous scanner replays.
- CSV candidates require human proof approval AND confirmed attendance.
- GPS and QR are imperfect identity signals; staff-assisted review is vital.
- Campus SQLite and Cloudflare D1 must not independently redeem the same
  event's tokens. Decide a single authoritative check-in writer and define
  event versioning and reconciliation before any replication.

## Tested and untested

Synthetic-only Cloudflare stage passed 38 real HTTPS requests including private
R2 upload/review, denied offsite/inaccurate test coordinates, QR issuance,
concurrent replay defense, manual-first late evidence and CSV. This is not a
real-phone GPS fix, camera optical decode, or 500-attendee load test.

Before real student use: create independent HTTPS hostname, harden backups,
retention/deletion, account verification and staff authorization; test campus
subnet access, service restart, browser permissions, handheld camera scanning,
and 500-person throughput. The university still awards official activity tickets.
