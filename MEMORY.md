# WABOT 2.0 Long-Term Memory & Learnings

This file documents the key milestones, architectural design patterns, and critical technical lessons learned during the development of the WABOT 2.0 ecosystem.

---

## Key Milestones

### v3.1.0 — Public Dashboard Summary
* **Achievement**: Implemented a public-facing landing portal (`/dashboard` index route) served dynamically before admin credentials check.
* **Technical Details**:
  * Designed a view state toggle (`viewMode`) inside Next.js pages to separate public traffic from admin consoles.
  * Rebuilt the Three.js-inspired 2D canvas background particle engine to support on-the-fly light mode theme adjustments (Slate theme token replacements).
  * Structured real-time counters, health indicators, lo-fi vinyl stream players, and Ctrl+K search command palettes.

### v3.0.0 — BotOS Architecture Rebuild
* **Achievement**: Resolved socket connection drops, integrated active database user/command metrics, and created provider inspection systems.
* **Technical Details**:
  * Established a single WebSocket singleton listener (`useSocket.ts`) shared across all client tabs, avoiding multiple handshake conflicts.
  * Added instant REST `/status` API endpoints that fetch active listeners, play queues, and CPU pings.
  * Migrated database queries into safe better-sqlite3 WAL modes to handle concurrent dashboard reads and WhatsApp message write streams.

---

## Lessons Learned & Best Practices

1. **Next.js SPA Asset Routing**:
   * *Problem*: Wildcard fallback redirect scripts in Express serve `index.html` with a `200` status code for missing asset files (e.g. `css`, `js`), triggering strict MIME type browser blockages.
   * *Solution*: Exclude paths containing `_next/` or files with active extensions (`path.extname(url)`) from wildcard redirections.

2. **WebSocket Connection Lifetime**:
   * *Problem*: Allocating socket instances per React component mount leads to connection flooding on route transitions.
   * *Solution*: Cache the connection in a module-level singleton pointer and share the state globally via Zustand stores.
