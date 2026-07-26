# DESIGN.md

Meridian — a newspaper-editorial visual identity for the portfolio tracker. Centered
masthead, serif figures, ruled stat bands, flat/no-shadow surfaces, a near-monochrome
warm palette with three chromatic accents reserved for gain/loss/mid-score meaning.

Source: `design_handoff_meridian/` (gitignored reference bundle — high-fidelity; colors,
typography, spacing, and interactions below are final). Governing plans:
`plans/2026-07-17-meridian-design-overhaul.md` (ADR-8 token reconciliation, ADR-9
Watchlist naming, ADR-10 custom SVG chart) and
`plans/2026-07-18-meridian-research-detail.md` (ADR-11 extends the custom SVG chart
to the research-detail tabs, retires Recharts there, and adds the 7-tab structure) —
see `DECISIONS.md`.

This is a re-skin. No data model, scoring logic, or UX flow changes — see `## UX flows`.

---

## Design tokens

### Colors

Meridian ships one token set per theme. Per ADR-8, these are implemented by writing
Meridian's actual values directly into the **existing shadcn CSS variable names** in
`app/globals.css` (`:root` / `.dark`), with the `hsl()` wrapper removed from
`tailwind.config.js` so variables hold complete color values (hex or oklch) instead of
bare HSL triples. Do not introduce a second, parallel `--meridian-*` namespace — the
whole point of ADR-8 is that `components/ui/**` inherits these for free through the
aliases it already uses (`bg-card`, `text-muted-foreground`, `border-border`, etc.).

**Mapping table — Meridian token → shadcn variable name → light / dark values**

| Meridian token | shadcn variable | Light value | Dark value | Usage |
|---|---|---|---|---|
| `--bg` | `--background` | `#faf8f4` | `#171411` | page background |
| `--card` | `--card` | `#fffdf9` | `#1e1a15` | card background |
| `--ink` | `--foreground` | `#1f1d1a` | `#f2ede4` | primary text |
| `--sub` | `--muted-foreground`* | `#4d483f` | `#c9c2b4` | secondary text |
| `--mut` | *(new: `--mut`)* | `#8a8478` | `#8d8578` | muted text / labels / kickers |
| `--line` | `--border` / `--input` | `#e5e0d6` | `#2e2921` | primary rules & borders |
| `--line2` | *(new: `--line2`)* | `#eee9df` | `#28231c` | hairline rules (row dividers, cell separators) |
| `--fill` | *(new: `--fill`)* | `#f3f0e9` | `#252019` | hover fills (solid, full alpha — see "Row hover" below) and muted/secondary/accent surface fills |
| `--up` | *(new: `--up`)* | `oklch(0.55 0.1 155)` | `oklch(0.72 0.11 155)` | gains (green) |
| `--dn` | *(new: `--dn`)* | `oklch(0.55 0.14 25)` | `oklch(0.7 0.15 25)` | losses (red) |
| `--amber` | *(new: `--amber`)* | `oklch(0.62 0.12 80)` | `oklch(0.62 0.12 80)`† | middling scores (4–7 band) |
| `--btnbg` | *(new: `--btnbg`)* | `#1f1d1a` | `#f2ede4` | primary button background |
| `--btnfg` | *(new: `--btnfg`)* | `#faf8f4` | `#171411` | primary button text |

\* `--sub` maps onto shadcn's `--muted-foreground` slot because both mean "secondary
text" — no shadcn component needs a distinct third gray, so this is a direct
substitution, not a new token.
† The handoff does not list a separate dark-mode `--amber` — carry the light value
through unchanged (it is an oklch accent already legible on both dark surfaces the
handoff defines).

**Also mapped onto existing shadcn slots** (values follow `--card`/`--bg`/`--ink`
directly — these are not independent Meridian tokens, they are shadcn slots that need a
value so `components/ui/**` keeps working):

| shadcn variable | Value (light) | Value (dark) | Rationale |
|---|---|---|---|
| `--popover` | `#fffdf9` (= `--card`) | `#1e1a15` (= `--card`) | popovers/dropdowns read as cards |
| `--popover-foreground` | `#1f1d1a` (= `--ink`) | `#f2ede4` (= `--ink`) | — |
| `--card-foreground` | `#1f1d1a` (= `--ink`) | `#f2ede4` (= `--ink`) | — |
| `--primary` | `#1f1d1a` (= `--btnbg`) | `#f2ede4` (= `--btnbg`) | primary buttons/accents use ink, not blue |
| `--primary-foreground` | `#faf8f4` (= `--btnfg`) | `#171411` (= `--btnfg`) | — |
| `--secondary` | `#f3f0e9` (= `--fill`) | `#252019` (= `--fill`) | secondary surfaces |
| `--secondary-foreground` | `#1f1d1a` (= `--ink`) | `#f2ede4` (= `--ink`) | — |
| `--muted` | `#f3f0e9` (= `--fill`) | `#252019` (= `--fill`) | muted surfaces |
| `--accent` | `#f3f0e9` (= `--fill`) | `#252019` (= `--fill`) | hover/highlight surfaces |
| `--accent-foreground` | `#1f1d1a` (= `--ink`) | `#f2ede4` (= `--ink`) | — |
| `--destructive` | `oklch(0.55 0.14 25)` (= `--dn`) | `oklch(0.7 0.15 25)` (= `--dn`) | destructive actions use `--dn` |
| `--destructive-foreground` | `#faf8f4` | `#171411` | — |
| `--ring` | `#1f1d1a` (= `--ink`) | `#f2ede4` (= `--ink`) | focus rings |

**Do not hardcode** any of the above as one-off hex/oklch values inside a component —
always reference the Tailwind alias (`bg-card`, `text-muted-foreground`, `border-border`,
or the new utilities the Coding agent exposes for `--mut`/`--line2`/`--fill`/`--up`/
`--dn`/`--amber`/`--btnbg`/`--btnfg` — e.g. `text-[color:var(--mut)]` or an added
Tailwind color alias, whichever `tailwind.config.js` ends up wiring per Task 1). If a
screen spec below needs a color not in this table, it is a spec error — flag it, do not
invent one.

**Chromatic accent rule:** `--up` / `--dn` / `--amber` are the *only* saturated colors
in the entire system. Everything else is warm neutral. Never introduce a fourth accent
hue (no blue, no purple) — that is the stock-shadcn look this overhaul replaces.

### Typography

Two font families, both via `next/font/google` (self-hosted, no runtime Google Fonts
request — see ADR-8's sibling decision in the plan's Fonts section):

- **Sans — Libre Franklin** (weights 400/500/600): UI text, labels, buttons, table body,
  nav, kickers.
- **Serif — Newsreader** (weights 400/500/600, italics, optical sizing `opsz`): masthead
  wordmark, all H1s, all large figures (portfolio value, stat-band values, score
  figures), company names in table rows, editorial italic sublines/captions.

Exposed as `--font-sans` / `--font-serif` CSS variables, wired into
`tailwind.config.js` `fontFamily.sans` / `fontFamily.serif`.

**Type scale** (exact values from the handoff — do not approximate):

| Role | Font | Size | Weight | Letter-spacing / style | Where used |
|---|---|---|---|---|---|
| Kicker / label | Sans | 10.5–11px | 400 | uppercase, 0.12–0.14em, color `--mut` | section eyebrows, stat-band labels, table headers |
| Nav item | Sans | 11.5px | 400 (600 active) | uppercase, 0.16em | masthead nav row |
| Body / table text | Sans | 13.5px | 400 | normal | table cells, general body copy |
| Secondary / detail text | Sans | 12–12.5px | 400 | normal | detail lines under stat values, table secondary cells |
| Masthead wordmark | Serif | 30px | 500 | 0.01em | header "Meridian" |
| Screen H1 | Serif | 52px (44px on Add position) | 500 | line-height 1.05 | page titles (Closed positions, Watchlist, Research index, Research detail, Add position) |
| Dashboard portfolio value | Serif | 54px | 500 | line-height 1.05 | dashboard hero figure |
| Stat-band value | Serif | 26px | 500 | — | ruled 3-col stat bands (dashboard, watchlist) |
| Summary-card value | Serif | 28px | 400/500 | — | closed-positions 6-col summary, research-detail 4-col stat card |
| Table score figure | Serif | 19px | 500 | colored by band | watchlist Score column |
| Composite score figure | Serif | 84px | 500 | line-height 1 | research-detail score breakdown |
| Composite sub-score | Serif | 28px | 400 | — | research-detail 5-dimension grid |
| Login "Meridian" | Serif | 38px | 500 | — | login masthead block |
| Login card heading | Serif | 26px | 500 | centered | "Welcome back" |
| Editorial paragraph | Serif | 19px | 400 | line-height 1.6 | Morning Note drop-cap paragraph |
| Editorial quote | Serif | 17px | 400 italic | line-height 1.55 | Morning Note pull-quote |
| Insight/recommendation line | Serif | 15.5px | 400 | line-height 1.5 | risks/opportunities/recommendations cells, key-insights list |
| Italic helper/caption | Serif | 11–14.5px | 400 italic | — | "as of 17:30 CET", form helper text, login subline |
| Research index H1 subline | Serif | 16px | 400 italic | color `--mut` | "Fundamentals, technicals & intrinsic value…" |
| Search input (research index) | Serif | 20px | 400 | centered text | large pill search |
| Order-total row | Serif | 22px | 400 | — | Add-position total cost |

Body text color defaults to `--ink`; secondary/tabular numeric cells often use `--sub`.
Kickers and muted labels always use `--mut`.

### Spacing / shape

- **Page container:** max-width 1400px, padding `56px 32px 96px` (all authed screens
  except Add position and Login).
  - Add position: max-width 680px, padding `56px 24px 104px`.
  - Login: centered column, max-width 420px, no shared container padding (full-viewport
    centering).
  - Research index hero block: centered, max-width 720px, top padding 76px.
- **Cards:** `--card` background, 1px `--line` border, radius 8px, padding 24–28px
  (32px on the Add-position form card). No shadows anywhere — flat, ruled aesthetic is
  the whole point; do not add `box-shadow` to any surface.
- **Buttons — pill shape** (radius = half of height):
  - Primary: `--btnbg` background / `--btnfg` text, no border. Heights 38–44px
    depending on context (40px dashboard "+ Add position", 38px secondary actions like
    "Export CSV" / "Watchlist", 44px form-submit pills).
  - Secondary: transparent background, `--ink` text, 1px `--line` border. Same height
    range as its paired primary button.
  - Segmented control (currency EUR/USD): outer pill, 1px `--line` border, radius 20px,
    height 40px, 3px inner padding, background `--card`; active segment is an inner
    pill (radius 16px, height 32px) filled `--btnbg`/`--btnfg`; inactive segment is
    transparent with `--mut` text, hover shifts to `--ink`.
- **Inputs:** 40px height (34px for the header search pill, 36px for the closed-
  positions filter), radius 6px (17–18px for pill-shaped search inputs), `--bg`
  background (cards' inputs sit on `--bg`, not `--card`, to read as a cutout), 1px
  `--line` border, no focus ring glow — outline none, rely on border.
- **Double rules** (`border: 3px double var(--ink)`) mark editorial emphasis — used
  sparingly, only at:
  - Login masthead block bottom border.
  - Morning Note card top border.
  - Research-detail score-breakdown card top border.
  - Add-position order-summary total row top border.
  - Research-detail composite-score "verdict stamp" border (see Components).
- **Ruled stat bands:** full-width row, `border-top` + `border-bottom` 1px `--line`,
  divided into equal columns (3 on Dashboard/Watchlist, 6 on Closed positions, 4 on
  Research detail, 5 on the score-breakdown dimension grid) by 1px `--line2` vertical
  rules between cells. Each cell = kicker label (10.5px uppercase `--mut`) / large serif
  value (26–28px) / 12px detail line. First cell has no left padding, last cell has no
  right padding, so the band aligns flush with the container edges.
- **Hairline row dividers:** 1px `--line2` between table rows and between insight
  sub-items; the last row in a table/list has no bottom rule.
- **Row hover:** `background: var(--fill)` (Tailwind `hover:bg-fill`, full alpha — no
  `color-mix`/opacity) on every clickable table row / list row. No border or inset
  change on hover — background only. Applies identically to ALL clickable table/list
  rows across the app: dashboard positions table, closed-positions table, watchlist
  table, research index rows, news coverage list, and the stock-search results list —
  one row-hover treatment, not several idioms.
  **Correction note:** this supersedes the handoff README's "very subtle" wording and
  the originally-recorded `color-mix(in srgb, var(--fill) 45%, transparent)` (45%
  alpha) value. At 45% alpha, `--fill` (`#f3f0e9`) over `--bg` (`#faf8f4`) was nearly
  invisible in practice — the owner's mock-up screenshot reads as a distinct visible
  band, so the hover is deliberately bumped to solid `--fill` (owner-approved,
  `plans/2026-07-18-meridian-dashboard-detail-fixes.md`). Still a warm neutral, no new
  token.
- **Theme transition:** `body { transition: background-color .25s, color .25s }` — the
  only animated property besides the chart morph.

---

## Components

Name, variants, states, and usage rules for every reusable Meridian pattern. Build
these once and reuse — do not restyle the same pattern differently on two screens.

### Masthead (shared header)
Sticky, `--bg` background, 1px `--line` bottom border. Two rows inside a 1400px
container:
1. **Top row** — 3-column grid (`1fr auto 1fr`), vertically centered, `14px 0` padding,
   1px `--line` bottom border under this row only:
   - Left: dateline kicker, 10.5px uppercase `--mut`, format `"Vol. {roman} — № {n} ·
     {long date}"`. Fully computed, never hardcoded — see the dateline formula below.
   - Center: "Meridian" wordmark, Newsreader 30px/500, clickable → Dashboard.
   - Right, `12px` gap: search input (pill, 200px, 34px height, magnifier icon at
     `left:13px`), theme toggle (34px circle, 1px `--line` border, ◐ glyph, 15px,
     `--sub`), account control (34px circle, 1px `--line` border, user-outline icon,
     `--sub`) — a Radix `DropdownMenu` trigger (kept from the current app; the
     prototype's plain click-to-login is prototype shorthand for sign-out, not a spec
     to remove the menu).
2. **Nav row** — centered flex, `52px` gap, `14px 0 0` padding: PORTFOLIO · CLOSED ·
   WATCHLIST · RESEARCH. 11.5px uppercase, 0.16em letter-spacing. Active item: weight
   600, color `--ink`, 2px `--ink` bottom border (`padding-bottom:13px` to clear it).
   Inactive: weight 400, color `--mut`, 2px transparent border (reserve the space so
   nothing shifts on activation).

**Dateline formula** (owner-specified, computed — never hardcoded):
- **Volume** = 2-digit year in Roman numerals (2026 → `26` → `XXVI`).
- **Issue №** = day-of-year via `date-fns` `getDayOfYear`.
- **Date** = existing long-form date string, e.g. `Friday, 17 July 2026`.
- Example: 17 July 2026 renders `Vol. XXVI — № 198 · Friday, 17 July 2026`.
- The prototype's own `Vol. III — № 128` is placeholder sample data and does not match
  this formula — the formula supersedes it. Roman-numeral conversion lives in
  `lib/utils/dateline.ts` as a tested pure function (Planner-specified, not a Designer
  decision).

### Ruled stat band
Full-bleed-within-container row: `border-top` + `border-bottom` 1px `--line`, N equal
columns via CSS grid, `1px --line2` left border on every column after the first (acts
as a vertical rule). Cell content, top to bottom: kicker (10.5px uppercase `--mut`),
serif value (26px/500, colored `--up`/`--dn` when the metric is signed), 12px detail
line (colored to match the value when signed, else `--mut`). Used on: Dashboard (Total
return / Best performer / Largest holding), Watchlist (Targets reached / Watched /
Average score). The Closed-positions 6-col summary and Research-detail 4-col stat card
are the same pattern at a different column count, card-wrapped instead of bare-ruled
(1px `--line` border all around + radius 8px, `--line2` internal verticals) — treat as
a variant, not a new component.

### Position/Watchlist table row — two-line position cell
Every positions/closed-positions/watchlist/research-index table row that names a
security uses the same cell: company name (Newsreader 16px/500, `--ink`) on the first
line, `TICKER · EXCHANGE` (10.5px uppercase, 0.12em, `--mut`, `margin-top:2px`) on the
second. Table shell: `border-collapse:collapse`, header row 1px `--line` bottom border,
header cells 10.5px uppercase `--mut` (600/`--ink` only for an emphasized sortable
column, e.g. Watchlist's Score), body rows 1px `--line2` bottom border (omit on the
last row), `15px 0` cell padding, row hover per the Row hover rule above (solid
`--fill`), `cursor: pointer`, whole row clickable through to research detail. Numeric
cells right-aligned;
signed cells (P/L, Return, Change) colored `--up`/`--dn`; Market value / Realized P/L
bold (weight 500).

### Score figure
Newsreader serif numeral, colored by band against the *presentational* thresholds
(scoring math is unchanged — this recolors an already-computed number):
- **≥ 7** → `--up`
- **4–7** → `--amber`
- **< 4** → `--dn`
- **null/unavailable** → `--mut`

Two sizes: 19px/500 inline in the Watchlist table Score column; 84px/500 (line-height
1) as the research-detail composite headline, with a smaller `/10` suffix at 30px
`--mut`. Sub-dimension scores in the 5-col breakdown grid use 28px, same band coloring.

### Grading dot
A `●` glyph, `margin-left:8px`, set inline immediately after a metric's value —
never on its own line. Colored by the metric's grade against the same band logic as
Score figure, applied to a per-metric status rather than a 0–10 number:
- **Strong** → `--up`
- **In line** → `--amber`
- **Weak** → `--dn`
- **Unavailable** (metric not computable) → `--mut`

Used on every metric row inside the Fundamental tab's sub-views (Score-breakdown
grid, and the six pill sub-nav sections' `GradedMetricRow`s). Always paired with a
legend row where it first appears on a screen, sans 10.5px uppercase `--mut` label,
12.5px `--sub` body, exact wording: **"● Strong vs peers · ● In line · ● Weak vs
peers"** (three `<span>`s, `gap:24px`, each a colored `●` followed by its label).
Grading today is threshold-based (see `metricGrade()` in `lib/utils/score-band.ts`
per the governing plan), not a literal peer comparison — the legend wording is kept
as-is per the plan's Assumptions; do not silently reword it without a Designer note.

### Headline score card
The single editorial headline pattern reused, unchanged in structure, across
Overview, Technical, Fundamental, Analysts, Intrinsic value, and News & sentiment —
**one component, not six**. Card chrome: `--card` background, 1px `--line` border,
radius 8px, `border-top: 3px double var(--ink)`, padding `24px 28px 28px`.

Header row inside the card (`padding-bottom:16px`, `1px --line2` bottom border):
left = section kicker (11px/600, uppercase, 0.14em, `--ink`); right = a muted meta
kicker (10.5px uppercase, 0.1em, `--mut`) — e.g. "Meridian rating · updated daily",
"Daily bars · updated at close", "Trailing twelve months · FY ends Sep", "34
analysts · last 90 days", "Discounted cash flow · 10-year model", "1,240 articles
analysed · last 30 days".

**Custom-weighting meta kicker (Overview + Fundamental only — see UX flows →
"Settings — scoring weights").** When the signed-in user's fetched scoring weights
differ from `DEFAULT_SCORING_WEIGHTS` for the group that card's score is built
from, the meta kicker's copy swaps to signal the score is personalized, using the
exact same slot and type treatment — no new chrome, no new color, no badge:
- **Overview tab** (composite, driven by the 5-category weights): meta kicker reads
  **"Your weighting · updated daily"** instead of "Meridian rating · updated
  daily" when composite weights ≠ defaults.
- **Fundamental tab** (driven by the 5-subcategory weights): meta kicker reads
  **"Your weighting · trailing twelve months"** instead of "Trailing twelve
  months · FY ends Sep" when fundamental weights ≠ defaults. (The FY-end clause is
  dropped in the custom state rather than appended, to keep the kicker at its
  normal length — both are muted secondary facts, not additive.)
