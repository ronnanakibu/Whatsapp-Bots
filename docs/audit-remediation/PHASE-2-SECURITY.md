# Phase 2 Report: Security Boundary Hardening (SEC-002 through SEC-007)

**Execution Date:** 2026-11-28  
**Branch:** `hardening/audit-remediation`  
**Status:** COMPLETED & VERIFIED (13/13 Phase 2 Security Tests Passed, 8/8 Phase 1 Tests Passed, 33/33 E2E Tests Passed)

---

## 1. Executive Summary

Phase 2 addressed the critical security boundary findings identified in the audit register:
- **`SEC-002` (Public QR / Pairing Leakage & Stale Artifacts):** Restricted QR/pairing code HTML and PNG endpoints to Control JWT authentication and eliminated stale `storage/qr.png` file fallback.
- **`SEC-003` (Tokenless Stream Bypass & JID Spoofing):** Separated `/stream` into an explicit public anonymous mode (with server-generated anonymous IDs) and a strictly verified one-time token mode.
- **`SEC-004` (Permission Delegation Escalation & Last-Owner Risk):** Enforced grant-authority validation preventing non-owners from delegating unauthorized or sensitive permissions, implemented Last-Owner protection, and automated session revocation upon permission/role mutation.
- **`SEC-005` (Template Secrets & Dual-Scope Collapse):** Enforced independent high-entropy production secrets (`>= 32` chars), eliminated usable placeholders in `.env.example`, and rejected shared `JWT_SECRET` fallback in production.
- **`SEC-007` (Server-Side Request Forgery via `.baca` and `.uptime`):** Introduced `safeOutboundUrl` with multi-tier IPv4/IPv6 private CIDR, loopback, link-local, and cloud metadata filtering, DNS resolution verification, redirect validation, and byte/timeout caps.

---

## 2. Detailed Technical Remediation

### 2.1 QR and Pairing Code Hardening (`SEC-002`)
- **Files:** `src/server/radio.js`, `src/core/bot.js`
- **Default Authentication:** Gated `/qr`, `/pairing`, `/code`, `/qr.png`, and `/qr/image` with `authenticateControlJwt` and `requirePermission(PERMISSIONS.WHATSAPP_PAIRING_READ)`.
- **Ephemeral Public Bootstrap Option:** Added an optional default-off flag (`process.env.ALLOW_PUBLIC_PAIRING === 'true'`) gated by a setup token for headless initial bootstrapping if needed.
- **Removed Stale Artifact Fallback:** Removed the `fs.existsSync('./storage/qr.png')` fallback in `/qr.png`. The route now only renders real-time active in-memory QR buffers.
- **Lifecycle Cleanup:** Updated `updateBotStatus('open' | 'close' | 'error' | 'logged_out')` and Baileys `connection.update` handlers in `bot.js` to automatically unlink `./storage/qr.png` immediately when connecting or disconnecting.

### 2.2 Audio Stream Authentication & Identity Model (`SEC-003`)
- **File:** `src/server/radio.js`
- **Explicit Modes:**
  1. **Public Anonymous Mode:** When no token is supplied, a server-generated anonymous ID (`anon_${randomBytes}`) is assigned. The route strictly ignores `?jid=` query parameters and request headers, preventing identity spoofing.
  2. **Authenticated Account Mode:** Requires a valid one-time token from `streamTokens`. Tokens are validated against expiry, immediately marked consumed (`tokenObj.consumed = true`), matched against User-Agent hashes, and deleted.
- **Zero Token Leakage:** Stream tokens are redacted in logs (`${tokenStr.slice(0, 4)}...`) to prevent token leakage in server logs.

### 2.3 RBAC Grant Authority & Last-Owner Protection (`SEC-004`)
- **Files:** `src/server/security/rbac.js`, `src/server/security/controlAuth.js`, `src/server/routes/control.js`
- **Grant-Authority Checks:**
  - Added `validateGrantAuthority(grantor, targetRole, extraPermissions)` to `createControlUser` and `updateControlUser`.
  - Non-owner administrators cannot assign the `owner` role.
  - Non-owners cannot delegate any permission they do not hold.
  - Non-owners cannot grant `OWNER_ONLY_PERMISSIONS` (`SECRETS_MANAGE`, `SYSTEM_RESTART`, `WHATSAPP_GROUP_BROADCAST`, `WHATSAPP_GROUP_LEAVE`, `USERS_MANAGE`).
  - Unknown permission strings are rejected with an error.
- **Last-Owner Protection:**
  - In `updateControlUser`, an active owner cannot be demoted or deactivated if they are the sole remaining active owner.
