# proxx panel fork

This repository is `iamkunal9/proxx-panel`, a fork of
`router-for-me/Cli-Proxy-API-Management-Center`. It is the management UI for
proxx (a fork of CLIProxyAPI; backend source lives at `../proxx`).

The fork has two parts:

1. A **reskin**: a Linear-style theme, dark by default, plus proxx branding.
2. **Three new pages** for fork-only backend features: Spend & usage, Model groups and Pricing.

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
| `src/components/layout/MainLayout.tsx` | Theme preview card colours, brand name, sidebar entries for the new pages. |
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
- `src/components/proxx/` (shared page primitives, formatters and icons)
- `src/services/api/proxx*.ts` (API modules and normalization)
- `src/types/proxx.ts`

Routes are added in `src/router/MainRoutes.tsx`. The dashboard renders `<SpendStrip />` with one
line in `src/features/dashboard/DashboardPage.tsx`.

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

## Tests

- `tests/proxxApi.test.ts` covers normalization and serialization in the API modules, date ranges,
  zero-filling and validation.
- `tests/proxxPages.test.ts` covers the page logic helpers and the money formatters.

## Screenshots

`docs/proxx-screenshots/` holds dark and light shots of the login, dashboard, providers, spend,
model groups and pricing pages, plus the "requires proxx backend" state.

The spend, groups and pricing screenshots used synthetic data served by a throwaway local proxy in
front of the stock `../proxx` backend. That proxy is not part of this repository. Group and price
edits in the screenshots went through the real config API.