- Every other tab (Technical, Analysts, Intrinsic, News) is unaffected — those
  scores are not weight-configurable at any sub-dimension level (per the plan's
  Assumptions), so their meta kickers never change.
- The comparison is a cheap deep-equal against the already-fetched
  `["scoring-weights"]` query result vs. the imported `DEFAULT_SCORING_WEIGHTS`
  constant — no extra request. Text-only, matching the "no fourth accent" rule;
  this is the full extent of the affordance — no icon, no dot, no pill is added
  to the header row for this signal.

Body: `grid-template-columns: 280px 1fr`, `gap:56px`, `padding-top:28px`.
- **Left column** — always in this order:
  1. `ScoreFigure` at 84px with the `/10` suffix at 30px `--mut`, banded per Score
     figure's thresholds.
  2. Either a rotated `VerdictStamp` (Overview, Analysts — anywhere the design shows
     a "Buy"-style call) **or** a verdict kicker line (10.5px uppercase, 0.12em,
     `--mut` by default or the band color + weight 600 when the kicker itself carries
     the verdict, e.g. "Positive momentum" in `--up`, `margin-top:20px`) — never both.
  3. An optional italic serif summary paragraph, 14.5px/1.55, color `--mut`,
     `margin:10px 0 0` (Technical, Fundamental, Intrinsic, News use this; Overview and
     Analysts instead show a plain kicker line under the stamp, e.g. "Momentum +
     quality", "Street consensus").
  4. Intrinsic value's left column additionally inserts a fair-value figure (34px
     serif, `margin-top:4px`) and a colored "Trading X% above/below fair value" line
     (13px/500) between steps 2 and 3 — a documented variant, not a new component.
- **Right column** — a flexible `children` slot: the 5-dimension `SubscoreBand`
  (Overview), the `DetailPriceChart` (Technical), the Fundamental 5-col
  `SubscoreBand`, the Analysts ratings-distribution rows + 3-col price-target band,
  the Intrinsic 3-col scenario band + Model-assumptions rows, or the News 3-col tone
  band. Each slot's internals are documented in their own tab entry under
  `## UX flows → Research detail`; the card itself never changes shape to fit them.
  - **No top rule on the Intrinsic scenario band or the News tone band**
    (`plans/2026-07-20-small-visual-fixes.md`, Issue 1). Both bands sit flush under
    the card's internal content with `pt-5` spacing only — no `border-t` above
    either grid. Their previous markup carried `border-t border-line`, but
    `border-line` is a **dead/no-op class**: there is no `--line` CSS variable
    (`app/globals.css` defines `--line2` and `--border`, never `--line`) and no
    `line` entry in `tailwind.config.js`'s color map, so it emitted no
    `border-color` — the rule that was visible came entirely from `border-t`'s
    default border color, not from the token name. If a top rule is genuinely
    wanted on a band like this in future, use **`border-t border-line2`** (the
    real hairline token, per Ruled stat band / Subscore band) — never
    `border-line`, which will silently draw nothing. The Analysts price-target
    band (`analyst-ratings.tsx:151`) and Technical's table (`technical-analysis.tsx:198`)
    still use the same dead `border-line` idiom today; they were out of scope for
    this fix (owner named only Intrinsic + News) and keep their rule for now —
    `border-line` also still appears in `fundamental-analysis.tsx` and
    `research/transactions-tab.tsx`. The dead class itself is a code-hygiene
    matter for `TECH_DEBT.md`, not a design decision; whether the *rule* on those
    other bands should also go (system-wide convergence) is an open design
    question for a future pass, not decided by this plan.

### Subscore band
N-column ruled band of `ScoreFigure`s at 28px (not 84px), banded per the same
thresholds, `1px --line2` vertical rules between columns (first column no left
padding, last column no right padding — same flush-edge rule as the dashboard/
watchlist Ruled stat band). Kicker label per column: 10.5px uppercase `--mut`,
`margin-top:6px` above the figure. Used at:
- **5-col** — Overview's Technical/Fundamental/Analysts/Intrinsic/Sentiment
  dimension grid, and Fundamental's Valuation/Profitability/Growth/Health/Dividend
  headline band. Both live inside a Headline score card's right-hand slot.
This is the same component as the Ruled stat band's card-wrapped variant, sized down
(28px vs 26px value, `ScoreFigure` band coloring instead of `--up`/`--dn` signed
coloring) — treat as a sibling pattern, not a fork: both are "N equal columns,
`--line2` verticals, kicker-over-value-over-detail cells."

### Detail price chart (`DetailPriceChart`)
The research-detail Overview/Technical chart — same drawing primitives as the
Dashboard SVG performance chart (`buildPath`/`buildAreaPath`, ink line, `--ink`
0.05 area fill, `--line` baseline) and, as of
`plans/2026-07-18-meridian-dashboard-detail-fixes.md`, the same hover-crosshair
and y-axis-label approach — but still a **distinct component** from the hero chart:
no range-morph animation, and a variable viewBox (see below) instead of the hero's
fixed 220-tall one. The two charts share the `niceYTicks` helper and the crosshair/
tooltip approach; they are not merged (see the hero chart's own entry below for what
stays different).

- **ViewBox** — `0 0 1300 190` on Overview (1-year, no range tabs, static); `0 0
  1000 190` on Technical (6-month). Both `preserveAspectRatio="none"`, `height:190px`
  container (Overview) / `170px` (Technical per the handoff's outer wrapper), 3
  hairline `--line2` gridlines, ink line 1.5px stroke, `--ink` 0.05 fill-opacity
  area (no stroke), `--line` baseline rule.
  - **Gridline/label y-positions are data-derived, not fixed viewBox fractions**
    (`plans/2026-07-20-small-visual-fixes.md`, Issue 4 — OD-2 resolved as
    axis-only fix). Each gridline's y-pixel is computed from the same padded
    domain `buildPath` uses to plot the line (`gridlineYs` helper in
    `lib/utils/chart-path.ts`), so the top/bottom gridlines always land exactly
    where the series' max/min actually plot. Do not re-pin these to fixed pixels
    or fixed fractions of the viewBox (e.g. the prior hardcoded "y=47/94/141 of
    190") — that is the bug this fix closes (the line could render outside the
    labelled band).
- **Y-axis price labels** — a few (3–4) `--mut` value labels, sans, positioned as
  HTML text absolutely against the chart container at the gridline y-fractions (not
  inside the SVG, which would distort under `preserveAspectRatio="none"`), formatted
  with `formatCurrency`. Minimal — this is a "few labels," not a dense axis.
- **Hover crosshair + tooltip** — on `mousemove` over the plotted area: an `--ink`
  marker dot on the line at the nearest data point, a thin vertical `--line`
  crosshair through it, and a small card-style tooltip (`--card` background, 1px
  `--line` border, same radius/shadow-free treatment as any Card) showing the point's
  date and `formatCurrency(price)`. All three hide on `mouseleave`.
- **Reference lines + legend (Technical only)** — optional `--mut`
  `stroke-dasharray="6 5"` horizontal lines at given values (support/resistance),
  1px stroke width, plus a legend row beneath the chart: sans 10.5px uppercase
  `--mut`, `justify-content:space-between`, e.g. "Resistance $216.80 ┄ · Support
  $208.20 ┄ · Jan – Jul 2026". Omit both the lines and the legend entirely when no
  reference values are available — never fabricate a level.
- **Date-axis caption row** (Overview) — below the chart, `justify-content:
  space-between`, sans 10.5px uppercase 0.08em `--mut`, evenly spaced date labels
  (e.g. "Jul 2025 · Oct 2025 · Jan 2026 · Apr 2026 · Jul 2026").

Distinct from `portfolio-chart.tsx` (dashboard hero): the hero has the range-morph
tab row and a fixed 220-tall viewBox; the detail chart has a variable viewBox (190,
either 1300 or 1000 wide) and, on Technical, reference lines + legend. As of
`plans/2026-07-18-meridian-dashboard-detail-fixes.md`, both charts now share the same
hover-crosshair/tooltip and y-axis-label treatment (via `niceYTicks` and the same
pixel-mapping approach) — see the hero chart's own entry ("Dashboard SVG performance
chart" → "Y-axis price labels" / "Hover crosshair + tooltip") for its exact values.
Do not merge the two components — they stay separate per ADR-11 and the hero's
range-morph.

### Editorial coverage list
Hairline-divided list for News & sentiment's "Latest coverage": each row
`justify-content:space-between`, `align-items:baseline`, `gap:32px`, `padding:18px
0`, `1px --line2` bottom border (omit on the last row), `cursor:pointer`, row hover
per the standard rule (`background: var(--fill)`, solid, no border/inset change).
Row content:
- **Left** — serif headline, Newsreader 17px/500, line-height 1.35, over a kicker
  line `{source} · {date}` (10.5px uppercase, 0.12em, `--mut`, `margin-top:6px`).
- **Right** — a single uppercase tag, sans 10.5px/600, 0.14em letter-spacing,
  `white-space:nowrap`, colored `--up` (POSITIVE) / `--mut` (NEUTRAL) / `--dn`
  (NEGATIVE). No pill/border chrome — text color only, unlike the outlined badges
  elsewhere in the system.

**PENDING tag — confirmed, no change (`plans/2026-07-24-news-sentiment-accuracy.md`
Task 12).** A fourth tag state, already implemented at `news-feed.tsx:31` and
already spec-compliant: same slot, same treatment as NEUTRAL — sans 10.5px/600,
0.14em, `--mut`, no pill/border chrome. Prior to that plan this state was
theoretical (a failed analysis silently persisted as a fabricated neutral `0`,
so "pending" never actually rendered); the plan makes `sentiment: null` a
real, reachable outcome (analysis failed or has not run yet), and PENDING is
what a `null`-sentiment row renders via the existing `sentimentTag()` null
branch. **Do not give PENDING its own color.** `--mut` already reads as "no
verdict" elsewhere in this exact list (NEUTRAL) and on the `ScoreFigure`
(null/unavailable band) — a fourth accent color for "pending" would break the
three-color chromatic-accent rule for a state that is, semantically, the same
"nothing to report yet" as NEUTRAL and null-score. The two remain
distinguishable by their copy alone (PENDING vs NEUTRAL), exactly as intended —
this list has never disambiguated its tags by color count, only by word.

### Outlined type badge (transactions)
Inline pill, sans 10px/600 uppercase, 0.14em letter-spacing, `border-radius:10px`,
`padding:2px 10px`. Two variants by transaction type:
- **BUY** — `1px --up` border, `--up` text.
- **Other** (SELL, or any type outside the schema's BUY/SELL — see
  `TECH_DEBT.md TD-DTL-TXTYPE`) — `1px --line` border, `--mut` text.
Used in the **Positions** tab's table Type column only (tab renamed from
"Transactions" per `plans/2026-07-19-positions-tab.md` — see UX flows → "Research
detail — tab-by-tab" item 6); do not reuse for the Analysts "Recent revisions"
RAISED/HELD/LOWERED tags, which are unbordered colored text (`--up`/`--mut`/`--dn`,
10.5px/600, 0.14em) matching the Editorial coverage list's tag treatment, not this
badge.

### TARGET REACHED badge
Outlined pill, no fill: 1px `--up` border, `--up` text, radius 10px, padding `2px 8px`,
sans 10px/600, uppercase, 0.12em letter-spacing, inline next to the security name
(`margin-left:8px`, `vertical-align:middle`). Appears only on watchlist rows whose
target condition is currently met; the row itself gets no background fill — only the
badge, and the Target cell text turns `--up`/weight 500.

### Circular row-action button
28px circle, 1px `--line` border, `--sub` icon color (12px stroke SVG, stroke-width 2,
round caps), `margin-left:8px`, `display:inline-flex` centered. Two variants by hover
color only:
- **Add/buy** (plus icon) — hover border + icon → `--ink`.
- **Remove** (× icon) — hover border + icon → `--dn`.
Used in the Watchlist table's action column; same 28–34px circular-button pattern
(border + icon, no fill) is reused at 34px for the masthead's theme toggle and account
control.

### Segmented control (currency EUR/USD)
See Spacing/shape above for exact metrics. Semantic note: replaces the multi-currency
`CurrencySelector` **only on the dashboard hero**; the underlying preference and other
6 currencies are unchanged elsewhere in the app — the control shows whichever currency
is currently active rather than forcing EUR.

### Verdict stamp
Research-detail "Buy"/"Hold"/"Sell"-style call: inline-block, `3px double` border in
the verdict's color (`--up` for a positive call — the only color the handoff shows;
apply the same coloring rule as Score figure for other verdicts, i.e. `--amber`/`--dn`
bands), matching text color, padding `8px 20px`, 13px/600, uppercase, 0.2em
letter-spacing, `transform: rotate(-3deg)`. Reads as a rubber ink stamp — keep the
rotation, it is deliberate, not a bug.

### Drop-cap editorial paragraph
Used once, in "The Morning Note" insights strip. First letter: Newsreader, 56px,
line-height 0.82, `float:left`, padding `6px 10px 0 0`, color `--ink`. Rest of
paragraph: Newsreader 19px/1.6, color `--sub`. Paired with a right-hand rail
(`border-left:1px --line`, `padding-left:32px`) holding an italic serif pull-quote
(17px) and a `--mut` 10.5px uppercase attribution line. Below both, a 3-column
`--line2`-ruled strip (Top risks / Opportunities / Recommendations), each column
carrying: a colored eyebrow (`--amber` for risks, `--ink`-default for opportunities,
`--up` for recommendations) with a symbol prefix (⚠ / ◇ / →), 8px bottom
border-`--line2`, then stacked 15.5px serif lines each preceded (Recommendations only)
by a `№{n}` serif index in `--mut`.

### Loading skeleton (route-level `loading.tsx`)
Per `plans/2026-07-18-performance-audit-remediation.md` Task 7: every
`app/(dashboard)/**` route that fetches on mount gets a `loading.tsx` streaming
boundary so navigation shows a Meridian-shaped placeholder instantly instead of a
blank frame, then swaps to the real content with no layout jump. This is a shimmer
skeleton, not a spinner — reserve the spinner idiom (`Loader2` centered in a
`min-h-[400px]` box) for **secondary in-page loads only** (e.g. a tab's own data
after the shell has already painted), never for the initial route boundary.

**Multi-query cards hold on this same idiom until every constituent query
resolves** (`plans/2026-07-20-small-visual-fixes.md`, Issues 2/3). The research
Overview tab's composite `HeadlineScoreCard` is assembled from five independent
queries (chart/technical, fundamentals, analyst, intrinsic, news); it uses this
same centered "Loading overview…" secondary in-page state, gated on **all five**
being resolved — not just the first to return — so the card never paints a
composite score or `SubscoreBand` figure computed from a still-pending
dimension's fallback value. This is the existing idiom applied to a
multi-source card, not a new loading pattern: no per-figure skeleton, no new
token. Every other research tab's `HeadlineScoreCard` (Technical, Fundamental,
Analysts, Intrinsic, News) is single-query and already gates the same way.

