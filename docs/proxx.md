# proxx panel fork

This repository is `iamkunal9/proxx-panel`, a fork of
`router-for-me/Cli-Proxy-API-Management-Center`. It is the management UI for
proxx (a fork of CLIProxyAPI; backend source lives at `../proxx`).

The fork has two parts:

1. A **reskin**: a Linear-style theme, dark by default, plus proxx branding.
2. **New pages** for fork-only backend features: Spend & usage, Model groups, Pricing, Requests and Updates.

Both parts are designed so that `git merge upstream/main` keeps working with few or no conflicts.

## Syncing upstream

```bash
git fetch upstream
git merge upstream/main
bun install --frozen-lockfile && bun run verify
```

If a merge conflicts, it will almost always be in one of the one-line hook points listed below.
Keep the upstream side and re-add the proxx line.

## Reskin: where the theme lives

| File | What proxx changes |
| --- | --- |
| `src/styles/proxx-theme.scss` (new) | All theme tokens for `:root` (light), `[data-theme='white']` and `[data-theme='dark']`, the inlined Inter font, and a thin restyle of buttons, inputs, cards, modals, the sidebar, the header pills and tooltips. It reuses upstream token *names*, so every upstream page follows the theme. |
| `src/styles/global.scss` | One `@use './proxx-theme.scss';`, loaded last so it wins the cascade. |
| `src/styles/variables.scss` | Compile-time SCSS colours (`$primary-color` etc.) and the Inter-first font stack. |
| `src/stores/useThemeStore.ts` | The default theme is `dark` (a choice the user saved still wins). |
| `index.html` | `data-theme="dark"` (prevents a light flash), title and favicon. |
| `src/components/layout/MainLayout.tsx` | Theme preview card colours, brand name, sidebar entries for the new pages, and `/requests` reusing the fixed-height logs layout (`isLogsPage`). |
| `src/assets/proxxLogo.ts` (new) | The inline SVG brand mark. Login, sidebar, System page and favicon import it in place of `logoInline`. |
| `src/pages/login/DotMatrixHero.tsx`, `src/pages/LoginPage.tsx`, `src/main.tsx` | Brand strings only. |
| `src/i18n/locales/*.json` | `title.*`, `splash.title`, `sidebar.subtitle` and `system_info.about_title` rebranded. All new keys sit in one top-level `proxx` block at the end of each file. |

The upstream `themes.scss`, `layout.scss` and `components.scss` are untouched. To change the look,
edit `proxx-theme.scss` only.

Design language: near-black neutral greys (dark: page `#0a0a0c`, surfaces `#111113`, hairline
borders `#232327`), one indigo accent `#5e6ad2`, 6–10px radii, Inter at 13–14px, soft shadows.
Focus rings use `--proxx-focus-ring`. Motion reuses `--ease-out-strong`, `--dur-hover` and
`--dur-press`, and is disabled under `prefers-reduced-motion`.

Inter is bundled with `@fontsource-variable/inter` (latin subset only, about 48 KB). It is inlined
into the single-file `management.html`, so the panel never loads fonts from the network. Other
scripts fall back to the system font.

## New pages

All new code is in new files:

- `src/features/spend/`
- `src/features/modelGroups/`
- `src/features/pricing/`
- `src/features/requests/`
- `src/features/update/`
- `src/components/proxx/` (shared page primitives, formatters and icons)
- `src/services/api/proxx*.ts` (API modules and normalization)
- `src/types/proxx.ts`

Routes are added in `src/router/MainRoutes.tsx`. The dashboard renders `<SpendStrip />` with one
line in `src/features/dashboard/DashboardPage.tsx`. The Logs page error-log tab has a one-line link
to `/requests` (`src/features/logs/LogsPage.tsx`). `MainLayout.tsx` renders `<UpdatePill />` in the header
actions and an Updates entry in the Control group (both one-line `// proxx` hooks).

Each page calls `/v8/management/proxx/*` through the shared `apiClient`. A 404 (or 501) means the
backend is not a proxx build. In that case the page shows a "Requires the proxx backend" state,
and the dashboard strip renders nothing.

### Spend & usage (`/#/spend`)

- `GET /proxx/usage/summary?from=YYYY-MM-DD&to=YYYY-MM-DD&group_by=model|provider|api_key|day`
  → `{from, to, totals:{requests, failures, input_tokens, output_tokens, cached_tokens, reasoning_tokens, cost_usd, unknown_cost_requests}, rows:[{key, ...same}]}`
- `GET /proxx/usage/recent?limit=N`
  → `{items:[{timestamp, model, alias, provider, api_key, failed, status_code, latency_ms, stream, input_tokens, output_tokens, cached_tokens, reasoning_tokens, cost_usd (number|null), cost_source}]}`
- `DELETE /proxx/usage` resets the statistics, after a confirmation dialog.

What the page shows:

- Range presets (Today, 7 days, 30 days). Date bounds are UTC calendar days, matching the backend's day buckets.
- KPI cards: cost, requests, tokens and failure rate.
- A daily chart (hand-written SVG) that can show cost, requests or tokens. Missing days are filled
  with zeros, and you can step through days with the arrow keys.
- A breakdown table by model, provider or API key.
- A table of the 50 most recent requests, each with a cost-source badge.
- The page refreshes itself every 30 s.

A `cost_usd` of `null` means the cost is unknown. It is shown as "—" and is never counted as $0.

### Model groups (`/#/model-groups`)

- `GET /proxx/groups`
  → `{groups:[{name, strategy, hidden, members:[{model, providers, available, cooldown_until, credentials}]}]}`
  provides live availability, refreshed every 15 s.
- Group definitions are stored in the config at `proxx.model-groups` as a list of
  `{name, strategy: ordered|round-robin, models: [...], hidden}`.
  - They are read with `GET /config/proxx/model-groups`; a missing path counts as `[]`.
  - They are written by replacing the whole list with `PUT /config/proxx/model-groups`, because
    config lists have no stable IDs.
  - Writes are guarded by `guardConfigConnection()` and clear the config store cache afterwards.
- The editor covers name, strategy, hiding the group from `/v1/models`, and the member list. Members
  can be reordered with the up/down buttons (keyboard accessible) and picked from `/v1/models`
  through the shared models store.
- Groups are validated before saving: no empty, space-containing or duplicate names, and a group
  cannot contain itself.

### Pricing (`/#/pricing`)

- `GET /proxx/pricing`
  → `{catalog_source, updated_at, override_upstream, models:[{model, provider, input, output, cache_read, cache_write, source}]}`.
  Prices are USD per 1M tokens.
- Overrides are stored in the config at `proxx.pricing.models` as a list of
  `{model, provider?, input, output, cache-read, cache-write, reasoning, override}`. Note the YAML
  keys use hyphens. The whole list is replaced with a PUT.
- The `proxx.pricing.override-upstream` toggle is written with
  `PUT /config/proxx/pricing/override-upstream`.
- The catalog table can be searched and shows at most 200 matching rows. "Override" on a catalog
  row opens the editor with that row's prices filled in.

### Requests (`/#/requests`)

Browses every request recorded while `observability.logs.request-log` is on.

- `GET /proxx/requests?limit&cursor&status=2xx|4xx|5xx|error&model&provider&q&since&until`
  (unix ms, newest first) → `{items: Row[], next_cursor ("" = end), request_log_enabled,
  total_size_bytes, max_total_size_bytes (0 = unlimited), log_dir}`.
  Row: `{id, file, time, time_ms, method, path, status, duration_ms|null, stream, requested_model,
  served_model, group, provider, input_tokens|null, output_tokens|null, reasoning_tokens|null,
  cached_tokens|null, cost_usd|null, cost_source, attempts, error, size_bytes}`.
- `GET /proxx/requests/:id` → `{row, client:{url, method, headers, body, body_truncated},
  attempts:[{index, url, method, headers, body, body_truncated, status|null, response_headers,
  response_body, response_truncated, error, timestamp}], response:{status, headers, body,
  body_truncated, sse_events|null, assembled:{text, reasoning, tool_calls}|null},
  websocket_timeline, api_websocket_timeline, raw_size_bytes}`.
- `GET /proxx/requests/:id/raw` (text), `DELETE /proxx/requests/:id`, `DELETE /proxx/requests` → `{removed}`.
- `GET /proxx/requests/stream`: SSE, `event: request` with a Row. Read with `fetch()` (EventSource
  cannot send the bearer key), reconnects with backoff, and after 3 failures polls the list every 3 s.
- The logging toggle reuses `PUT /config/observability/logs/request-log` (same as the System page).

What the page shows:

- Header: logging pill + toggle, disk usage bar, Live toggle, refresh, Clear all.
- Filters: server-side search (`/` focuses), status chips, model/provider (values seen so far), time range.
- A windowed list (fixed 40 px rows, infinite scroll). Live rows animate in at the top; while the list
  is scrolled down, or a search is active, they are held behind an "N new requests" pill.
- Keyboard: `j`/`k` move, Enter opens, Esc closes.
- A resizable detail split (full screen on mobile) with Transcript, Request (JSON tree, cURL with
  `$PROXX_KEY`), Upstream (attempt cards and failover chain), Response (SSE events beside the
  assembled text) and Raw (lazy, windowed, searchable, downloadable) tabs.
- Transcript reconstruction (`src/features/requests/logic/transcript.ts`) supports OpenAI Chat,
  OpenAI Responses, Claude Messages and Gemini. The format is detected from the path first, then from
  the body shape. Markdown is rendered into React elements only, never as HTML strings.
- Unknown values render as "—". If logging is off and nothing is recorded, an explainer with an
  Enable button is shown; if older logs exist, a banner is shown above them.

### Updates (`/#/updates`)

In-panel self-update of the proxx binary. All routes are under `/v8/management/proxx/update`.