- **Session Invalidation:**
  - Updating a user's role, active status, or extra permissions instantly revokes all active sessions for that user (`control_sessions.revoked = 1`).

### 2.4 Cryptographic Secret Separation & Placeholder Elimination (`SEC-005`)
- **Files:** `src/server/security/controlAuth.js`, `.env.example`
- **Placeholder Detection:** Added `isPlaceholderSecret()` to detect and reject `replace_with_*`, `your_*`, `placeholder`, `example`, and known weak dictionary secrets.
- **Production Validation:**
  - `CONTROL_JWT_SECRET` and `RADIO_JWT_SECRET` must both be configured independently in production (`NODE_ENV === 'production'`).
  - Shared `JWT_SECRET` fallback is rejected in production.
  - Both secrets must be `>= 32` characters and non-identical.
- **Template Sanitization:** Emptied placeholder values in `.env.example` with clear instructions to generate 32-byte hex secrets.

### 2.5 Safe Outbound URL & SSRF Prevention (`SEC-007`)
- **Files:** `src/utils/safeOutboundUrl.js`, `src/commands/utility/baca.js`, `src/commands/utility/uptime.js`
- **SSRF Engine (`safeOutboundUrl.js`):**
  - Protocol allowlist restricted strictly to `http:` and `https:`.
  - Rejection of embedded URL credentials (`user:pass@host`).
  - Multi-range IP filtering covering:
    - Loopback (`127.0.0.0/8`, `::1`)
    - RFC 1918 Private ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`)
    - Link-local & Cloud Metadata (`169.254.0.0/16`, AWS/GCP/Azure metadata)
    - Carrier-grade NAT, Multicast, Reserved (`100.64.0.0/10`, `224.0.0.0/4`, etc.)
    - IPv6 Unique Local (`fc00::/7`), Link-local (`fe80::/10`), IPv4-mapped IPv6.
  - Asynchronous DNS resolution checking all returned IP addresses before connection.
  - Automated redirect tracking with destination re-validation (up to 3 redirects) and payload byte/time caps.
- **Command Integration:** Wired `safeFetch` into `.baca` and `.uptime`, returning user-friendly Indonesian error messages when internal destinations are requested.

---

## 3. Test Verification & Results

### 3.1 Security Regression Test Suite (`tests/security/phase2Security.test.js`)
Executed via: `node tests/security/phase2Security.test.js`

| Test ID | Description | Result |
| :--- | :--- | :---: |
| `SEC-005.1` | `isPlaceholderSecret` detects known template strings | **PASS** |
| `SEC-005.2` | Production rejects missing or placeholder secrets | **PASS** |
| `SEC-005.3` | Production rejects identical dual secrets | **PASS** |
| `SEC-005.4` | Production accepts distinct high-entropy secrets | **PASS** |
| `SEC-004.1` | Non-owner admin cannot delegate permissions outside their own set | **PASS** |
| `SEC-004.2` | Non-owner admin cannot grant sensitive owner-only permissions | **PASS** |
| `SEC-004.3` | Non-owner cannot assign the Owner role | **PASS** |
| `SEC-004.4` | Unknown permission strings are strictly rejected | **PASS** |
| `SEC-004.5` | Last-owner account cannot be demoted or deactivated | **PASS** |
| `SEC-007.1` | `isPrivateOrReservedIp` detects loopback, RFC1918, link-local and IPv6 | **PASS** |
| `SEC-007.2` | `validateSafeOutboundUrl` rejects internal, metadata, and invalid protocols | **PASS** |
| `SEC-007.3` | `validateSafeOutboundUrl` allows legitimate public URLs | **PASS** |
| `SEC-002.1` | `updateBotStatus` deletes `storage/qr.png` on connected or closed states | **PASS** |

**Summary:** 13 tests executed, 13 passed, 0 failed.

### 3.2 Regression Verification
- `phase1P0Containment.test.js`: 8/8 passed.
- Master E2E Test Suite (`npm test`): 33/33 passed in 10.78s.

---

## 4. Modified Files List

1. `src/server/radio.js`
2. `src/server/security/controlAuth.js`
3. `src/server/security/rbac.js`
4. `src/server/routes/control.js`
5. `src/core/bot.js`
6. `src/utils/safeOutboundUrl.js` (New utility)
7. `src/commands/utility/baca.js`
8. `src/commands/utility/uptime.js`
9. `.env.example`
10. `tests/security/phase2Security.test.js` (New test suite)
11. `docs/audit-remediation/PHASE-2-SECURITY.md` (New documentation)