**Drift note (flag for the Coding agent, not a decision the Coding agent should
re-litigate):** `app/(dashboard)/dashboard/loading.tsx` currently on disk is stale —
it predates the Meridian re-skin and uses stock-shadcn primitives (`components/ui/
skeleton.tsx`'s `Skeleton`, `components/ui/card.tsx`'s `Card`) with generic block
proportions that no longer match the shipped Dashboard layout (hero figure, 3-col
ruled stat band, positions table). The actual Meridian-consistent pattern already
exists, but only as an **inline** `DashboardSkeleton()` function at the bottom of
`app/(dashboard)/dashboard/page.tsx` (used via `if (isLoading) return
<DashboardSkeleton />` for the in-page React Query loading state, not the route
boundary) — and a second, independently-written inline `WishlistSkeleton()` at the
bottom of `app/(dashboard)/wishlist/page.tsx` doing the same job with slightly
different markup. Task 7 must not keep three divergent hand-rolled skeletons: it
introduces the one shared primitive below, ports `dashboard/loading.tsx` and both
inline skeleton functions onto it, and deletes the duplicated inline versions once
the route-level file covers the same loading state. Confirm with the Coding agent's
own judgment whether an inline in-page skeleton is still needed anywhere once the
`loading.tsx` boundary exists for that route — if React Query's `isLoading` window
is fully covered by the Suspense boundary already, the inline copy is dead code.

**Shared primitive — `components/ui/loading-skeleton.tsx` (new file, Coding agent
introduces it in Task 7):**
- **`SkeletonBlock`** — the one shimmer primitive every skeleton composes from: a
  `div` with `bg-fill` (never `bg-muted` — `bg-muted` is the correct token
  *value* per the shadcn mapping table but `bg-fill` is the Meridian alias name
  components should read; both currently resolve to the same CSS variable, so this
  is a naming-consistency fix, not a new token) and Tailwind's built-in
  `animate-pulse`. No new color token is introduced — this reuses `--fill` (already
  named in Colors above) exactly as the Row hover treatment and both existing inline
  skeletons already do. Radius follows the shape being mimicked: `rounded` (4px) for
  text-line blocks, `rounded-full` for pill-shaped blocks (buttons, badges),
  `rounded-lg` (8px, matching Card) for card-shaped blocks.
- **Shimmer treatment is exactly `animate-pulse` — do not add a sweep/gradient
  shimmer.** Meridian has no motion vocabulary beyond the theme-transition fade and
  the hero chart's range-morph (see Spacing/shape → Theme transition); a moving
  gradient shimmer would be a new, unapproved motion idiom. Opacity pulse only.
  Tailwind's `animate-pulse` already respects `prefers-reduced-motion` only if the
  project's global CSS says so — DESIGN.md does not yet define a
  `prefers-reduced-motion` rule for any animated property (the theme-transition fade
  or the chart morph either), so this is a pre-existing gap, not one introduced
  here. Flag it in `TECH_DEBT.md` rather than solving it ad hoc inside the skeleton
  primitive alone.
- **`SkeletonText`** — a `SkeletonBlock` sized to one line of a named type-scale row
  (pass a `variant` prop mapped to the Typography table's rows, e.g. `variant="h1"`
  → `h-[52px] w-64`, `variant="kicker"` → `h-[11px] w-40`, `variant="body"` →
  `h-[13.5px] w-full`) so every skeleton's line-heights trace back to the Type scale
  table rather than ad hoc heights.
- **Composed block helpers** (all built from `SkeletonBlock`, matching existing
  Components patterns 1:1 so a skeleton and its real content occupy identical
  geometry — this is what makes the swap calm instead of a jump):
  - `SkeletonStatBand` (props: `columns`) — mirrors **Ruled stat band**: `border-y
    border-border` row, N equal columns, `border-l border-line2` after the first,
    each cell a kicker-height block over a 26px-tall value block over a 12px detail
    block, first/last cell flush padding — same geometry as the real band, same
    column count the real screen will render.
  - `SkeletonCard` — mirrors **Card**: `rounded-lg border border-border bg-card`
    wrapper with internal `SkeletonBlock` rows; accepts an `editorial` boolean to add
    the `border-t-[3px] border-double border-foreground` treatment for screens whose
    real content is an Editorial card (e.g. Headline score card, Morning Note).
  - `SkeletonTable` (props: `rows`) — mirrors the **Position/Watchlist table row**
    shell: header row (`border-b border-border`) of kicker-height blocks, then
    `rows` body rows each `border-b border-line2` (omit on the last), each row a
    horizontal flex of blocks approximating name+ticker (two-line cell), numeric
    columns right-aligned. Default `rows={5}`.
  - `SkeletonTabBar` — mirrors the research-detail **Segmented tabs** bar: a `flex
    gap-8 border-b border-border` row of 7 pill-free label-width blocks
    (`h-[11px]`, varied widths sampling the real tab labels' lengths), no active
    state (skeletons never show an active/selected treatment — there is nothing
    selected yet).

**Per-route composition (each `loading.tsx` composes the shared primitives above —
none defines new one-off markup):**

| Route | `loading.tsx` composition |
|---|---|
| `dashboard/loading.tsx` | H1-height block + kicker above it (hero "Portfolio value" figure), a 40px pill block (currency toggle) beside it, `SkeletonStatBand columns={3}`, then a `SkeletonCard` sized to the chart's `220`-tall box, then `SkeletonTable rows={5}` for the positions table. Replaces the stale stock-shadcn file; matches the existing inline `DashboardSkeleton` shape (which the Coding agent may now delete in favor of this shared file, or leave calling the shared primitives — see Drift note). |
| `research/loading.tsx` | Centered column (`mx-auto max-w-[720px] pt-9 text-center`): kicker block, H1-height block, italic-subline-height block, a pill-shaped block sized to the search input; below, a `SkeletonCard` containing 6 `SkeletonBlock` rows in the `research index` popular-stocks 3-col grid shape; below that, 3 `SkeletonCard`s side by side (the discipline cards). |
| `research/[symbol]/loading.tsx` | Kicker-height back-link block; H1-height block (company name) + kicker block beneath (ticker/exchange) on the left, two pill-shaped blocks on the right (Watchlist / Add to portfolio actions) — mirrors the company header; a `SkeletonCard` in the 4-col quote-stat-card shape (`grid grid-cols-4`, `border-r border-line2` between, same cell geometry as `SkeletonStatBand` but card-wrapped, matching the quote card's own card+internal-rule treatment); `SkeletonTabBar` for the 7-tab bar; a `SkeletonCard editorial` sized to the Headline score card (kicker+meta row, then the 84px-score-column-width block beside a wide content block) as the tab body placeholder — always render the Overview tab's shape since it is the default active tab. |
| `wishlist/loading.tsx` | Kicker block + H1-height block on the left, one pill block (add-to-watchlist) on the right; `SkeletonStatBand columns={3}`; `SkeletonTable rows={5}`. Replaces the inline `WishlistSkeleton` (same shape, now shared). |
| `portfolio/closed-positions/loading.tsx` | Kicker block + H1-height block + a detail-line block (realized-to-date line) on the left, one pill block (Export CSV) on the right; a `SkeletonCard` in the 6-col summary shape (reuse `SkeletonStatBand columns={6}`, card-wrapped per the Ruled stat band card-wrapped variant); a filter row (one pill-shaped block for the ticker filter, three short label blocks for All/Winning/Losing); `SkeletonTable rows={6}`. |
| `portfolio/[ticker]/loading.tsx` | Same header/quote-card/tab-bar composition as `research/[symbol]/loading.tsx` (TD-32: this page reuses the Research detail screen's chrome, see UX flows → "Position detail" — its skeleton reuses the *same* skeleton composition for the same reason). Per `plans/2026-07-19-positions-tab.md`, the quote card is now literal parity, not just geometric similarity — both pages render the identical general-market 4-col grid (Current price / Day range / 52-week range / Market cap), so the skeleton's 4 equal columns, card-wrapped, `border-line2` verticals need no per-page distinction at all (skeletons never render real cell labels regardless). |
| `settings/loading.tsx` | Kicker block + H1-height block on the left (no right-side action in the header — Settings has no page-level pill action, unlike the other routes above). Below: two `SkeletonCard editorial` blocks in page order (Composite score, then Fundamental score), each containing a kicker-height block (section header) then a single short `kicker`-variant block (approximating the live group-total/validity status line — **revised, `plans/2026-07-21-scoring-weights-direct-percent.md`**: no longer a `SkeletonStatBand columns={5}`, since the real band it stood in for was removed) then, **revised per `plans/2026-07-21-scoring-picker-chips.md`** (ADR-26 — supersedes the single compact trigger-row/chevron skeleton the `plans/2026-07-21-scoring-picker-collapsible-ux.md` note previously specified here, since the real picker is no longer a disclosure), a **kicker block + a wrapping row of several small chip-shaped skeleton blocks**: one `kicker`-variant block (the "Start from a style" label, same width class as every other `kicker`-variant block in this table) followed by a `flex flex-wrap gap-2` row of `SkeletonBlock`s sized to the real chip (`h-8 rounded-full`, a handful of varied narrow widths sampling short/long preset labels — no fixed count needs to match the live 9-or-6 exactly, since skeletons approximate shape, not literal content) — **no chevron, no disclosure, no bordered list** — because the real picker is now an always-visible inline row, its skeleton must also render as an inline row, not a collapsed trigger; then 5 paired blocks approximating the label+input weight-stepper rows (a `kicker`-variant block over a `h-10` block, per dimension), then a `pill`-variant block (Reset to defaults) at the card's end. See UX flows → "Settings — scoring weights" for the real layout this mirrors. |

**Rule for the Coding agent:** every skeleton mirrors its real page's column
count, card count, and block order — never a generic "3 boxes" placeholder. If a
route's real layout changes later, its `loading.tsx` composition must be updated in
the same change (flag as an out-of-sync skeleton is a design regression, not just a
missed polish item).

**Confirmed as a first-class navigation state** (Designer review,
`plans/2026-07-19-meridian-nav-responsiveness.md`): this pattern was originally
specced for the hard/first-load case; `plans/2026-07-19-meridian-nav-responsiveness.md`
removes the render-blocking layout-level session check that was preventing these
same six `loading.tsx` boundaries from ever painting during intra-group
navigation (nav clicks, position/row clicks). No skeleton markup changed — only
when they become visible. Reviewed all six against their now-shipped pages
(`dashboard`, `wishlist`, `research`, `research/[symbol]`,
`portfolio/closed-positions`, `portfolio/[ticker]`) and confirmed, using only
tokens/components already named above:
- **Shape fidelity** — each skeleton's column count, card count, and block order
  still matches its page 1:1 (e.g. `portfolio/[ticker]/loading.tsx`'s 3 pill
  blocks vs. `research/[symbol]/loading.tsx`'s 2, correctly reflecting that page's
  extra Buy-more/Sell/Delete action) — swap to content is not a jarring reflow.
- **Shimmer at short durations** — `SkeletonBlock` is still exactly `bg-fill` +
  Tailwind's stock `animate-pulse` (verified no custom keyframes override it in
  `tailwind.config.js`); a smooth opacity-only cycle reads calm even when visible
  for only a few hundred ms, unlike a sweep/gradient shimmer would.
- **Masthead coherence** — `<Navigation>` (the Masthead component) never itself
  carries `animate-pulse`; it stays static `bg-background` chrome above the
  pulsing `bg-fill` skeleton body, the same stable-chrome-over-loading-region
  relationship the rest of the app already uses (e.g. Card loading states).

No new token, color, spacing value, or component was introduced by this
confirmation — this note only records that the existing pattern is now reachable
on every intra-group navigation, not only on a hard reload.

### Order-summary total row
Label/value rows at 13.5px `--sub`, `4px 0` padding each. Final "Total cost" row sits
above a `3px double var(--ink)` top rule with `12px` margin-top / `14px` padding-top,
rendered at Newsreader 22px in `--ink` (no muted styling — this is the number the
screen exists to show). Used identically in Buy-more/Sell-position modals per the
plan's Task 10 (shared form surface).

### Weight stepper (numeric input, ledger form field)
The control for entering a dimension's weight (Settings — scoring weights, see UX
flows). **A numeric input, not a slider** — decided over `components/ui/slider.tsx`
(Radix) per `plans/2026-07-20-configurable-scoring-weights.md`'s Designer note, and
unchanged by the revision below: a precise numeric field is the existing
Add-position form idiom applied to a new field, not a new primitive. A 20px
round-thumb filled-track slider remains rejected as a heavier, more "app-like" motif
than Meridian's flat ruled surfaces, and would be the first rounded/filled
interactive control in the system. No Slider component entry is added —
`slider.tsx` remains unused by this feature and by the rest of the app today.

**Revised meaning (`plans/2026-07-21-scoring-weights-direct-percent.md`,
supersedes OD-4/the auto-normalize model below): the number the user types IS the
dimension's percent weight (0–100 whole), not an arbitrary relative number that
gets normalized after the fact.** The owner's stated objection to the prior model
was the "type-and-watch-normalized-%" loop; direct percentages remove the
translation step entirely — what you type is what is scored (after the group
passes its sum-to-100 validity check; see the "Settings — scoring weights" UX-flow
section below for the group-total/validity readout and save-gate this drives).

This is still exactly the Add-position form's label+input field pattern
(`app/(dashboard)/portfolio/add/page.tsx`), reused verbatim, not reinvented:
- **Label** — kicker-style, `text-[10.5px] uppercase tracking-[0.12em] text-mut
  mb-2 block`, the dimension name ("Technical", "Valuation", etc.) followed by a
  literal `%` — e.g. **"Technical %"** — so the field's meaning (a percent, not an
  arbitrary weight) is legible from the label alone without adding any per-field
  suffix chrome inside the input. Decided over an inline trailing "%" glyph inside
  the field (e.g. `right-3` absolutely positioned over the input) because that
  would require new padding/positioning rules on the existing `inputClass` idiom
  the Add-position fields also use unchanged — pushing the affordance into the
  label keeps the field itself byte-identical to every other text field in the
  system, one label convention doing the whole job.
- **Field** — `<input type="text" inputMode="decimal">`, class
  `w-full h-10 box-border rounded-md border border-border bg-background px-3.5
  text-sm text-foreground outline-none` (the exact `inputClass` constant from the
  Add-position page — `--bg` cutout background, 1px `--line` border via
  `border-border`, radius 6px via `rounded-md`, 40px height, no focus glow). Same
  free-text parsing pattern as the Add-position quantity/price/fees fields (a
  controlled string state) — not a native `<input type="number">` spinner, which
  would introduce a different, unprecedented micro-interaction (browser spinner
  arrows) this system has never used.
- **Range and step — whole percents, 0–100.** The value is a whole number of
  percentage points; the control stays a free-text field (no native spinner per
  above), but the accepted/parsed range narrows from "any non-negative real
  number" to **0–100 inclusive, integers** — matching what the value now means.
  Decimal keystrokes are not blocked at the keystroke level (still
  `inputMode="decimal"`, consistent with every other numeric field in this system
  not hard-masking input), but a value outside `[0, 100]` or non-integer keeps the
  section's group-total indicator in its invalid state and Save disabled (see UX
  flow) exactly as an off-100 sum does — one validity mechanism covers both "wrong
  range" and "doesn't sum to 100," not two separate error treatments.
- **Layout** — one label+field pair per dimension, arranged in the section Card's
  own grid (`grid grid-cols-2 gap-6` on wide viewports, matching the Add-position
  form's two-column field grid; single column below the form's existing
  responsive breakpoint — no new breakpoint token introduced). Unchanged by this
  revision.

<details>
<summary>Superseded: arbitrary relative-weight range, no label "%" (2026-07-20, prior revision)</summary>