- `GET /proxx/update` → `{api_level, current_version, latest_version, update_available, release_url,
  release_notes (markdown), checked_at, last_check_error, supported, unsupported_reason,
  state: idle|checking|downloading|verifying|staged|waiting_idle|applying|failed, inflight, staged_version,
  config:{check, interval_hours, auto_apply, window}, last_result:{from,to,at,ok,rolled_back,error}|null}`.
  A 404 means the backend predates in-panel updates: the page shows the install-script command instead.
- `POST .../check` → status. `POST .../apply` → 202 + status, or 409 `{error}` (unsupported / nothing to
  apply), shown as a notification. `POST .../cancel` cancels a pending apply.
- Settings are written one key at a time with `PUT /config/proxx/update/<key>` for `check`,
  `interval-hours`, `auto-apply` and `window` (`"HH:MM-HH:MM"` in the server's local time, `""` = any time).
  Like every other v8 config write, the body is the raw JSON value (the generic `/config/*path` handler
  stores the body verbatim). Only changed keys are written.

What the panel shows:

- A header pill, "Update available: vX → vY" (or "Updating proxx…"), which links to the page. The pill owns
  the only poller (`src/features/update/useUpdatePoller.ts`): every 5 min, every 2 s while the state is
  in progress or a post-apply reconnect is pending. State lives in `useUpdateStore` and is reset on logout;
  responses from an old connection are dropped.
- Current/latest version, last check time, "Check now", the release notes (rendered with the Requests
  page's element-only Markdown renderer, so raw HTML shows as text) and "Update now" with a confirmation
  dialog.
- A stepper: download → verify → staged → wait for idle ("N requests in flight", with Cancel) → restart →
  done.
- After an apply, `reduceApply` in `src/features/update/logic/updateLogic.ts` (a pure state machine with an
  injected clock) tracks the restart. Failed fetches are tolerated for 60 s. Success means the backend
  reports the target version. A new `last_result` with `rolled_back` or `!ok` shows a red rolled-back or
  failed state with the error. If the backend restarts but stays on the old version with no new result for
  15 s, that is shown as failed. An apply started by the backend itself (auto-apply) is tracked the same way.
- Release notes have HTML comments (release-tooling markers) removed before rendering; any other raw HTML
  is shown as text.
- If the running build is newer than the latest release (for example `v8.0.73-proxx.4-rc.1` against
  `v8.0.73-proxx.3`, ordered by `compareVersions`), the card says "Latest release / You're running a newer
  build" and the notes become a collapsed "Latest release notes" section.
- "Update now" uses the neutral secondary style whenever it is disabled, because a disabled primary
  button still looks purple.
- `supported: false` shows `unsupported_reason` and the install command, and disables "Update now".
- A compatibility warning when `api_level` < `MIN_BACKEND_API` (`src/services/api/proxxUpdate.ts`). The
  release workflow appends `proxx-min-backend-api: N` to the panel release notes (see README).
- Settings: auto-check toggle, interval (whole hours 1–720), auto-apply toggle, maintenance window (two time
  inputs or "Any time"; overnight windows such as 22:00–04:00 are valid, equal start/end is rejected).

## Tests

- `tests/proxxApi.test.ts` covers normalization and serialization in the API modules, date ranges,
  zero-filling and validation.
- `tests/proxxPages.test.ts` covers the page logic helpers and the money formatters.
- `tests/proxxRequests.test.ts` covers the SSE parser, transcript reconstruction for all four formats,
  request API normalization, live filtering and merging, and the cURL builder.
- `tests/proxxUpdate.test.ts` covers update status normalization, rendering in every state, the reconnect
  state machine (success, rollback, timeout, stale version, cancel, auto-apply), the store flow
  apply → waiting_idle → failed fetches → success with a mocked API and clock, 409/404 handling, the
  settings PUTs, and window/interval validation.

## Screenshots

`docs/proxx-screenshots/` holds dark and light shots of the login, dashboard, providers, spend,
model groups and pricing pages, plus the "requires proxx backend" state.

The spend, groups and pricing screenshots used synthetic data served by a throwaway local proxy in
front of the stock `../proxx` backend. That proxy is not part of this repository. Group and price
edits in the screenshots went through the real config API.

The `requests-*.png` shots use **mock data** from `scripts/mock-requests-server.ts`. That mock is a
dependency-free Bun server that implements the Requests contract and serves `dist/index.html`. It is
not shipped in the build. To run it: `bun run build && bun scripts/mock-requests-server.ts
[--port 8399] [--logging-off]`, then open the URL it prints and log in with any key.

The `update-*.png` shots use **mock data** from `scripts/mock-update-server.ts`, which simulates the whole
apply flow. Its restart really stops the HTTP listener for `--gap` ms (default 1200), so polls fail at the
network level. Run it with `bun run build && bun scripts/mock-update-server.ts [--port 8398]
[--scenario available|rollback|unsupported|uptodate|newer|old] [--tick 1500] [--gap 1200] [--inflight 3]`.
