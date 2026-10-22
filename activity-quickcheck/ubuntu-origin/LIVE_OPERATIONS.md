# Ubuntu Activity: live operations and human-in-the-loop AI

This service has one authoritative local SQLite database and a private
materials directory. Cloudflare is a stateless HTTPS relay, not a D1/R2 copy.
On campus, browsers can route directly via HTTPS port 8443. Outside campus,
the public hostname relays requests back to the same Ubuntu process.

## Organizer credentials

- Staff login: https://activity.10273055.xyz/adminlogin
- Provisioned organizer user: organizer
- One-time randomly generated password stored ONLY in the local owner's
  ~/.config/bombax-activity-origin/admin-login.txt (mode 0600).
- Do not commit it, send it into chat, place it in the service env or create
  any shared/demo password. Password hashing is PBKDF2-SHA256 (450k rounds).
- The provided student name and number are self-declared, not SCUT SSO.

## Phone photos

- Guest registration holds a private bearer pass, sent only as an HTTPS POST
  or HttpOnly same-origin cookie. Keep it secret.
- Gallery selection or camera -> local canvas JPEG compression (75% quality)
  -> authenticated 3MB upload -> private Ubuntu materials directory.
- Limit: 3 images per active registration. Material download is authorized
  for the registration's private bearer holder or delegated reviewer/owner.
- Mobile camera formats depend on the phone's local decoder. JPEG/PNG always
  offered; WebP/HEIC supported when decoded by the browser.
- Client-side compression removes ordinary source file metadata. Users should
  crop unrelated conversations, avatars and other person's details.
- Staff can approve or reject manually; event-level minLikes controls the
  rule displayed alongside model-assisted visible-like extraction.

## DeepSeek V4.1 Flash

- Model name: deepseek-flash, endpoint: api.deepseek.com/chat/completions.
- To install a key securely, run as zyubuntu:
  bash /home/zyubuntu/scutbombax/scutBombax-real-photo-ai-20261023/activity-quickcheck/ubuntu-origin/configure-deepseek-key.sh
- The script prompts without echo, stores the key in
  ~/.config/bombax-activity-origin/deepseek.key (0600) and restarts only
  bombax-activity-origin.service. If no key exists, human review still works.
- Sending a registered student's images to DeepSeek requires that student's
  explicit, revocable opt-in and authenticated event owner/reviewer action.
- AI returns visibleLikeCount, minimumLikes, thresholdMet, uncertainty and
  evidence, without storing the API key or changing approval state.
- Screenshot authenticity, identity and post ownership CANNOT be verified
  by the model. Staff must decide. A user can revoke future AI processing;
  requests already sent to the external provider cannot be undone.

## Backups and incident response

- SQLite integrity checked local backup daily at 04:10 using online backup.
- Backup now expects the additive sixth schema migration for likes criteria.
- Existing local backups do not protect against device theft/disaster; add
  encryption and off-machine retention before handling large cohorts.
- If needing emergency rollback, restore the previous origin systemd unit
  and restart it; migration 0006 is additive. Do NOT delete any new student
  records or image files during rollback.
- Do not modify the unrelated audition HTTPS service on 443.