The original spec accepted **any non-negative real number the user types (0
upward, integers or decimals both valid — a value of `0` is a legal "exclude this
dimension" input)**, reasoning that `normalizeWeights` treats input as arbitrary
relative weights with no fixed max, so no client-side upper clamp was specced
beyond the API's reject-negative/non-finite guard. The label carried no "%"
suffix, since the typed number was not itself a percentage — the live normalized-%
band (see the superseded note in the UX-flow section below) was the only place a
percent appeared. Superseded by the direct-percent model above: the owner asked
for the typed number to be the actual percent, so the range tightens to 0–100 and
the label gains the "%" affordance described above.
</details>

### Style preset picker (Settings — scoring weights)
A per-section, one-click way to populate a Weight stepper group with a named,
curated allocation instead of typing five percentages from scratch
(`plans/2026-07-21-scoring-style-presets.md`, revised — **visible
descriptions** — by `plans/2026-07-21-scoring-style-descriptions-retune.md`,
revised again — **collapsed-by-default disclosure** — by
`plans/2026-07-21-scoring-picker-collapsible-ux.md` (ADR-25, now superseded),
revised again — **inline name-chip row + accessible tooltip** — by
`plans/2026-07-21-scoring-picker-chips.md` (ADR-26, current)).
**Named component** — added here because neither existing idiom fits its
semantics: **Pill sub-nav** (Components above) is a persistent view-switcher
with a lasting active state, and this is a momentary, fire-and-forget action
with **no persisted "selected" state** (per the plan's Assumptions — nothing
records "you are on Value," so there is never an active option to paint);
**Segmented tabs** is likewise a lasting-selection idiom.

**Latest revision (2026-07-21, scoring-picker-chips plan, ADR-26): the picker
is a compact wrapping row of style-NAME-only chips, shown INLINE and always
visible — no disclosure — with each chip's description in an accessible
tooltip that opens on hover and on keyboard focus.** The owner's stated
problem with the two prior shapes: ADR-24's always-visible label+description
row list was tall enough (nine/six rows) to bury the five Weight stepper
fields, and ADR-25's fix — collapsing that same tall list behind a
disclosure — traded that problem for an extra click before any preset is
reachable at all. A name-only chip is short enough that the whole row (nine
chips on Composite, six on Fundamental) wraps to one or two lines and sits
inline above the fields with no collapse needed; the description moves out of
the chip and into an on-demand tooltip, because most users pick a style by
its name (Value / Growth / Momentum / …) and reach for the description only
when a name is ambiguous. **This deliberately reverses ADR-24's
always-visible-description decision** — the accepted tradeoff (recorded in
ADR-26) is compactness and name-scannability over always-visible text,
**provided the tooltip is a real accessible tooltip, not the bare `title`
attribute ADR-24 was created to replace** (mouse-only, invisible on touch and
to screen readers). The disclosure ADR-25 added is removed outright: it
existed only to hide the tall description list, and that list no longer
exists.

**Structure — inline chip row, no disclosure:**
- **Kicker label** — a plain, always-visible text node above the chip row
  (reverts to a standalone kicker; it is no longer a `<summary>` as it was
  under ADR-25's collapse): `text-[10.5px] uppercase tracking-[0.12em]
  text-mut`, copy **"Start from a style"** — same class and copy as every
  prior revision's label, just no longer wrapped in a disclosure trigger.
- **Chip row** — `flex flex-wrap items-center gap-2`, sitting directly below
  the label. One chip per preset from `presetsForGroup(group)`, in
  authorship order (unchanged: Value · Deep Value / Contrarian · Quality
  (GARP) · Growth · Momentum · Sentiment / News-driven · Analyst Consensus ·
  Dividend / Income · Balanced for Composite — nine; the same list minus
  Momentum, Sentiment / News-driven, and Analyst Consensus for Fundamental —
  six). Chips wrap to as many lines as needed at this `gap-2` — never
  `overflow-x` scroll or truncation, matching this system's general aversion
  to nested scroll regions (see Style preset picker's own disclosure-era
  rejection of a scrollable list, and Loading skeleton's "no new motion
  idiom" register).
- **The chip itself** — a native `<button type="button">`, compact: `h-8
  rounded-full border border-line bg-transparent px-3.5 text-[12px]
  font-medium text-foreground`. This is the exact chip/pill sizing this
  component used in its very first revision (Components → the superseded
  note at the end of this entry, "compact pill row"), reused verbatim now
  that the description no longer needs to live inside it. Chip **text is the
  preset's `label` only** — e.g. "Value", "Deep Value / Contrarian",
  "Growth" — never the `blurb`; the blurb lives in the tooltip only (see
  Tooltip below). Being genuinely compact (single line, no wrap inside the
  chip) is the entire point of this revision — it is what lets nine/six
  chips sit inline above the fields with no collapse.
- **States** (color values only — no new tokens; no distinct chip token set is
  introduced, it reuses the Secondary button's border/fill/text tokens at a
  smaller height tier):
  - **Default** — transparent fill, 1px `--line` border, `--ink` text.
  - **Hover** — background steps to `var(--fill)` (the system's one
    hover-fill rule, Spacing/shape → Row hover), border and text unchanged.
  - **Active (mouse-down/pressed)** — no distinct pressed-state token exists
    elsewhere in the system for buttons or rows; omit a separate `:active`
    visual beyond the browser default, matching every other button/row in
    this app (Style preset picker's own row states, Reset/Save pills).
  - **Focus-visible** — `outline: none` plus this system's existing focus
    treatment, "rely on border" (Spacing/shape → Inputs): border steps to
    `--ink` on focus-visible (`focus-visible:border-foreground` or
    equivalent) — no ring, no glow, matching the pill-row revision's own
    prior focus treatment (see the superseded note below) rather than the
    inset-ring treatment the row-list revision used, since a pill's own
    border is the affordance here, not a ring inside a bordered list
    container that no longer exists.
  - **CRITICAL — no persistent "selected/active" chip state, at all.** A chip
    is a momentary action (it populates the fields and nothing else), not a
    toggle — do not add a checked/selected/"currently applied" visual to any
    chip, before or after it is clicked, regardless of whether the fields
    currently match that chip's values. This is the same no-active-state rule
    ADR-23/24/25 established for the option rows, carried forward verbatim
    to the chip shape: nothing in this component's state model behaves like
    a checked/radio control.
- **Placement — inline, in the same slot the picker has always occupied.**
  Directly below the group-total/validity status line (item 2 in "Settings —
  scoring weights") and directly above the five Weight stepper rows (item 4
  there) — unchanged by this revision. `margin-top:4px` from the status
  line's own bottom margin (now the kicker label's top, replacing the
  trigger row that occupied this slot under ADR-25), `margin-bottom:20px`
  above the first stepper row (reuses the status line's existing spacing
  slot — no new spacing token), applied after the chip row itself since
  there is no longer a collapsed/expanded distinction to account for: the
  chip row is always fully rendered, so the gap to the first Weight stepper
  field is now constant regardless of chip count (it simply wraps to more
  lines on Composite's nine than Fundamental's six).

**Tooltip (blurb-on-hover-and-focus) — reuses `components/ui/tooltip.tsx`
(Radix `Tooltip`/`TooltipTrigger`/`TooltipContent`) verbatim, no new
primitive:**
- **Trigger** — the chip itself is the `TooltipTrigger` (`asChild`, so the
  trigger *is* the `<button>`, not a wrapper element around it).
- **Content surface** — `TooltipContent` renders on the existing
  `--popover`/`--popover-foreground` tokens (already wired into
  `components/ui/tooltip.tsx`'s default classes: `rounded-md border
  bg-popover text-popover-foreground`, `shadow-md` — the component's stock
  shadow-bearing chrome; keep it as shipped rather than stripping the shadow
  to match this system's normally shadow-free surfaces, since `--popover` is
  the one surface class in this system already carrying its own elevation
  treatment via shadcn, and diverging it card-by-card would be a one-off,
  not a system rule). Padding and radius are the primitive's existing
  `px-3 py-1.5` / `rounded-md` — no override needed.
- **Blurb text** — Type scale → "Secondary / detail text" register (12–
  12.5px, normal weight) on `--popover-foreground`; the primitive's stock
  `text-sm` class is close enough to this system's 12–12.5px "Secondary /
  detail text" scale that no override is needed — do not introduce a new
  text-size utility solely for this tooltip.
- **Max-width** — `max-w-[240px]` so a one-line blurb wraps onto two short
  lines rather than stretching into one very long line that overshoots the
  chip row's own visual density; blurbs are one sentence, so 240px comfortably
  wraps to 2–3 lines without feeling cramped.
- **Arrow / offset** — no `TooltipPrimitive.Arrow` (the primitive does not
  render one by default and none is added here — an arrow would be a new
  visual affordance this system has not used elsewhere); `sideOffset={4}`,
  the primitive's own default, is kept as-is.
- **Open delay** — `delayDuration={200}` on the section-local
  `TooltipProvider` (Spacing/shape → Theme transition documents this app's
  motion register as `.25s`/250ms for the theme fade and the 200ms
  `transition-transform` already used by the chevron in the now-superseded
  ADR-25 disclosure — 200ms is the "quick, not sluggish" value already
  established in that register, applied here to hover-open latency so
  tooltips feel responsive without popping instantly on every incidental
  mouse pass over the row). Keyboard focus opens **immediately** — Radix
  does not delay focus-triggered opens the way it delays hover-triggered
  ones, and that default is kept (a delay on focus would make Tab-driven
  discovery feel laggy, the opposite of what a keyboard-focus reveal is for).
- **A11y contract (fixed by the plan, documented here so it is not lost):**
  opens on **hover** and on **keyboard focus** (Tab to a chip → tooltip
  shows); closes on blur / mouse-leave; **`aria-describedby`** links the chip
  to its blurb (Radix wires this automatically from `TooltipTrigger` to
  `TooltipContent`, no manual `id`/`aria-describedby` plumbing needed);
  **Escape** dismisses it while the chip is focused. **Touch/tap does not
  open the tooltip** — an accepted tradeoff (ADR-26): the chip's own
  accessible name is the style name, which is self-describing, so a touch
  user can still choose a style without the blurb; the blurb is
  supplementary context, not required to act; this app is web-only,
  desktop-primary (PRODUCT.md), so hover+focus covers the primary input
  modalities. Do not attempt to add a tap-to-reveal affordance to satisfy
  this without a separate design pass — it is out of scope here.
- **No `title` attribute anywhere carrying the blurb** — the banned
  regression this whole revision is designed not to reintroduce.

**Structure this replaces — the disclosure (ADR-25, superseded by ADR-26) and
the always-visible row list it wrapped (ADR-24, superseded by ADR-26) are both
preserved below for history, not deleted:**

<details>
<summary>Superseded: collapsed-by-default disclosure wrapping a bordered option-row list (2026-07-21, ADR-25, superseded by ADR-26)</summary>

**Prior revision (collapsible-UX plan): the whole picker — kicker
label + bordered option-row list — was wrapped in a collapsible disclosure,
closed by default.** The owner's stated problem at the time: the always-visible
nine/six-row list (the revision below this one) dominated the section's Editorial
card and pushed the five Weight stepper fields below the fold on first load.
The fix was a disclosure, not a shorter list — shrinking or truncating the rows
was explicitly rejected (it would have reintroduced the exact invisible-description
problem the prior revision fixed, see ADR-24/the superseded note below it).
Collapsing removed the list from the *default* view while keeping every row
byte-identical, fully visible, for the user who opened it. **Superseded by
ADR-26:** once the descriptions moved into a tooltip, the option-row list
shrank to a short name-only chip row that no longer needs hiding, so the
disclosure's reason for existing (keep a tall list off the default view) no
longer applies, and it is removed.

**Structure — trigger + disclosed body:**
- **Trigger row (always visible, collapsed or expanded)** — a single compact
  row, `flex items-center justify-between gap-2 py-1` (no card-within-card
  border of its own; it sits flush in the section's existing content flow,
  same left edge as the status line above it and the Weight stepper labels
  below it):
  - **Left side** — the existing kicker label, unchanged: `text-[10.5px]
    uppercase tracking-[0.12em] text-mut` (byte-identical class and copy to
    the label in the prior revision, below), copy **"Start from a style"**,
    plus an optional one-line hint immediately after it in the same kicker
    run (not a second line): **"— prefill weights from a named investing
    style"** (em-dash separator, same `text-mut` color, same 10.5px size, no
    new type-scale row — this is the kicker row's own text, just longer).
    The hint is optional per-implementation (Coding agent may omit it if the
    row reads cleanly without it); if included, it must not wrap the kicker
    onto a second line on the section card's minimum supported width — drop
    the hint clause first on narrow viewports rather than wrapping.
  - **Right side** — a chevron affordance: `<ChevronDown>` from `lucide-react`
    (already a dependency, ARCHITECTURE.md), `h-4 w-4 text-mut` (16px, the
    same icon size and the same `--mut` color already used for every other
    small inline icon in this app, e.g. the account-menu icons in
    `components/navigation.tsx` — no new icon size or color introduced).
    Rotates 180° when expanded via `transition-transform duration-200`
    (Tailwind's default transform-transition timing; this app's only other
    animated properties are the `.25s` theme-transition fade and the chart
    range-morph — 200ms is in the same "quick, not sluggish" register as the
    250ms theme fade, close enough to read as one motion language rather than
    a second one, and is Tailwind's own default so it introduces no bespoke
    duration constant). No color change on open — the chevron stays `--mut`
    in both states; only its rotation communicates state, matching this
    system's general preference for one state cue (position/rotation here,
    color/fill elsewhere) rather than stacking multiple simultaneous cues for
    the same fact.
  - **Hover** — the trigger row background shifts to `var(--fill)` (the
    system's one hover-fill rule, Spacing/shape → Row hover), applied to the
    trigger's own row bounds only (not the collapsed/hidden body) — reusing
    the exact hover idiom the option rows themselves use one level down, so
    hovering "the picker" always means the same visual regardless of whether
    you're hovering the trigger or (once open) a row inside it.
  - **Focus-visible** — same treatment as the option rows below: `outline:
    none` plus `focus-visible:ring-1 focus-visible:ring-inset
    focus-visible:ring-foreground` (inset `1px --ink` ring, Spacing/shape →
    Inputs: "no focus ring glow — outline none, rely on border"). No new
    focus token; this is the same ring already specced for the option rows,
    applied one level up to the trigger.
- **Pattern — native `<details>/<summary>` preferred over a button + `useState`
  region.** Recommended over the alternative because it gives closed-by-default,
  keyboard support (Tab-reachable, Enter/Space toggles), and expanded-state
  exposure to assistive tech for free — no `aria-expanded` wiring needed, no
  risk of the state and the DOM disagreeing. The `<summary>` element carries
  the trigger row's classes above (kicker + hint + chevron as its content); the
  option-row list (below) is the `<details>` element's body content, rendered
  only in the accessibility tree/interaction sense when open (browsers keep
  closed `<details>` content in the DOM but `display:none`-equivalent, so no
  client-side conditional-render logic is needed either). A row's own `<button
  type="button">` click inside the body is not swallowed by the `<summary>`
  toggle — only the `<summary>` element itself toggles the disclosure, so
  clicking an option row applies the preset without also closing the
  disclosure as a side effect. The plan accepts a button-controlled
  `aria-expanded`/`aria-controls` region as an equally spec-compliant
  alternative if `<summary>`'s default browser-drawn marker (the disclosure
  triangle some browsers render before `<summary>` content) cannot be
  suppressed cleanly with `list-style:none` / `::-webkit-details-marker` — in
  that case the custom chevron is the only disclosure indicator, and the
  button variant needs the same trigger classes, hover, and focus-visible
  treatment specified above, plus `aria-expanded={open}` and
  `aria-controls` pointing at the body's `id`.
  - **Keyboard behavior** — Tab reaches the trigger (one stop, whether
    `<summary>` or a button); Enter or Space toggles open/closed; the
    expanded/collapsed state is announced to assistive tech (native for
    `<summary>`; via `aria-expanded` for a button trigger). Tab order end to
    end: kicker/trigger → (only when open) each option row, in order → Weight
    stepper fields → actions row. When collapsed, Tab skips straight from the
    trigger to the Weight stepper fields, since the option rows are not
    reachable while hidden — this is the mechanism that makes "closed by
    default" also shorten the keyboard path, not only the visual one.
- **Stays open after a row click — does not auto-collapse.** Clicking (or
  Enter/Space-activating) an option row applies the preset
  (`setInputs(toInputs(preset[group]))`, unchanged, see Interaction below) and
  the disclosure remains expanded afterward. Decided over auto-collapse: the
  user may want to compare another style's row before committing, or wants to
  see which row they just clicked next to the fields it populated — closing
  the list out from under them the instant they click is a surprising,
  unrequested side effect for a populate-only action, and the plan's own
  default (Assumption 1) is leave-open "unless a strong design reason"
  exists; there isn't one here that outweighs the surprise cost. This also
  needs no extra state wiring for a `<details>` element (no `onClick` handler
  closing it), keeping the disclosure's implementation exactly as thin as the
  native element already makes it.
- **No persisted "expanded" state across page loads.** Every section starts
  collapsed on every fresh render/navigation, regardless of whether the user
  had opened it earlier in the same session — this is a transient UI
  affordance, not a preference, consistent with nothing else on this page
  persisting UI-only state (e.g. no field remembers being previously edited
  across a reload).
- **CRITICAL — the collapse does not reintroduce active-preset state.** The
  option rows inside, once expanded, keep the exact "No 'selected'/active-preset
  visual state, ever" rule from the prior revision (States, below) — the
  disclosure hides the list by default; it does not add a new "last applied"
  highlight to compensate. Collapsing the list is the answer to "the list is
  too visually loud," not a reason to add new visual state inside it.

**Prior revision (ADR-24), unchanged by the ADR-25 disclosure wrapper above at
the time — this was the content the disclosure framed, not something it
restyled. Also superseded by ADR-26 (its always-visible-description
presentation, specifically — the blurb copy and preset values it carries are
NOT superseded, see ADR-26's Status line):**

**Revised shape (2026-07-21 descriptions-retune plan, supersedes the
compact-pill-row treatment in the superseded note at the end of this entry):
each option is now a full-width row — label + its always-visible `blurb`
stacked beneath it — not a bare label-only pill.** The owner's directive: the
description was previously exposed only via a native `title` tooltip
(invisible on touch, on scan, and to most users); it must now read as
visible text under every option's label, at up to nine rows (Composite) and
six (Fundamental). A wrapping grid of variable-height cards was considered
and rejected: at 9 items, cards of uneven height (blurbs vary in line count)
reflow unpredictably across rows, breaking left-edge scanning — exactly the
failure mode a "richer" treatment must avoid. A single-column list of
fixed-structure rows (kicker-scale label, then a `--mut` caption line
beneath it, every row) stays scannable regardless of item count, because
the eye tracks one consistent left edge top-to-bottom instead of parsing a
reflowing grid. This reuses the **Editorial coverage list** component's row
idiom (Components → "Editorial coverage list": hairline-divided rows, row
hover, cursor pointer) rather than inventing new list chrome — the picker is
that same "hairline rows, `--fill` hover" pattern applied to a two-line
label+description cell instead of a headline+tag cell.

- **Placement — the disclosure wrapper (trigger + body) occupies the same
  slot the always-visible list used to.** Inside each `ScoringWeightsSection`
  Editorial card, directly below the live group-total/validity status line
  (item 2 in "Settings — scoring weights") and directly above the five Weight
  stepper rows (item 4 there, immediately after this picker's own item 3): a
  starting point for tuning still belongs before the fields it fills, and
  after the status line so both live in the same visual block before the
  field grid begins. `margin-top:4px` from the status line's own bottom
  margin (now the trigger row's top), `margin-bottom:20px` above the first
  stepper row (reuses the status line's existing `margin-bottom:20px` slot —
  no new spacing token) applied after the disclosure's body **when open**,
  or directly after the trigger row **when closed** — either way the gap to
  the first Weight stepper field is the same 20px, so the fields never
  shift position based on the disclosure's state beyond simply moving up
  when the body is hidden.
- **Structure when expanded** — the disclosure's trigger row (see the
  collapsible-disclosure revision above for its own spec: kicker label +
  optional hint + chevron) sits above a bordered, hairline-divided list of
  option rows (not a wrapping pill row), unchanged in every visual respect
  from the prior revision below. **The standalone kicker label described
  below is now the trigger row's label — it is not duplicated** (the
  disclosure revision above supersedes only the label's *position*, moving
  it from "always above the list" to "inside the always-visible trigger";
  its class, copy, and meaning are unchanged).
  - **List container** — `rounded-md border border-line divide-y
    divide-line2` (a bordered list wrapper: 1px `--line` border all
    around, radius 6px — matching the Weight stepper field's own input
    radius, since this list sits in the same field-adjacent visual tier —
    with `1px --line2` hairline dividers between rows, none after the
    last, exactly the Hairline row dividers rule already in Spacing/shape).
    No card-within-card effect: this list sits directly inside the
    section's own Editorial card, one visual layer down, the same way a
    table sits inside a page without its own second card chrome.
  - **Each option row** — a native `<button type="button">` filling the
    full row width: `w-full flex flex-col items-start gap-1 px-4 py-3
    text-left bg-transparent`, containing exactly two lines:
    1. **Label line** — the preset's `label` (e.g. "Value", "Growth",
       "Deep Value / Contrarian"), sans 13.5px/500 `--ink` (Type scale →
       "Body / table text" weight bumped to 500 for emphasis, matching how
       Market value / Realized P/L cells use weight 500 over the same
       13.5px body size elsewhere in this system — no new size token).
    2. **Description line** — the preset's `blurb`, sans 12–12.5px `--mut`
       (Type scale → "Secondary / detail text" row, the same scale already
       used for detail lines under stat values and table secondary cells),
       normal weight, wrapping to as many lines as the copy needs (blurbs
       are one sentence; no line-clamp or truncation — the whole point of
       this revision is that the description is fully readable, not
       clipped).
  - **Order** — unchanged: presets render in `presetsForGroup(group)`'s
    array order (`lib/utils/scoring-weights.ts`), authorship order, not
    alphabetical: Value · Deep Value / Contrarian · Quality (GARP) · Growth ·
    Momentum · Sentiment / News-driven · Analyst Consensus · Dividend /
    Income · Balanced for Composite (nine); the same list minus Momentum,
    Sentiment / News-driven, and Analyst Consensus for Fundamental (six).
    Balanced sits last in both lists — it mirrors "Reset to house defaults"
    immediately below it, so ending the list on the house-default entry
    keeps the picker's reading order and the actions row's own
    default-affordance in visual agreement.
- **States** (color values only — no new tokens):
  - **Default** — transparent fill, `--ink` label / `--mut` description, no
    visible per-row border beyond the list container's own outer border and
    the hairline dividers between rows.
  - **Hover** — background `var(--fill)` (the system's one hover-fill rule,
    Spacing/shape → Row hover, reused here exactly as the Editorial
    coverage list and every clickable table/list row already do — "one row
    hover treatment, not several idioms"); label/description colors
    unchanged.
  - **Active (mouse-down/pressed)** — no distinct pressed-state token
    exists elsewhere in the system for buttons or rows; omit a separate
    `:active` visual beyond the browser default, matching every other
    button/row in this app.
  - **Focus-visible** — `outline: none` plus the system's existing focus
    treatment, "rely on border" (Spacing/shape → Inputs: "no focus ring
    glow — outline none, rely on border"): on focus-visible the row gets an
    inset `1px --ink` ring via `focus-visible:ring-1 focus-visible:ring-inset
    focus-visible:ring-foreground` (inset so it does not get clipped by the
    list container's own rounded corners or bleed outside the row into a
    sibling), no glow, no new color.
  - **No "selected"/active-preset visual state, ever** — per the plan's
    Assumptions, applying a preset does not persist which preset (if any)
    matches the section's current values, so no row is ever painted as
    "currently chosen." Every row always renders in its Default/Hover/Focus
    states only, regardless of what the fields currently hold, and
    regardless of whether it was the most recently clicked row. This is a
    deliberate absence, not an oversight — do not add comparison logic to
    "fix" it. **Each option is a momentary action (a button that fires an
    effect), not a toggle** — nothing in this component's state model
    behaves like a checked/radio control.
- **Interaction — unchanged.** Clicking (or Enter/Space while focused) an
  option row calls `setInputs(toInputs(preset[group]))` for that section
  only — the same `setInputs` call `handleReset` already makes, just seeded
  from `preset[group]` instead of `defaultPercents`. This is
  **populate-only**: no `PUT` fires, Save is not invoked, and the section's
  existing dirty/valid computation (`computeGroupTotalState`) reacts exactly
  as it would to manual typing — because every preset group sums to 100 by
  construction, the status line immediately reads its valid state and Save
  enables via the existing dirty gate, with zero special-casing for "a
  preset was clicked." The user still reviews the five populated fields and
  presses the existing **Save weights** pill to persist.
- **The `blurb` is now the primary description surface.** The `title`
  attribute carrying the blurb (the prior spec's sole affordance) is
  redundant now that the same text is always-visible: it may be kept
  (harmless progressive enhancement) or dropped — Coding agent's call,
  either is spec-compliant.
- **Keyboard / a11y** — each option is a native `<button type="button">`
  (never a `<div onClick>`), Tab-reachable one stop per row, activates on
  Enter and Space with no extra wiring, and is announced by screen readers
  using its own visible text — **both the label and the description line,
  concatenated as the button's rendered text content** — as its accessible
  name (no `aria-label` override needed: the description being part of the
  button's visible content means it is part of the accessible name for free,
  an improvement over the prior pill's label-only name). This preserves full
  parity with the pills' keyboard/a11y behavior (Tab-reachable, Enter/Space
  activates, no toggle/checked semantics) while strictly improving the
  accessible name's completeness. **Tab order and the kicker label's role are
  now governed by the disclosure spec above** (the label lives in the
  trigger row, not as a standalone text node above the list, and rows are
  only Tab-reachable while the disclosure is open) — this bullet's
  per-row button semantics are otherwise unchanged.
- **Light/dark themes** — every value referenced above (`--line`, `--line2`,
  `--ink`, `--fill`, `--mut`) is a themed CSS variable already carrying
  distinct light/dark values per the Colors table; the picker requires no
  theme-conditional styling of its own; the same class list produces the
  correct look in both themes automatically, exactly like the "Reset to
  house defaults" button beside it in the same card.
- **Composite vs. Fundamental consistency** — both sections render the exact
  same component (label copy, list container, row classes, spacing,
  states); the only difference between the two cards' pickers is the list
  length (nine rows vs. six) and which presets appear, both driven purely
  by `presetsForGroup` data — never a chrome difference between the two
  sections. Six rows and nine rows both stay scannable under this list
  treatment because row height is driven by content (one label line + one
  wrapping description line), not a fixed grid cell — the list simply gets
  taller, it never gets denser or truncated.

<details>
<summary>Superseded: compact pill row, description in <code>title</code> tooltip only (2026-07-21, prior revision, superseded first by ADR-24's visible-description rows, whose chip sizing/token values ADR-26 above later re-adopts verbatim for the current inline chip row)</summary>

The original spec rendered each option as a compact `h-8` (32px) pill in a
`flex flex-wrap gap-2` row, reusing the Secondary button token set at a
smaller height tier (`h-8 rounded-full border border-line bg-transparent
px-3.5 text-[12px] font-medium text-foreground`), showing only the
preset's `label` text; the `blurb` was exposed solely via a native `title`
attribute (hover/focus tooltip, invisible on touch and on scan). Default
state was `--line` border / `--ink` text / transparent fill; hover was
`var(--fill)`; focus-visible stepped the border to `--ink`. Superseded by
the visible-description list above per
`plans/2026-07-21-scoring-style-descriptions-retune.md` — the owner's
directive was that the description must be legible without hovering, which
a `title`-only tooltip structurally cannot satisfy. (Note, ADR-26: the
current — non-superseded — revision at the top of this entry returns to
this exact `h-8` chip sizing and default/hover state, but pairs it with an
accessible Radix hover+focus tooltip instead of a `title` attribute, so the
sizing is reused while the a11y problem that superseded it here is not
reintroduced.)
</details>

</details>

### Card
Base surface for every non-table content block: `--card` background, 1px `--line`
border, radius 8px, padding 24–28px (32px for forms). Optional variants:
- **Editorial card** — adds `border-top: 3px double var(--ink)` (Morning Note, research
  score breakdown).
- **Bare stat band** — no card wrapper, just the ruled band (see Ruled stat band).

### Segmented tabs (range / section tabs)
Flex row, `18–32px` gap. Inactive: 10.5–11px, `--mut`, transparent 1–2px bottom border
(space reserved). Active: weight 600, `--ink` text, 1–2px `--ink` bottom border. Used
for chart range tabs (1D…Max), Add-position's Price-per-share/Total-amount pair (2px
underline variant), and Closed-positions' All/Winning/Losing filter.

Research-detail's own tab bar is the same pattern at its exact handoff values: flex
row `gap:32px`, `padding:4px 4px 0`, `1px --line` bottom border under the whole row.
Each tab: sans 11px/uppercase/0.14em, `padding-bottom:12px`, `cursor:pointer`,
`white-space:nowrap`. Inactive: `--mut`, no border. Active: weight 600, `--ink` text,
`2px solid --ink` bottom border. Client-side tab state, up to 7 tabs: Overview ·
Technical · Fundamental · Analysts · Intrinsic value · **Positions** · News &
sentiment.

**Positions tab — conditional, not always present (per
`plans/2026-07-19-positions-tab.md`):** the tab formerly labeled "Transactions" is
renamed **"Positions"** and is now **omitted from the tab bar entirely** when the
symbol has no transactions on file (the "has-or-had-a-position" signal — see UX
flows → "Research detail — tab-by-tab" item 6 for the exact rule and the
closed-position state). A never-transacted symbol therefore renders a **6-tab** bar
(Overview · Technical · Fundamental · Analysts · Intrinsic value · News &
sentiment); a symbol with any transaction history (currently held or fully sold)
renders the full 7-tab bar with Positions in its usual 6th slot. This conditional
count applies identically on both `/research/[symbol]` and `/portfolio/[ticker]` —
see "Position detail" below. No change to the tab bar's chrome (gap, padding,
active-state underline) — only which tabs are present.

### Pill sub-nav (Fundamental tab)
A second-level nav, distinct from Segmented tabs — filled/outlined pills, not
underlines, because it sits one level below the section tab bar and must not be
mistaken for it. Flex row, `gap:10px`, `flex-wrap:wrap`, `margin-bottom:20px`. Each
pill: sans 10.5px uppercase 0.12em, `padding:8px 18px`, `border-radius:16px`,
`cursor:pointer`, `white-space:nowrap`. Inactive: `--mut` text, `1px --line` border,
transparent fill. Active: `--btnbg` fill, `--btnfg` text, weight 600, no border. Six
pills, client-side state: Overview · Valuation · Profitability · Growth · Health ·
Dividend — switches which single card renders below (Overview = 2-col
score-breakdown grid + Revenue-by-segment card; the other five = one grouped-metrics
card each, per `## UX flows → Research detail`).

### Dashboard SVG performance chart
Per ADR-10: a purpose-built inline SVG (not Recharts) on the dashboard hero only —
`lib/utils/chart-path.ts` exports the pure `buildPath()` Catmull-Rom→cubic-bezier
function ported from the prototype's `buildPath(vals, w, h)`. Rendering spec: viewBox
`0 0 1300 220`, 3 hairline `--line2` gridlines, ink line at
1.5px stroke width, no fill on the line, a separate fill-only area path
(`chartLine + 'L{w},{h}L0,{h}Z'`) at `fill:var(--ink)` `fill-opacity:0.05` and
`stroke:none`, and a `--line` (not `--line2`)
baseline rule at the bottom. Range-change morph: 500ms, ease-in-out
(`k<0.5 ? 2k² : 1-(-2k+2)²/2`), driven by `requestAnimationFrame`, interpolating every
point in the 20-point series from its previous value to its new value — not a snap
re-render.

**Gridline/label y-positions are data-derived, not fixed viewBox fractions**
(`plans/2026-07-20-small-visual-fixes.md`, Issue 4 — OD-2 resolved as axis-only
fix; same helper and rationale as `DetailPriceChart`, see that entry above). The
hero previously pinned its gridlines to a fixed fraction of the 220-tall viewBox
(y=55/110/165) which did not match where `buildPath` actually plots the series'
min/max, so a spiky series could render its extremes above/below the labelled
band. Both charts now share the same `gridlineYs` helper (`lib/utils/chart-path.ts`)
so each gridline lands exactly where its corresponding data value plots — do not
re-pin either chart's gridlines to a fixed pixel or fraction again.

**Y-axis price labels (added per `plans/2026-07-18-meridian-dashboard-detail-fixes.md`):**
same treatment as `DetailPriceChart`'s y-axis (3 `--mut` labels via `niceYTicks`,
`formatCurrency`-formatted, positioned as HTML text absolutely against a `relative
pl-14` container — not inside the SVG, which would distort under
`preserveAspectRatio="none"`) at the hero's own (now data-derived) gridline
y-positions — NOT the detail chart's, since the two charts have different
viewBoxes (220-tall vs. 190-tall) and series domains, so the pixel positions
differ even though both are computed the same way. Labels are computed from the
currently *displayed* (animating) series and update live as the range-morph runs.

**Hover crosshair + tooltip (added per `plans/2026-07-18-meridian-dashboard-detail-fixes.md`):**
same three overlay elements as `DetailPriceChart`'s hover — a thin vertical `--line`
crosshair, an `--ink` (foreground) marker dot on the line at the nearest data point,
and a small `--card`/`border-border` shadow-free tooltip showing the hovered point's
date and `formatCurrency(value)` — shown on `mousemove` over the plotted area, all
three hidden on `mouseleave`. During a range-change morph the marker rides the
animating line (reads `animatedValues[hoverIndex]`, not a static array) — this is
correct behavior, not a bug; the crosshair must never interrupt or restart the morph
animation.

**Superseded note (ADR-11):** the prior sentence here said research detail's chart
(`price-chart.tsx`) keeps Recharts, retokenized only. Per
`plans/2026-07-18-meridian-research-detail.md` and ADR-11, that is no longer current
— the research-detail Overview and Technical charts now use `DetailPriceChart` (see
Components → "Detail price chart"), which shares this component's `buildPath`/
`buildAreaPath` primitives but is a separate component (no range-morph; adds a
variable viewBox and reference-line/legend behavior this hero chart does not have).
`price-chart.tsx` (Recharts) is retired once no importer remains — do not build new
screens against it.

**Correction note (supersedes the "no hover/y-axis" distinction above the
ADR-11 note):** this hero chart originally shipped with neither a y-axis nor hover
behavior, distinguishing it from `DetailPriceChart`. Per
`plans/2026-07-18-meridian-dashboard-detail-fixes.md`, the hero now has BOTH the
y-axis price labels and the hover crosshair/tooltip described above, ported from
`DetailPriceChart`'s pixel-mapping approach and sharing the `niceYTicks` helper. The
two charts remain distinct components — do not merge them — but the hero no longer
lacks hover/y-axis; the only behaviors still exclusive to `DetailPriceChart` are its
variable viewBox and the Technical tab's reference lines/legend. Any prior wording
elsewhere in this file describing the hero as having "no hover/y-axis" is superseded
by this note.

---

## Tone of voice

Meridian speaks as a newspaper of record covering one reader's own money — measured,
declarative, editorial, never hyped or chatty.

**Principles:**
- **Kickers over labels.** Section headers are newspaper eyebrows: uppercase, wide
  letter-spacing, muted color — "Under observation · before you invest," "The ledger ·
  completed trades," "New entry · the ledger." Every screen's H1 gets one.
- **Serif for consequence, sans for interface.** Numbers that matter (portfolio value,
  scores, totals) and anything editorial (headlines, pull-quotes, italic asides) are
  Newsreader. Chrome — labels, buttons, table body — is Libre Franklin. Don't swap
  these: serif everywhere reads costume-y, sans everywhere loses the newspaper voice.
- **Italic serif for asides, not instructions.** "as of 17:30 CET," "Current market
  price: €196.40," "Sign in to your account to continue." — quiet, secondary,
  never load-bearing information. If a sentence is required reading, it is not italic.
- **"The Morning Note" framing** for AI-generated portfolio insights: written as a
  dispatch with a drop cap, a pull-quote, and byline-style attribution ("— Portfolio
  impact"), not as a card of bullet points. Risks/Opportunities/Recommendations get
  editorial-page symbols (⚠ / ◇ / →), not icon-font icons.
- **Precision over enthusiasm.** "Time to consider buying," not "Great opportunity!".
  "Trim NVDA toward a 10% target weight," not "You should sell some NVIDIA!" State the
  number, state the implication, stop.
- **№ and · as house punctuation.** Use `№` for numbered list items (insights,
  recommendations) and `·` as a mid-dot separator in kickers and metadata lines
  ("AAPL · Nasdaq", "4 trades settled"), matching the handoff exactly — not "#" or "-".

**Do / Don't**

| Do | Don't |
|---|---|
| "Realized to date: +$545.60" | "You've made $545.60! 🎉" |
| "Time to consider buying" | "Buy now!!" |
| "Tech concentration above 55% of portfolio value." | "Warning: too much tech!" |
| "Under observation · before you invest" | "Your Watchlist" |
| "Sign in to your account to continue." (italic, quiet) | A loud instructional banner |

---

## UX flows

This overhaul is a re-skin: every flow, route, and piece of business logic is
unchanged. The 7 screens covered (per the plan) and their navigation:

1. **Dashboard** (`/dashboard`) — hero portfolio value, currency toggle, stat band,
   performance chart, positions table, "The Morning Note" insights. Entry point after
   login; masthead wordmark always returns here. Rows → Research detail.
2. **Closed positions** (`/portfolio/closed-positions`) — realized P/L ledger, CSV
   export, ticker filter, All/Winning/Losing tabs. Reached via nav "Closed".
3. **Watchlist** (`/wishlist` route; **user-visible copy only** renamed to "Watchlist"
   per ADR-9 — route, files, service, and Prisma schema stay `wishlist`, out of scope
   for this pass) — targets/scores stat band, 13-col scrollable table, add/remove
   actions. Reached via nav "Watchlist".
4. **Research index** (`/research`) — centered search, "Popular this week", 3
   discipline cards (Technical/Fundamental/Intrinsic) linking into the existing
   research flow (no new routes). Reached via nav "Research".
5. **Research detail** (`/research/[symbol]`) — company header, 4-col stat card,
   an up-to-7-tab bar (Overview/Technical/Fundamental/Analysts/Intrinsic value/
   **Positions** (conditional — see below)/News & sentiment), a custom-SVG
   `DetailPriceChart` (ADR-11, supersedes the earlier retained-Recharts plan), and a
   headline score card per tab. Reached from any table row or the research index.
   Full tab-by-tab spec: see "Research detail" below.
6. **Add position** (`/portfolio/add`) — narrow form, stock search, shares/date,
   price-per-share ↔ total-amount tab pair, order summary, Cancel/Add pills. Reached
   from the dashboard's "+ Add position" and research detail's "+ Add to portfolio".
7. **Login** (`/login`) — centered masthead + card, email/password, remember-me,
   forgot-password, sign-in. **Register** (`/register`) is not covered by the design
   bundle; it inherits the Login screen's treatment by direct extrapolation (same
   420px column, masthead block, card, field/label/button patterns) — see the plan's
   `## Assumptions`. No new tokens or patterns are needed for it.
8. **Settings** (`/settings`) — per-user scoring-weight controls (Composite score,
   Fundamental score), a live normalized-% readout, reset-to-defaults, save. Reached
   via the account-menu dropdown ("Settings", `components/navigation.tsx:110-112`,
   which already links here and currently 404s). Added by
   `plans/2026-07-20-configurable-scoring-weights.md`; full spec: see "Settings —
   scoring weights" below.

### Research detail — tab-by-tab

Governing plan: `plans/2026-07-18-meridian-research-detail.md` (ADR-11). Company
header: name (Newsreader 52px) over a `TICKER · EXCHANGE` kicker (sector clause
appended only when the quote payload has it — a data gap when absent, see the
plan's data-gap map); right-aligned "☆ Watchlist" secondary pill + "+ Add to
portfolio" primary pill. Below: the 4-col quote stat card (Current price / Day
range / 52-week range / Market cap), then the Segmented tabs research-detail tab
bar (7 tabs, client-side state — see Components → "Segmented tabs").

Score band thresholds used throughout every tab (presentational only — recolors an
already-computed number, never changes scoring math): **≥ 7 → `--up`, 4–7 →
`--amber`, < 4 → `--dn`, null/unavailable → `--mut`** (same thresholds as Score
figure).

1. **Overview** — `DetailPriceChart period="1Y"` card (no range tabs, static),
   then the Headline score card: 84px composite score + rotated `VerdictStamp` +
   verdict kicker on the left, 5-col `SubscoreBand` (Technical/Fundamental/
   Analysts/Intrinsic/Sentiment) + №-numbered key-insights list on the right.
2. **Technical** — Headline score card: 84px score + verdict kicker + italic
   summary on the left, `DetailPriceChart period="6M"` (+ dashed support/
   resistance reference lines and legend when available — data gap otherwise, see
   Components → "Detail price chart") on the right. Below: an "Indicators" card,
   4-col ruled table (Indicator / Reading / Interpretation / Signal), Signal cell
   uppercase 10.5px/600 colored BUY `--up` / NEUTRAL `--amber` / SELL `--dn`.
3. **Fundamental** — Headline score card: 84px score + italic summary on the left,
   5-col `SubscoreBand` (Valuation/Profitability/Growth/Health/Dividend) on the
   right. Below: the Pill sub-nav (Overview/Valuation/Profitability/Growth/Health/
   Dividend). *Overview* sub-view = a "Score breakdown" card, 2-col grid of the
   five sections (each: serif name + subscore under a `3px double var(--ink)` rule,
   then 4 `GradedMetricRow`s), plus the Grading dot legend, plus a "Revenue by
   segment" card (thin `--ink`-on-`--fill` bar per segment + % + colored YoY delta —
   full data gap today, render the empty state). Each of the other five sub-views =
   one card: serif title + subscore under the same double rule, then grouped metric
   sections (uppercase kicker group heading over a `1px --line` rule, 2-col
   `GradedMetricRow` grid), occasionally closed with an italic serif footnote
   (13.5px, `--mut`) — e.g. the Profitability ROE-buyback caveat, the Dividend
   payout caveat.
