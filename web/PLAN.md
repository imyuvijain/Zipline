# /web polish plan

Sources: 8 Instagram reels (UI backgrounds, unslop list, UX laws, password-field techniques, verify-code redesign, animation terms, warm/cool accent, Claude design-skill ranking), reviewed by three agents (visual, motion, UX laws) against `web/src`.

Constraints: highly minimalist, no added wording, dark only, `shared/types.ts` unchanged, done before the **14:20 feature freeze**. Everything is web-only CSS/TSX.

## Phase 1: demo moments (do first, ~40 min)

| # | Change | Principle | Files | Effort |
|---|---|---|---|---|
| 1.1 | **Collision on the cards.** Members sharing an `area` (both not offline) get `.clash`: warn border + `--warn-soft` surface, shared area chip turns solid warn. Other cards dim to 0.6 via `.stack:has(.clash)`. No glow, no banner, no copy. | Von Restorff, figure-ground, banner blindness | Board.tsx, styles.css | S |
| 1.2 | **Click a card to ask.** Card becomes a button; App lifts `pending` state; ChatPanel calls `runtime.thread.append(...)` with "What's X doing?" (auto-send). | Parkinson, Fitts | App.tsx, Board.tsx, ChatPanel.tsx | S |
| 1.3 | **Card ↔ answer link.** Adapter reports `{users, phase}` up to App. Asked card shows a spinner ring on its avatar while asking, then an accent border for 3s. Team/dept asks focus all shown cards. | Connectedness | App.tsx, Board.tsx, ChatPanel.tsx | M |
| 1.4 | **Answer lands.** Body rises in (`opacity 0, translateY 6px`, 280ms); source chips stagger 60ms; total < 400ms. Claude mark pulses while running. | Peak-end, Doherty, follow-through | ChatPanel.tsx, styles.css | S |
| 1.5 | **Card change flash.** Previous-value ref per card; when `area`/`state` changes, re-key the chip for a 500ms accent flash and give the dot a one-shot ring. Skip the first render. | Von Restorff, secondary action | Board.tsx, styles.css | M |
| 1.6 | **Feed fix + alert entrance.** Key rows by `at+text` (the index key currently remounts every row). New rows rise in (250ms); `alert` rows add a 1.2s warn wash. | Origin, Von Restorff | Board.tsx, styles.css | S |
| 1.7 | `prefers-reduced-motion` block (spinner keeps running). | Accessibility | styles.css | S |

## Phase 2: unslop the visuals (~25 min)

| # | Change | Principle | Effort |
|---|---|---|---|
| 2.1 | **Flat dock.** Drop the glass effect: solid `--surface-2`, 1px `--line` border, no blur/shadow, radius 18 / icons 12. Keep the magnification. | No glassmorphism, no glows | S |
| 2.2 | **Flat single-hue icons.** `hsl(hue 28% 24%)` background, `hsl(hue 55% 78%)` letter, no gradient. Letters only (M, E, P, I), no `$`/`⚙`. Order Murmur, Engineering, divider, sims (dimmed 0.75). | No gradients, consistent icons, choice overload | S |
| 2.3 | **Warm page, cool accent.** Neutral-warm surfaces (`--bg #121110`, `--surface #1a1917`, `--line #2e2c28`, `--ink #ece8e1`, `--muted #a8a39a`); teal stays the only accent; Claude orange stays in the panel. | Warm/cool accent | S |
| 2.4 | **Swap Inter** for Geist (body) and keep JetBrains Mono for names/times. | Swap out Inter | S |
| 2.5 | **Two-tone tags.** Grey by default; only `claim` (accent) and `alert`/`fail` (warn). Remove violet/blue. | Fewer hues, contrast | S |
| 2.6 | **Remove glyphs/emoji.** Drop `📄`; replace `✳` with one small inline SVG mark; no `◉`. | No emojis | S |
| 2.7 | **Cards by state, not borders.** Borderless cards; offline keeps full-contrast name with a dimmed chip, a hollow dot and the age as `12m`. No active-dot glow. | Break up identical cards | S |
| 2.8 | Remove all-caps group titles; match inner/outer radii; small mono text ≥ 13px for the projector. | All-caps, radius, contrast | S |

## Phase 3: if there's time

- Context-aware suggestions: if a clash exists, the first one is "Who else is on <area>?" (max 3).
- Fade the bottom of `.main-scroll` with a mask so overflow is hinted (closure).
- SVG favicon + `<meta name="description">`.
- Optional 3–4% grain on `body::before` (it may wash out on a projector).

## Rejected

Textured/photo/ASCII backgrounds (noise on a projector), toasts or banners for collisions, dock badges, sound/confetti, animating the "Ns ago" tick (frequency of use), a password/OTP-style checkmark morph (no such input here), animation libraries, always-visible dock labels (the h1 already names the team), any added copy.

## Skills

- Anthropic's **frontend-design** skill (ranked S tier in the comparison reel) is already installed; it guides Phase 2.
- Taste, Hallmark, UI UX Pro Max, "unslop" and "accent" skills are only distributed by commenting for a DM or through a bio link. None has a public install source, so none was installed.
