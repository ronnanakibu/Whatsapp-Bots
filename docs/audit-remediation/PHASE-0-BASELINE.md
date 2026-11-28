# Phase 0 Baseline Report — WABOT 2.0 Hardening

**Date:** 2026-11-28  
**Branch:** `hardening/audit-remediation`  
**Starting Commit SHA:** `de7cce1cacbce6406d8435e1b82a79210d83046a`  
**Node Version (Local):** `v24.18.0` | **npm:** `11.16.0`  
**Node Version (Production Container):** `v20.20.2`  

---

## 1. Snapshot Revalidation

Comparing current `HEAD` (`de7cce1`) against the audited snapshot (`de7cce1`):
- Exact SHA match: The audited snapshot is 100% identical to the current repository HEAD.
- Findings in `02_FINDINGS_REGISTER.md` were directly inspected in the source tree:
  - **SEC-001 (P0):** `src/commands/ai/cook.js` & `src/services/dynamicSkills.js` pass real `sock`, `db`, `store` into `vm.createContext`. Confirmed.
  - **DATA-001 / REL-001 (P0 / P1):** `start.js` runs `migrateArchivesToTelegram()` before `validateEnv()` and calls `fs.unlinkSync` unconditionally after upload catch block. Confirmed.
  - **SEC-002 (P1):** `src/server/radio.js` routes `/qr`, `/pairing`, `/code`, `/qr.png` are public without TTL check or automatic cleanup. Confirmed.
  - **SEC-003 (P1):** `src/server/radio.js` `/stream` route has `if (shouldBypass && !tokenStr)` where `shouldBypass` contains `|| !tokenStr`, allowing any tokenless request to bypass auth. Confirmed.
  - **SEC-004 (P1):** `src/server/routes/control.js` accepts arbitrary `extraPermissions` without checking whether the calling Admin possesses or is authorized to delegate those permissions. Confirmed.
  - **SEC-005 (P1):** `src/server/security/controlAuth.js` placeholder denylist does not catch `replace_with_...` templates and allows shared fallback in production. Confirmed.
  - **SEC-006 (P1):** `src/services/sessionSync.js` archives and uploads `session.tar.gz` and `main.db` without client-side encryption. Confirmed.
  - **SEC-007 (P1):** `src/commands/utility/baca.js` and `uptime.js` perform outbound HTTP requests without private IP / loopback / cloud metadata blocking. Confirmed.
  - **REL-002 (P1):** Schedulers in `src/commands/general/remindme.js`, `cuaca.js`, `recap.js`, `storySync.js`, `scheduleSync.js` cache the initial socket in module closures protected by `_schedulerStarted`. Reconnects create new sockets that aren't propagated. Confirmed.
  - **DATA-002 (P1):** `src/services/user-v2.js` and `src/server/routes/auth.js` treat PostgreSQL UUID as a WhatsApp `jid`, while SQLite queries check `includes('@')`. Confirmed.

---

## 2. Test Harness Baseline

The repository test runner (`npm test` -> `node tests/e2e/runAll.js`) was executed:
- **Tiers 1-4:** 33 tests across 4 suites.
- **Result:** 33 pass, 0 fail, 0 skipped. Duration: ~33s.
- **Safety Boundary:** All existing tests use `mockSocket`, in-memory/temp state, and do not connect to production WhatsApp or databases.

---

## 3. Planned Remediation Order

- **Phase 1 (P0 Containment):**
  - Disable raw JS execution in `dynamicSkills.js` by default (`ENABLE_DYNAMIC_SKILL_EXECUTION=false`).
  - Convert `.cook` to a safe workflow proposal mechanism using strictly registered tool IDs.
  - Fix `migrateArchivesToTelegram()` in `start.js`: load config before migration, only delete files on verified Telegram delivery, preserve files on error.
- **Phase 2 (P1 Security Boundaries):**
  - Secure `/qr`, `/pairing`, `/qr.png` behind `authenticateControlJwt` + `WHATSAPP_PAIRING_READ` (with optional explicit ephemeral bootstrap mode if enabled).
  - Enforce clean anonymous vs authenticated `/stream` semantics.
  - Reject placeholder secrets and shared fallbacks in production.
  - Implement grant authority checks on `extraPermissions` in `control.js`.
  - Implement `SafeOutboundUrl` guard against SSRF in `.baca` and `.uptime`.
- **Phase 3 (P1 Data & Radio Integrity):**
  - Canonical `appUserId` UUID model with linked external identities (WhatsApp JID/LID).
  - Fix Radio Spotify origin provider mapping and SQLite source constraints.
  - Ensure idempotent stream finalization and correct playback timestamps.
- **Phase 4 (P1 Lifecycle & Schedulers):**
  - Implement `CurrentSocketProvider` to provide live Baileys socket references across reconnects.
  - Add start/stop/update lifecycle to all schedulers.
  - Make `store.bind()` idempotent.
- **Phase 5 (AI & Commands):**
  - Typed tool registry for AI.
  - Fix Translate API parameters.
  - Invalidate tool schemas on command permission changes.
- **Phase 6 (CI, Packaging & Release):**
  - Validate package.json scripts, Dockerfile, and log retention.
- **Phase 7 (Final Independent Verification):**
  - Full test matrix verification against `05_TEST_MATRIX.md`.