4. **Analysts** — Headline score card: 84px score + rotated `VerdictStamp` +
   "Street consensus" kicker on the left; on the right, a 5-row ratings-distribution
   list (label 10.5px uppercase `--mut` / thin colored bar on a `--fill` track,
   `height:6px radius:3px`, width = count⁄total, colored `--up`/`--amber`/`--dn` by
   rating tier / right-aligned count), then a `1px --line`-topped 3-col price-target
   band (Low `--dn` / Median unstyled + upside `--up` line / High `--up`; Low/High
   render as em-dash placeholders when the API only returns a mean target — data
   gap). Below: a "Recent revisions" card, table of firm (serif) / action text
   (`--sub`) / RAISED `--up` · HELD `--mut` · LOWERED `--dn` tag (10.5px/600,
   0.14em, unbordered text — same tag treatment as the Editorial coverage list, not
   the Outlined type badge) / date (`--mut`); empty state when revisions are absent
   (current API gap).
5. **Intrinsic value** — Headline score card: 84px amber-band score, "Fair value
   estimate" kicker + 34px serif fair-value figure + a colored "Trading X%
   above/below fair value" line (13px/500, banded), then an italic summary — all on
   the left. Right: a 3-col scenario band (Bear `--dn` kicker / Base `--mut` kicker
   / Bull `--up` kicker, each a 26px serif value + a 12px `--mut` caption — geometry
   unchanged since the prior spec, **no top rule** — see Components → "Headline
   score card" → right column note), then "Model assumptions" label/value rows.

   **OD-1 resolved (2026-07-20, `plans/2026-07-19-research-tab-fixes.md`) — honest
   relabel, no new DCF model.** The two rows that used to read "Revenue growth" and
   "FCF margin"/"Terminal growth" described inputs the DCF Lite method never
   computes (it is an EPS-multiple model — `EPS × (1+g)^5 × Terminal P/E ÷ (1+r)^5`
   — with no FCF basis and no terminal-growth rate at all; "Revenue growth" was
   additionally a mislabel of the earnings-growth input it actually reads). The
   **"Model assumptions" row list is now the three real DCF Lite inputs**, each
   pulled from `dcfLite.inputs` and rendered with the existing `AssumptionRow`
   label-left/value-right row pattern (unchanged: `flex items-center
   justify-between border-b border-line2 py-2.5 text-[13.5px] last:border-b-0`,
   label `text-sub`, value `font-medium text-foreground`, em-dash only when the
   underlying input is genuinely absent):
   - **Earnings growth (capped)** — was "Revenue growth"; now correctly labelled
     and reads `inputs.growthRate` (already capped at +15%, uncapped on the
     downside, per the service).
   - **Terminal P/E** — new row, `inputs.terminalPE`.
   - **Discount rate (WACC)** — unchanged row and label, `inputs.discountRate`.
   "FCF margin" and "Terminal growth" are **dropped**, not em-dashed — a permanently
   hardcoded `—` for a row describing a model that doesn't run is the thing being
   fixed, not a state to keep documenting. The row *count* changes (three rows, not
   four) but the row *pattern* does not.

   **OD-2 resolved (2026-07-20) — method-spread Bear/Bull, kicker labels kept,
   captions made honest.** Bear/Base/Bull now surface **already-computed** values
   (min / weighted-average / max of the intrinsic-value service's five valuation
   methods) rather than a flex-assumptions scenario model. Designer call on
   labelling: **keep the BEAR / BASE / BULL kicker words**, do not rename to
   "Low / Weighted / High." Rationale — the band's column geometry, its position
   directly under the fair-value headline, and its `--dn`/`--mut`/`--up` coloring
   already establish it as a range-of-outcomes read; every other numeric band in
   this system (Score figure, Grading dot, Analysts' rating tiers) uses the same
   `--dn`/`--amber-or-mut`/`--up` triad to mean "worse / neutral / better", so
   relabelling only this one band to a neutral statistical vocabulary would make it
   the odd one out rather than the honest one. The dishonesty was never the *label*
   — "bear" and "bull" are standard, well-understood shorthand for a valuation
   range's low and high ends in this domain — it was the **silent `—` implying no
   range existed.** So the fix is in the **caption**, which is what actually claims
   how the number was derived:
   - **Bear** kicker `--dn` (unchanged) → value 26px serif → caption 12px `--mut`,
     now reads **"Lowest of N methods"** (N = count of methods with a valid
     positive value), replacing the old "Single-point estimate" placeholder text.
   - **Base** kicker `--mut` (unchanged) → value → caption **"Weighted estimate"**
     (unchanged wording — this was already accurate).
   - **Bull** kicker `--up` (unchanged) → value → caption **"Highest of N methods"**.
   - **Em-dash rule:** Bear/Bull render `—` (not a fabricated range) when fewer than
     2 methods produced a valid value — same em-dash treatment, same `--mut`
     value color, as the prior single-point-estimate state, now correctly scoped to
     "insufficient methods" rather than "always, because the feature doesn't
     exist." Base is unaffected (already always-populated-or-em-dash on
     `intrinsicValue`).
   No new token, color, or geometry — only the assumptions row list (OD-1) and the
   Bear/Bull caption strings + em-dash condition (OD-2) change.
6. **Positions** *(renamed from "Transactions" per `plans/2026-07-19-positions-tab.md`;
   conditional — omitted from the tab bar entirely when the symbol has no
   transactions on file)* — a **card-wrapped "Position" stat block** (spec below;
   `plans/2026-07-19-research-tab-fixes.md` item 7, supersedes the bare-band
   treatment — see superseded note below) holding Shares held / Average cost /
   Market value / Unrealised P/L (banded `--up`/`--dn` when signed), plus a 5th
   Realized P/L cell (banded, same treatment) whenever `hasRealizedPL(
   position.realizedPL)` is true (re-surfaced per ADR-18/PT-I1 — a settled historical
   number valid regardless of current quantity) — shown only when the symbol is
   **currently held** (`quantity > 0`, live `Position` record present). Below the
   card: a "Your transactions" card with a "+ Add transaction" outlined pill
   (height 32px, per Spacing/shape's secondary-button pattern) and the standard
   table shell (Date / Type / Shares / Price / Fees / Total), Type cell using the
   Outlined type badge.

   **"Position" card — editorial card + header-row treatment, matching the other
   tabs' `HeadlineScoreCard` idiom (`plans/2026-07-19-research-tab-fixes.md` item 7).**
   The owner asked for the in-tab stat block to read like the other research tabs'
   cards and for the standalone "Your position" kicker heading to go away. Rather
   than reuse `HeadlineScoreCard` wholesale (Components → "Headline score card") —
   which is scored-headline shaped, built around an 84px `ScoreFigure` left column
   the Positions stat block has no equivalent of — this wraps the existing stat band
   body in a card carrying **the same chrome, editorial top rule, and header-row
   idiom**, with the title now living in the header row instead of a standalone
   kicker above the band:
   - **Card chrome:** `rounded-lg border border-border bg-card px-7 pb-7 pt-6` with
     `border-top: 3px double var(--foreground)` — identical tokens to `HeadlineScoreCard`
     (Components → "Card" → "Editorial card" variant; `border-border`, `bg-card`,
     `border-double border-foreground`, no new token).
   - **Header row:** `flex items-center justify-between border-b border-line2 pb-4`,
     left kicker **"Position"** at `text-[11px] font-semibold uppercase
     tracking-[0.14em]` — chosen over "Your Position" because every other tab's card
     header is a plain noun-phrase title ("Analyst ratings", "Intrinsic value",
     "News & sentiment"), not a possessive; matching that vocabulary reads as one
     family of cards rather than singling this one out, and it still fully replaces
     the old standalone "Your position" heading's function (the second-person framing
     was never load-bearing — the card body already says "Shares held", "Your
     transactions" etc.). No right meta kicker — unlike Analysts'/Intrinsic's meta
     ("19 analysts · last 90 days", "Discounted cash flow · 10-year model"), the
     Positions card has no equivalent secondary fact to put there (no data source or
     model window to disclose); an empty right side is a valid header-row state,
     not a missing token.
   - **Body:** the existing stat band is unchanged in every internal token — first
     cell no left border/padding, every column after gets `border-l border-line2
     pl-5`; cell kickers `text-[10.5px] uppercase tracking-[0.12em] text-mut`; values
     `mt-1.5 font-serif text-[26px]`, colored `--up`/`--dn` on the two signed cells
     (Unrealised P/L, Realized P/L); the Unrealised P/L percent sub-line
     `mt-0.5 text-[12px]`, signed-colored. Only the band's own top rule changes: the
     band no longer carries its own `border-t border-line pt-5` (the card's header
     row `border-b border-line2` already closes the header above it), so the grid
     sits directly under the header row at the card's standard `pt-7`-equivalent
     body spacing (matching `HeadlineScoreCard`'s `padding-top:28px` body rhythm —
     use the card's existing top padding, no separate rule needed between header and
     band). No new token, color, spacing, or component introduced.

   **Superseded note.** This card+header treatment **supersedes**
   `plans/2026-07-19-positions-band-restyle.md`'s bare, top-ruled editorial band
   (itself superseding `plans/2026-07-19-positions-stat-distinction.md`'s titled
   `bg-fill` panel before it) — kept below for history, not deleted:

   <details>
   <summary>Superseded: bare, top-ruled band (2026-07-19, one revision prior)</summary>

   The bare-band step put a standalone "Your position" kicker (`text-[11px]
   font-semibold uppercase tracking-[0.14em]`, `mb-4`) directly above a
   `grid grid-cols-4|5 border-t border-line pt-5` band — no card wrapper, no
   `bg-fill`/`bg-card`, no `rounded-lg`, no outer border — reasoning it should read
   as the *bare* stat-band idiom the Intrinsic tab's BEAR/BASE/BULL row uses
   (Components → "Bare stat band"). The owner has now asked for the *card* idiom
   instead (this tab's cards, not its bare bands, matching the other tabs' cards) —
   superseded by the treatment above.
   </details>

   The page header above the tab bar (Current price / Day range / 52-week range /
   Market cap — see "Position detail" below and Components → "Ruled stat band"'s
   card-wrapped variant) is unchanged and remains visually distinct from the in-tab
   card: the header grid has no kicker/header row at all, while the in-tab card
   carries the full editorial-card + header-row idiom.

   **Three visual states, same tab, same card treatment:**
   - **Currently held (`quantity > 0`)** — the "Position" card header sits above the
     stat band body, populated with live figures (4 or 5 columns per the
     `hasRealizedPL` rule above); transaction table below it, unaffected.
   - **Closed position (`quantity === 0`, Position record still present, transactions
     exist)** *(Assumption A2)* — the live stat band is **suppressed** (zero shares
     / zero market value would be misleading) and replaced by the muted italic
     caption line, **"Position closed."**, styled per the Type scale's "Italic
     helper/caption" row (11–14.5px, Newsreader italic, `--mut`), followed —
     unchanged wording/gating — by the Realized P/L line (`text-mut` label +
     `--up`/`--dn` value) whenever `hasRealizedPL(position.realizedPL)` is true
     (ADR-18/PT-I1 — do not re-gate on `quantity`). This block sits inside the same
     "Position" card as the held state, directly under the header row — no separate
     top rule, no bare block; both held and closed bodies now live inside the one
     card.
   - **Never held, never transacted** — this state cannot be reached once the tab is
     conditional (the tab itself is omitted), but the underlying "You do not hold
     {symbol}." empty state (quiet card, `--sub` text, + the "+ Add to portfolio"
     pill) is kept in the component as a defensive fallback for the edge case where a
     position is fully sold *and* somehow has no transactions — it should not be
     reachable in normal use once Assumption A1 (has-or-had-transactions gates the
     tab) holds. This "none" state is **unchanged** and **out of scope** for the
     card+header treatment — it keeps its own existing quiet-card treatment
     (`rounded-lg border border-border bg-card`, no top rule, no header row, no
     kicker), which was already a plain card before this change and stays that way.

   **Page-header market grid is unchanged (reference).** The 4-col quote grid
   above the tab bar on both routes (Current price / Day range / 52-week range /
   Market cap — see "Position detail" below) keeps its documented `bg-card`
   treatment with no kicker; it is unaffected by this restyle. This change lives
   entirely in `components/research/transactions-tab.tsx` (the single shared tab
   body — see "Shared component note" below), so it applies identically to both
   `/research/[symbol]` and `/portfolio/[ticker]` in one place; neither route
   page's header grid is touched.

   **Rhythm check (header grid → tab bar → "Position" card → "Your transactions"
   card):** the "Position" card sits in the same `space-y-5` stack as "Your
   transactions" below it (see Shared component note) — that gap is unchanged by
   this restyle; the two cards now read as siblings in the same idiom (editorial
   top rule on "Position", plain card on "Your transactions" — the same
   card-hierarchy pairing the Analysts tab already uses for its `HeadlineScoreCard`
   + "Recent revisions" card).

   **Shared component note:** `components/research/transactions-tab.tsx`
   (`TransactionsTab`) is the single source for this tab's body on **both**
   `/research/[symbol]` and `/portfolio/[ticker]` — no per-route fork. The legacy
   `components/transaction-history.tsx` (a stock-shadcn `Card`/`Table`/`Badge`
   pattern, off-design — no serif values, no Meridian tokens, plain shadcn `Badge`
   instead of the Outlined type badge) is retired once no importer remains.
7. **News & sentiment** — Headline score card: 84px sentiment score + trend kicker
   (banded, e.g. "Warming" in `--up`, on a healthy sample — see "Thin-sample
   honesty" below for the reduced-confidence case) + italic summary on the left;
   3-col tone band on the right (Positive/Neutral/Negative %, each with a colored
   MoM-delta caption line — omitted when history is too thin to compute, data
   gap), **no top rule** — see Components → "Headline score card" → right column
   note. Below: the Editorial coverage list ("Latest coverage").

   **Portfolio-route lead-in (`plans/2026-07-19-research-tab-fixes.md` item 9).** On
   `/portfolio/[ticker]` only, the top `SentimentScore` card that used to sit above
   this tab's `NewsFeed` (a second, duplicate sentiment summary reading the same
   `newsArticles` query `NewsFeed`'s own `HeadlineScoreCard` already scores) has been
   removed — it added a second scored-card above the tab's own `HeadlineScoreCard`
   with no distinct information, breaking the "one editorial headline per tab"
   pattern every other tab follows. Confirmed lead-in on `/portfolio/[ticker]` after
   removal: **"Refresh news" outlined-pill row** (right-aligned, height 32px, same
   token as the "Position" card's transaction-add pill) → `NewsFeed`'s own
   `HeadlineScoreCard` ("News & sentiment" kicker + editorial top rule) → "Latest
   coverage" card — all inside the same `space-y-5` stack, gap unchanged. This now
   reads identically to `/research/[symbol]`'s News tab, which has only ever
   rendered `NewsFeed` alone (no `SentimentScore`, no button row) — the two routes'
   News tabs converge on the same single-headline-card lead-in, differing only by
   the portfolio route's extra "Refresh news" action row above it. No token change;
   `space-y-5` rhythm and the editorial top rule are unaffected by removing the
   `SentimentScore` card — a card being deleted from a `space-y-5` stack does not
   require any spacing adjustment to the cards that remain.

   **Thin-sample honesty (`plans/2026-07-24-news-sentiment-accuracy.md`, Task 12).**
   The pipeline change behind this: the meta kicker and caption move from counting
   *retrieved* articles (`news.length`, i.e. everything that passed the relevance
   filter) to counting *analysed* articles (those with a non-null `sentiment` —
   the set the score is actually computed from), and the score itself is now
   continuously damped toward the 5.0 neutral midpoint below a
   `MIN_CONFIDENT_SAMPLE = 5` analysed-article threshold (Task 11, in
   `lib/utils/research-scores.ts`). This changes what the card must say, in three
   states, using **only existing `HeadlineScoreCard` slots and existing tokens —
   no new chrome, no new color, no badge:**

   - **Healthy sample (analysed count ≥ `MIN_CONFIDENT_SAMPLE`).** Card renders
     exactly as today, with corrected copy (below) and the analysed count feeding
     both slots. This is the overwhelming majority of real symbols per the plan's
     measured 100-item RSS volume — the thin-sample path is the exception state,
     not the default one, and must not add weight to the common case.
   - **Thin sample (`0 < analysed < MIN_CONFIDENT_SAMPLE`).** No new visual
     element — the existing pieces already carry the signal once fed the right
     inputs:
     - **`ScoreFigure`** — unchanged component, unchanged thresholds. Feed it the
       *damped* score (Task 11's output), not the raw sentiment average. Because
       damping pulls the number toward 5.0, a thin sample naturally lands in or
       near the existing `--amber` (4–7) band rather than `--up`'s ≥7 band — the
       figure is *quieter by construction*, through the same band-coloring rule
       every other score in this system already uses (Components → "Score
       figure" thresholds). This is the load-bearing visual cue: a confident 9.6
       in `--up` green versus a damped ~6 in `--amber` is a materially different
       signal, achieved with zero new markup.
     - **Verdict/trend kicker** — still the existing unbadged kicker line slot
       (`verdictKicker` + `verdictKickerBanded`, `HeadlineScoreCard` left column,
       item 2). Two changes, both copy/logic, no new prop or color:
       1. The WARMING/STEADY/COOLING word is derived from the *damped* score, same
          as today's `score >= 7 ? "Warming" : score >= 4 ? "Steady" : "Cooling"` —
          no separate thin-sample vocabulary is introduced. A damped thin-sample
          score sitting in the 4–7 band already reads "Steady," which is honest:
          "warming" is a conviction word this system should not print over 2
          articles regardless of their raw average.
       2. **`verdictKickerBanded` is forced `false` on a thin sample, regardless of
          what the damped score's band would otherwise imply.** Today
          `verdictKickerBanded = score >= 7` colors the kicker `--up`/weight 600 to
          match a strong figure; on a thin sample this must stay the default
          `--mut`/weight 400 treatment even in the rare case a damped score still
          clears 7 (a small sample of unanimously extreme articles can still land
          high after damping). The kicker word and the score figure's own band
          color already carry the verdict; the kicker's *bold color* is reserved
          for "this is a well-founded reading," which a thin sample is not, by
          definition — this is a one-line conditional in existing code, not a new
          visual state.
     - **Summary paragraph** — same italic-serif summary slot every tab already
       populates; carries the thin-sample caption (see Caption copy below). No
       change to the slot's type treatment (14.5px italic `--mut`).
     - **Meta kicker** — same slot, analysed-count copy (see Meta kicker below).
   - **Zero analysed (`analysed === 0`)** — unchanged from the existing
     zero-coverage state (`ScoreFigure`'s null/unavailable → `--mut` band, already
     implemented and already correct per this plan's brief); this state does not
     change under this task. Note the trigger condition is now "zero *analysed*"
     rather than "zero retrieved" — a symbol can have retrieved articles that are
     all still `null` (pending) and must render this same no-verdict state, not a
     false score of 5.

   **Caption copy (summary paragraph slot), three states:**
   - **Zero analysed** — unchanged wording, already accurate: *"No recent news
     coverage found for {symbol}."*
   - **Thin sample** — *"Sentiment reflects only {n} analysed article{s} — too few
     for a confident reading. Score shown is weighted toward neutral."* Two fixes
     baked into this wording versus the old copy: it names the *analysed* count
     (not retrieved), and it drops the false "weighted by relevance and market
     impact" claim as the *reason to trust* the number — that weighting still runs
     internally (unchanged aggregate math), but on a thin sample it is not the
     operative fact; the sample size is. Do not additionally claim a specific
     damping mechanism ("shrunk toward 5.0") in user-facing copy — "weighted
     toward neutral" says the same thing in the plain, declarative register Tone
     of voice requires (Tone of voice → "Precision over enthusiasm"), without
     exposing an implementation constant.
   - **Healthy sample** — *"Sentiment reflects {n} analysed articles, weighted by
     relevance and market impact."* Same structure as today's copy, corrected to
     read the analysed count instead of `news.length`. The "weighted by relevance
     and market impact" clause is kept here — unlike the thin-sample state, a
     healthy sample's score genuinely is a relevance/impact-weighted aggregate
     (`news-feed.tsx`'s existing weighting math), so the claim is accurate once
     the count feeding it is accurate.

   **Meta kicker (`metaKicker` slot), analysed-count copy:**
   - Current: `"{news.length} articles analysed · last 30 days"` — reads off the
     retrieved/filtered count, not the analysed one, and is therefore currently
     capable of claiming more articles than the score is built from.
   - **New:** `"{analysedCount} articles analysed · last 30 days"` where
     `analysedCount` is the same count driving the score (non-null-sentiment
     articles). The "· last 30 days" clause is unchanged copy — Task 3
     reconciles the three retrieval windows to a real, enforced 30 days, so this
     half of the kicker (previously aspirational per the plan's R5 finding)
     becomes accurate as a side effect, with no copy change needed.
   - **When retrieved count exceeds analysed count** (i.e. some articles are
     still pending/unanalysed — expected under the new batch-cap flow, Task 7),
     the meta kicker states the analysed count only; it does not additionally
     surface the retrieved total in this slot. Reason: the meta kicker's job is
     to say what the *score* is built from, one number, not to reconcile two
     counts — a reader who wants the fuller picture already sees every retrieved
     article (analysed or PENDING) in the "Latest coverage" list below, where the
     PENDING tag (see Editorial coverage list) already discloses which rows are
     not yet counted. Do not add a second parenthetical count to the kicker
     (e.g. "12 of 18 articles analysed") — that overloads one muted 10.5px line
     with two numbers and duplicates information the coverage list already
     carries more legibly, one row at a time.

   **What is explicitly not changed:** the 3-col tone band (Positive/Neutral/
   Negative %) on the right, the "no top rule" treatment, the Editorial coverage
   list below it, and the `HeadlineScoreCard` shell itself (padding, border,
   header row, grid). This task is a data-source and copy correction inside slots
   that already exist — see Components → "Headline score card" and Components →
   "Score figure" for the unchanged mechanics being reused, and the `## Design
   tokens` note above the Components section: a spec that needed a token or
   color not already named here would be a spec error, and none is needed for
   this task.

**Explicitly out of scope for this pass:** `app/page.tsx` (marketing landing page,
not behind auth) — unchanged, stock-shadcn look retained.

**Position detail (`/portfolio/[ticker]`) — shares research-detail chrome (TD-32),
now header-for-header identical to Research detail (per
`plans/2026-07-19-positions-tab.md`, OD-1 resolved as Option B: keep both routes,
align their behaviour).** This route is reachable from the dashboard/closed-positions
tables and is not one of the 7 designed screens above (it has no dedicated
mock-up), but it now renders the **same general market header** `/research/[symbol]`
uses, with position detail relocated into the conditional Positions tab described
above:

- **Header** — the Research detail company header (serif 52px company name over a
  `TICKER · EXCHANGE` `--mut` kicker; see "Research detail — tab-by-tab" above), with
  pill action buttons in the row where Research detail shows Watchlist/Add-to-portfolio:
  **Buy more** (secondary — transparent background, `--ink` text, 1px `--line` border)
  / **Sell** (secondary, same style) / **Delete** (primary — `--btnbg` background,
  `--btnfg` text, no border), per Spacing/shape → Buttons. Buy more / Sell are hidden
  when `quantity === 0` (nothing to buy more of or sell); Delete always shows. This
  matches the current `portfolio/[ticker]` header action row already on disk — no
  change to the action row itself, only to what sits below it.
- **Quote card — now the general market grid, not the position grid (this is the
  behavior change this plan makes).** Replace the page's former 4/5-col
  position-metrics grid (Market value / Unrealized P/L / Realized P/L / Today's
  change / Avg cost — the pre-existing pattern this section used to describe) with
  the **exact same Research detail 4-col ruled quote grid** `/research/[symbol]`
  renders (Current price / Day range / 52-week range / Market cap — see "Research
  detail — tab-by-tab" above and Components → "Ruled stat band"'s card-wrapped
  variant): `--card` background, 1px `--line` border, radius 8px, `border-r
  border-line2` verticals between the 4 cells, kicker (10.5px uppercase `--mut`) over
  serif value (28px) over a 12.5px detail/change line, signed change colored
  `--up`/`--dn` with the ▲/▼ glyph prefix exactly as `research/[symbol]/page.tsx`
  already renders it. This is **spec parity with an existing pattern, not a new
  one** — same grid, same tokens, fed by the `quote` this page already fetches (no
  new query). The position-specific figures (Market value / Unrealized P/L /
  Realized P/L / Today's change / Avg cost) move into the Positions tab's stat band
  (see item 6 above) — they no longer appear in the header at all.
- **Tab bar** — the Research detail **Segmented tabs** research-detail variant (see
  Components → "Segmented tabs"): `flex gap-8 border-b`, uppercase 11px kicker tabs,
  active = weight 600 + 2px `--ink` underline. Tab bodies keep rendering the existing
  shared Meridian tab components (Overview, Technical, etc.) — only the tab chrome
  changes. The **Positions** tab (see item 6 above) is conditional here exactly as on
  `/research/[symbol]`: present when the ticker has any transaction on file, omitted
  otherwise. In practice this route is only ever reached for a ticker that has (or
  had) a position, so the tab is expected to be present essentially always here —
  the guard is applied anyway for correctness and to keep both routes' logic
  identical (see Assumption A1 in the governing plan).

No new tokens or components are defined for this page — the header is now a direct
reuse of an existing pattern, not a variant. Any lower section of
`/portfolio/[ticker]` not covered by this header/quote-card/tab-bar scope remains
tracked under TD-32 until reskinned in a later pass.

### Settings — scoring weights

Governing plans: `plans/2026-07-20-configurable-scoring-weights.md` (original
surface), `plans/2026-07-21-scoring-weights-direct-percent.md` (revises the
input model and the live readout per owner decision; supersedes OD-4 of the
prior plan), `plans/2026-07-21-scoring-picker-collapsible-ux.md` (collapsed the
Style preset picker closed-by-default, ADR-25 — now superseded), and
`plans/2026-07-21-scoring-picker-chips.md` (**current** — replaces the
collapsed disclosure with an inline name-chip row + accessible hover/focus
tooltip, ADR-26; layout-only, does not touch the input model). Route
`app/(dashboard)/settings/page.tsx`, reached only via the account-menu
dropdown (no top-nav entry — this is an account-level control surface, not a
research/portfolio destination). Everything below reuses existing
tokens/components named elsewhere in this file; no new color, spacing, or
type-scale value is introduced. Two new named components exist: **Weight
stepper** (see Components above, revised meaning per the direct-percent plan)
and **Style preset picker** (see Components above, now an inline name-chip row
with an accessible tooltip per the scoring-picker-chips plan); everything else
is an existing pattern applied to new content.

**What changed in this revision, at a glance:** the five inputs per section are
now direct whole percentages (0–100) that must sum to exactly 100, not arbitrary
relative numbers auto-normalized after the fact. The live "normalized %" ruled
band (item 2 below, prior revision) is removed — the owner's explicit objection
was the type-and-watch-normalized-% loop — and replaced by a single live
group-total/validity status line. Save is gated on that same sum-to-100 check
(plus the existing dirty check). The two-card layout, header row/meta kicker,
field order, Reset behaviour, toasts, and the "Your weighting" meta-kicker
elsewhere are unchanged. **Latest change (scoring-picker-chips plan, ADR-26):**
the Style preset picker (item 3 below) is now a compact, always-visible,
wrapping row of name-only chips — no disclosure, no collapse — with each
chip's description moved into an accessible hover/focus tooltip. The card's
visible height on first load is "status line + a short inline chip row +
fields," which is shorter than the pre-ADR-25 always-visible row list and
needs no extra click to reach a preset, unlike ADR-25's collapsed trigger: the
five Weight stepper fields (item 4) sit immediately below the status line and
the chip row on first paint.

**Page chrome.** Standard authed-screen container: max-width 1400px, padding
`56px 32px 96px` (Spacing/shape → Page container). H1 block:
- **Kicker eyebrow** (Tone of voice: "every screen's H1 gets one"): **"House rules
  · how your scores are weighed"** — sans, 10.5–11px uppercase, 0.12–0.14em,
  `--mut`, matching every other screen's eyebrow (e.g. "Under observation ·
  before you invest").
- **H1**: **"Scoring weights"** — Newsreader, Screen H1 scale (52px/500, line-height
  1.05, `--ink`).
- **Italic subline** (optional pattern, used here): Research index H1 subline
  treatment (16px italic Newsreader, `--mut`) — **"Set how much each dimension
  counts toward your Composite and Fundamental scores. Unweighted dimensions fall
  back to the house default."** Quiet, secondary, matching the "italic for asides,
  not instructions" rule — the page still works without reading it.

No page-level pill action sits beside the H1 (unlike Dashboard's "+ Add position"
or Closed-positions' "Export CSV") — Save lives inside each section instead (see
below), so there is nothing to put in the header's right slot.

**Two sections, in fixed order: Composite score, then Fundamental score.** Each
section is an **Editorial card** (Components → "Card" → Editorial card variant:
`--card` background, 1px `--line` border, radius 8px, `border-top: 3px double
var(--ink)`, padding `24px 28px 28px`) — the same top-rule treatment as the
Headline score card and Morning Note, chosen because this page's settings are
exactly as consequential as the scores they drive; a plain (non-editorial) Card
would under-signal that. Each card's internal structure, top to bottom:

1. **Header row** (`padding-bottom:16px`, `1px --line2` bottom border, matching
   Headline score card's header-row idiom exactly): left = section kicker (11px/600
   uppercase 0.14em `--ink`) — **"Composite score"** / **"Fundamental score"**;
   right = a muted meta kicker (10.5px uppercase 0.1em `--mut`) stating what the
   section governs — **"5 categories · drives every research Overview"** /
   **"5 subcategories · drives the Fundamental tab"**.
2. **Live group-total / validity status line** (`plans/2026-07-21-scoring-weights-direct-percent.md`,
   supersedes the "Live normalized-% band" below). Where the ruled band used to
   sit — directly beneath the header row, above the five Weight stepper rows —
   this section now shows a **single status line**, not a 5-column band: a
   left-aligned running total plus its requirement, e.g. **"Total: 94% · must
   equal 100%"**, recomputed on every keystroke in any of the section's five
   Weight stepper fields, client-side, no request (`sumsTo100`, epsilon `0.01`).
   - **Typography** — this is a status line, not a hero figure: Kicker/label
     scale (Type scale → "Kicker / label" — sans, 10.5–11px, uppercase,
     0.12–0.14em), the same scale the removed band's own bottom caption used —
     **not** the 28px Newsreader serif the removed band gave the per-dimension
     percentages. A running total is a validity check the user scans, not the
     number the page exists to show (that role now belongs to the typed
     percentages themselves, in their own fields) — giving it the hero serif
     treatment would misstate its importance and re-create exactly the "watch
     the big number" loop the owner asked to remove.
   - **Placement — confirmed unchanged by the scoring-picker-chips plan (no
     move).** `margin-top:8px` below the header row's bottom border,
     `margin-bottom:20px` above the picker's kicker label + chip row (item 3)
     — the status line was already the thing directly above the picker under
     every prior revision, and swapping the collapsed trigger for an
     always-visible chip row only changes what the picker itself looks like,
     not what the status line sits beneath. The status line stays the "first
     thing you see under the header" scan position every reader of this page
     already learned, immediately followed by the (now always fully visible)
     picker. No-op, re-confirmed.
   - **Two states, same line, text color only (no new token):**
     - **Valid** (group sums to 100 within epsilon) — settles to `--mut`. Decided
       over `--ink`: `--mut` matches every other quiet status/caption line in this
       system, e.g. the removed band's own "Sums to 100%..." caption, so "valid"
       reads as "back to normal, nothing to look at," not as a new emphasis
       state — `--ink` would make a passing check look like an achievement worth
       the primary-text weight, which overstates it. Copy: **"Total: 100% ·
       valid"**.
     - **Invalid** (sum ≠ 100, or any field outside its 0–100 whole-percent
       range) — text shifts to `--dn`. Decided over `--amber`: `--dn` is this
       system's existing "something needs your attention before you can proceed"
       tone (it is already what disabled-until-valid states borrow via
       `text-destructive`/error toasts elsewhere in the app — see the Save
       button's own error-toast treatment two paragraphs below), and it is the
       lighter-touch default the governing plan calls out. `--amber` (reserved
       elsewhere for "middling, 4–7 band" *scores* — a mid-quality signal, not a
       form-validity signal) stays reserved for that scoring-band meaning only;
       reusing it here would blur "your score is middling" with "your
       percentages don't add up yet," two unrelated meanings. Copy: **"Total:
       94% · must equal 100%"** (states both the live number and the
       requirement in one line, so the user does not have to hold "100" in
       their head separately).
   - No `--up` banding in either state — this is never a "good" number the way a
     gain is; it is binary valid/invalid, so only the neutral/`--dn` pair is
     used, consistent with the "only `--up`/`--dn`/`--amber` are chromatic, and
     only for their named meanings" rule.
3. **Style preset picker** (Components → "Style preset picker (Settings —
   scoring weights)", `plans/2026-07-21-scoring-style-presets.md`, visible-
   description shape per `plans/2026-07-21-scoring-style-descriptions-retune.md`
   (ADR-24, superseded), collapsed-by-default disclosure per
   `plans/2026-07-21-scoring-picker-collapsible-ux.md` (ADR-25, superseded),
   **inline name-chip row + accessible hover/focus tooltip per
   `plans/2026-07-21-scoring-picker-chips.md` (ADR-26) — current**) — sits
   directly below this status line and directly above the five Weight
   stepper rows, unchanged in position. **Always visible, no disclosure**:
   a kicker label **"Start from a style"** sits above a compact, wrapping row
   of name-only chips, one per preset that defines this section's group
   (`presetsForGroup(group)`): nine chips on Composite (Value · Deep Value /
   Contrarian · Quality (GARP) · Growth · Momentum · Sentiment / News-driven
   · Analyst Consensus · Dividend / Income · Balanced), six on Fundamental
   (the same list minus Momentum, Sentiment / News-driven, and Analyst
   Consensus, which define no fundamental tilt). Each chip shows only the
   preset's **label** — its `blurb` is not rendered as text anywhere in the
   row; it appears in an accessible tooltip on hover or keyboard focus (see
   the Components entry's Tooltip spec for the full chrome/a11y contract:
   `--popover` surface, `aria-describedby`, Escape-dismiss, `delayDuration:
   200` on hover, immediate on focus, no `title` attribute, touch does not
   open it). Clicking a chip calls `setInputs(toInputs(preset[group]))` for
   this section only: **populate-only, client-side, no request** — identical
   mechanism to "Reset to house defaults" below, just seeded from the
   clicked preset instead of the house default. Because every preset sums to
   100 by construction, the status line above immediately reads its valid
   state and Save enables via the ordinary dirty gate — applying a preset
   never bypasses the sum-to-100/dirty Save gate this section already
   enforces. No chip is ever shown as "currently active" — each is a
   momentary action, not a toggle; see the Components entry for the full
   chip chrome, states, and a11y spec.
4. **Five Weight stepper rows** (Components → "Weight stepper", revised meaning:
   the number typed IS the percent, 0–100 whole), one per dimension, in a
   `grid grid-cols-2 gap-6` (matching the Add-position form's field grid; single
   column below its existing responsive breakpoint):
   - **Composite section fields, in this order:** Technical % · Fundamental % ·
     Analysts % · Intrinsic value % · News & sentiment % (matching the Overview
     tab's `SubscoreBand` column order exactly, so the settings page and the
     score card it drives read as the same list in the same order; each label
     carries the "%" suffix described in the Weight stepper component entry).
   - **Fundamental section fields, in this order:** Valuation % · Profitability %
     · Growth % · Financial health % · Dividend % (matching the Fundamental
     tab's `SubscoreBand` column order).
   - The group-total/validity status line above updates from these fields on
     every change — no separate "recalculate" step.
5. **Actions row** (`margin-top:24px`, flex, `gap:12px`, right-aligned — matching
   the Add-position form's action-row alignment pattern, adapted from
   full-width/50-50 to auto-width/right-aligned since this is an in-page section
   action, not a full-form submit). **Placement confirmed unchanged by the
   scoring-picker-chips plan (no move).** It stays directly below the five
   Weight stepper rows, same as before: the picker being an inline chip row
   rather than a disclosure only changes vertical distance between the
   status line and the fields (item 3 above), it does not change anything
   below the fields — Reset and Save still read as "the two things you do
   once you're done with the fields above them," which is unaffected by how
   the picker renders:
   - **Reset to defaults** — secondary pill (Spacing/shape → Buttons secondary:
     transparent background, `--ink` text, 1px `--line` border, 38px height,
     radius = half height). Copy: **"Reset to house defaults"** (measured
     register, not "Reset!"; the copy drops any mention of "normalization,"
     since nothing is normalized anymore — the reset sets the actual percent
     values directly). **Per-section reset, not one global reset** — the two
     groups independently drive different scores, so resetting one should not
     silently touch the other the user may have already tuned; this also
     matches the section-scoped Header/status-line/fields grouping above
     (everything else in this spec is already per-section). Clicking it sets
     that section's five fields to a **100-sum whole-percent split** —
     Composite: **25 / 25 / 20 / 15 / 15**; Fundamental: **30 / 30 / 20 / 15 /
     5** (`fractionsToPercents(DEFAULT_SCORING_WEIGHTS...)`, already clean whole
     numbers summing to 100 — no rounding-drift repair visibly needed for the
     defaults) — client-side only, does not itself save; the user still
     presses Save to persist, consistent with explicit-save below. Immediately
     after Reset the group-total status line reads its valid state (Total:
     100%) and Save enables if the reset values differ from the last-saved
     ones (dirty-state gate, unchanged).
   - **Save weights** — primary pill (Spacing/shape → Buttons primary: `--btnbg`
     background, `--btnfg` text, no border, 40px height). **Disabled (existing
     `disabled:opacity-50` idiom, per the Add-position submit button) until BOTH
     (a) the section sums to 100 within epsilon — the same `sumsTo100` check the
     status line already displays — AND (b) the section's fields differ from
     the last-saved values (dirty-state gate, unchanged from the prior
     revision).** The group-total status line above is the **primary** signal
     for why Save is disabled when the sum is off; the disabled pill itself is
     **secondary** confirmation, not a separate explanation — no additional
     inline helper line is added next to Save restating "must sum to 100," since
     that would duplicate the status line sitting a few inches above it in the
     same card and risk drifting out of sync with it. If the two ever need to
     be read together without scrolling (e.g. a very tall stacked-field layout
     on narrow viewports), that is a candidate for a future revision, not
     something this spec adds preemptively.
     **Explicit save, not auto-save** — unchanged: auto-save would fire a `PUT`
     on every keystroke across ten free-text fields, which is both wasteful and
     removes the user's ability to compose a full set of percentages before
     committing. Explicit save also matches every other mutating form in this
     app (Add position, Buy more, Sell, wishlist add/remove) — none auto-saves
     on keystroke.
   - On success: existing `useToast`/`Toaster` pattern (Components — reuse the
     exact `toast({ title, description })` call shape from `buy-more-modal.tsx`),
     title **"Weights saved"**, description **"Your Composite scores now use
     this weighting."** / **"Your Fundamental scores now use this weighting."**
     matching the section. On error: same toast, `variant: "destructive"`, title
     **"Save failed"**, description = the error message (matching the existing
     error-toast shape used throughout the app).
   - Each section saves and resets independently — saving Composite does not
     require the Fundamental section to also be valid/dirty, and vice versa (two
     independent `PUT` payload groups, per the plan's API shape).

**Superseded note.** Item 2's live group-total/validity status line above
**supersedes** the prior revision's live normalized-% ruled band — kept below for
history, not deleted:

<details>
<summary>Superseded: live normalized-% band (2026-07-20, prior revision)</summary>

The prior revision's item 2 was a `SubscoreBand`-style ruled band (5 equal
columns, `1px --line2` verticals between, first/last column flush padding) that
recomputed on every keystroke via `normalizeWeights`, client-side. Cell content
per column, top to bottom: kicker label (10.5px uppercase `--mut`) = the
dimension name; **the normalized percentage in Newsreader serif, 28px/400** (the
Subscore band's own value size — "the serif for the value that matters" rule),
formatted `"31%"` (integer, no decimal); no `--up`/`--dn`/`--amber` banding on
this figure — a normalized share was reasoned to be neither good nor bad, so it
stayed `--ink`. No 12px detail line under the percentage. A bottom caption line
below the band stated the group sums to 100 — sans 10.5px uppercase `--mut`,
`margin-top:8px`: **"Sums to 100% after normalization."**

The owner explicitly disliked this model in practice: the user filled in
arbitrary relative numbers and had to watch this band to see the resulting
normalized percentages — an indirect type-and-watch loop. Superseded by the
direct-percent input model above, where the typed number already IS the percent
and the only remaining feedback needed is a validity check (sums to 100 or not),
not a second computed number to watch.
</details>

**Custom-weighting affordance.** Handled entirely by the Headline score card's
meta kicker (see Components → "Headline score card" → "Custom-weighting meta
kicker" above) — no additional chrome is added on the Settings page itself beyond
what's already specified in the sections above, **unchanged by this revision**.
This was judged sufficient rather than adding a second signal here: the Settings
page is where the user is already looking at their own percentages directly (each
field IS the percent now, and the group-total status line already confirms the
section is valid), so a redundant "these differ from default" indicator on this
page would be noise: the affordance's value is entirely in *other* screens (the
score cards) reminding the user their number is personalized, not in reminding
them here where they just set it.

**Loading state.** `app/(dashboard)/settings/loading.tsx` — see Components →
"Loading skeleton" → per-route composition table for the exact, **current**
primitive composition (the inline chip-row skeleton, revised per
`plans/2026-07-21-scoring-picker-chips.md`, ADR-26). Chain of revisions, most
recent first:
- **Current (`plans/2026-07-21-scoring-picker-chips.md`, ADR-26):** the
  preset-picker region of each section's skeleton is a **kicker block + a
  wrapping row of several small chip-shaped skeleton blocks** — one
  `kicker`-variant block (the "Start from a style" label) followed by a
  `flex flex-wrap gap-2` row of `h-8 rounded-full` `SkeletonBlock`s at a
  handful of varied narrow widths — **no chevron, no disclosure, no bordered
  list** — matching the real picker's **always-visible inline** first paint.
  This replaces the prior revision's single compact trigger-row/chevron
  skeleton below, which would otherwise mismatch the real page: the picker
  is no longer a collapsed disclosure, so a skeleton still shaped like one
  is exactly the kind of out-of-sync shape the "Rule for the Coding agent"
  (Components → Loading skeleton) warns against. The rest of the
  composition — header block, one-line group-total status block, five
  paired label+input row blocks, trailing pill-variant (Reset) block — is
  unchanged by this revision.
- **Superseded (`plans/2026-07-21-scoring-picker-collapsible-ux.md`, ADR-25):**
  the preset-picker region of each section's skeleton was a single compact
  trigger-row block (one `kicker`-variant block + a small trailing chevron-
  footprint block, no bordered list beneath it) — matching the disclosure's
  then-current closed-by-default first paint. This had replaced the prior
  revision's 3-representative-row expanded-list skeleton below, which would
  otherwise have flashed a tall expanded-looking skeleton against a short
  collapsed real card on hydration.
- **Superseded (`plans/2026-07-21-scoring-style-descriptions-retune.md`):**
  the per-section skeleton added one short `kicker`-variant block
  (approximating the preset picker's "Start from a style" label) followed by
  a small bordered stack of 3 representative `SkeletonBlock` label-line/
  description-line row pairs (`divide-y divide-line2` inside a `rounded-md
  border border-line` wrapper), mirroring the then-always-visible option-row
  list's chrome.
- **Superseded (`plans/2026-07-21-scoring-style-presets.md`):** the earliest
  revision added the same label block followed by a short row of small
  `pill`-variant blocks (3–4 of varied width), approximating the original
  compact-pill-row preset picker before it grew visible descriptions.
- **Original (`plans/2026-07-21-scoring-weights-direct-percent.md`):** dropped
  the `SkeletonStatBand columns={5}` block that stood in for the removed
  normalized-% band, replacing it with the single short `kicker`-variant
  block (the group-total status line) that all revisions above keep.

Coding agent updates `loading.tsx` in the same change per the "Rule for the
Coding agent" (Components → Loading skeleton) — a skeleton out of sync with
its real page is a design regression.

**Data flow (reference only — Coding agent's concern, included here so the visual
spec is legible against real state):** `GET /api/settings/scoring-weights` seeds
both sections' fields with **whole percents summing to 100**
(`getWeightsForSettings`, per the governing plan — defaults-filled and
normalized-then-converted for legacy rows, so a user with no saved row, or a
legacy raw-weight row, sees a valid 100-sum split already populated, not blank
fields and not an off-100 total); `PUT` validates sum≈100 and persists one or
both groups (0–100 range, all five keys required); on success the
`["scoring-weights"]` query is invalidated so any open research tab's Headline
score card picks up the new weighting (and its meta kicker) without a manual
refresh.

**Edge cases carried over unchanged:** empty/loading/error states on the dashboard
chart, sorting on every Watchlist column, add/remove mutations, CSV export, currency
reconversion, form validation errors on Add position and Login. None of these behaviors
change — only their visual presentation does.

**Route-level loading state (Task 7, `plans/2026-07-18-performance-audit-remediation.md`):**
Dashboard, Closed positions, Watchlist, Research detail, and Position detail
(`/portfolio/[ticker]`) each get a `loading.tsx` streaming boundary shown on
navigation before the first fetch resolves — see Components → "Loading skeleton
(route-level `loading.tsx`)" for the shared primitive and exact per-route
composition. Research index does not currently fetch on mount beyond the static
popular-stocks list, but still gets one per the plan's blanket Task 7 scope. This is
a rendering-boundary addition only — no client data-fetching behavior changes.

**Research-detail-specific edge cases (new with the 7-tab structure):** the
Positions tab's three states — currently held (live stat band), closed/quantity-0
(muted "Position closed." caption, table unaffected), and the defensive
never-held/never-transacted empty state (see item 6 above, `plans/2026-07-19-positions-tab.md`);
every data gap in the plan's data-gap map renders a quiet editorial placeholder
(em-dash cell or a muted italic caption) rather than fabricated numbers or a broken
layout — never hide the surrounding card/row, only the missing value. Placeholder
wording is a
Coding-agent detail within the tone-of-voice rules above, not a fixed string this
file mandates.
