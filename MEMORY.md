# WABOT 2.0 Long-Term Memory & Learnings

This file documents the key milestones, architectural design patterns, and critical technical lessons learned during the development of the WABOT 2.0 ecosystem.

---

## Key Milestones

### v4.1.0 — Backend Production Foundation (v2.8 Rearchitecture)
* **Achievement**: Implemented hardened stream token access, dual-bounded SSE buffer replay mechanisms, structured envelopes for API v2, and bulk presence recovery on startup.
* **Technical Details**:
  * Added 5-minute TTL opaque UUID stream tokens with one-time consumption logic and a 60-second cleanup daemon.
  * Formulated multi-tier Soft IP validation to tolerate mobile NAT switches safely without allowing session theft.
  * Enforced double-bounded (10-minute/5,000 events) SSE buffer and recovery utilizing standard `Last-Event-ID` parsing.
  * Created an automated test suite (`verify_v28.js`) covering all security, routing, and SSE replay logic (39/39 passing).

### v5.0.0 — Radio Backend API v2 & Relational Database Rarchitecture
* **Achievement**: Completely rebuilt the live streaming engine backend from a simple monolithic status endpoint to a robust relational database schema and modular API v2.
* **Technical Details**:
  * Designed structured SQLite schema containing users, songs, play_history, requests, listening_sessions, reactions, favorites, achievements, and wrapped tables.
  * Decoupled status polling by creating specialized cache-friendly endpoints under `/api/v2/music/...`.
  * Implemented client-presence tracking on `/stream?jid=...` to measure listener engagement, distribute Experience Points (XP) dynamically, and evaluate achievements.

### v4.0.4 — Real-time Context & Agentic Command Router
* **Achievement**: Enabled temporal query awareness and natural language command execution via an agentic routing system and a keyword pre-router.
* **Technical Details**:
  * Built `getDynamicSystemPrompt()` to append real-time Date/Time context (GMT+7, Asia/Jakarta) dynamically to AI system instructions.
  * Implemented an agentic JSON parser (`processAiResponse`) to evaluate and execute command actions requested by AI.
  * Implemented a `tryDirectRoute` pre-router to check matching regex patterns (e.g., sticker creation, weather requests) and route commands directly, bypassing AI entirely for guaranteed 100% execution success.

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

3. **AI Formatting & Constraint Inconsistency**:
   * *Problem*: Depending solely on LLM prompt constraints to enforce structured JSON outputs is unreliable (especially for smaller models like Llama-3-70b/8b instruct under Groq), occasionally resulting in conversational text instead of command executions.
   * *Solution*: Deploy a keyword/regex-based pre-routing layer (`tryDirectRoute`) before the AI engine. If a message contains explicit keywords combined with the right context (e.g. "stiker" when replying to media), bypass the AI to execute the command directly. If it fails to match, fall back to agentic AI routing.

4. **Mobile App Stream Sessions & Loop Prevention**:
   * *Problem*: If external players or mobile apps connect to the `/stream` endpoint without a unique query JID, they get classified under the default `'anonymous'` JID, causing collision-based session termination on other connections (like the Discord bot's local stream connection). Additionally, enqueuing the `/stream` URL itself via song request API calls triggers self-referential download loops, leading to 100% CPU lockups and severe audio stuttering/choppiness.
   * *Solution*: Append a dedicated JID to client streams (`/stream?jid=android-app-client@s.whatsapp.net`) to separate mobile app connections from other clients. Bypassed song requesting logic on the mobile client when listening directly to the broadcast stream.
