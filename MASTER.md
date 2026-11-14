# Boothfinder — MASTER.md

> **Every AI agent (Claude Code, Codex, anything else) reads this file in full before touching the repo.**
> It is the single source of truth for what we're building, how we split work, and how we avoid breaking each other's code.
> If this file and your instincts disagree, this file wins. If this file and the hackathon Discord disagree, Discord wins.

---

## 0. TL;DR for agents

1. You're helping one of 4 teammates build **Boothfinder**, a hackathon demo, in ~43 hours (Fri Nov 13, 5:00 PM → Sun Nov 15, 12:00 PM).
2. Work happens **one Kanban card at a time** on a **feature branch** → PR → merge to `main`.
3. **Stay inside your card's files.** Shared files (types, DB schema, layout, this doc) have special rules — see §6.
4. **Never rewrite history.** No force-push, no deleting branches/commits, no squash merges. Project history is our proof of eligibility.
5. **No secrets in the repo.** Keys go in `.env.local` and Vercel env vars only.
6. Optimize for **a smooth 4-minute live demo**, not production quality. If it's not in the demo, it's probably not worth building.

---

## 1. The product

**Boothfinder** helps small food and drink brands find events that are seeking vendors, and shows which ones are worth the booth fee. Launch market: fairs, races, and markets in **San Luis Obispo and Santa Barbara counties**.

### The problem
- **Scattered listings:** vendor calls live on Eventeny, ZAPP, Google Forms, PDFs, and random event websites.
- **Booth fees are a gamble:** $100 to $2,000+ with no data on real traffic or competition.
- **Missed deadlines:** fair applications open in winter for summer events.

### The pitch line
> Competitors list events. Boothfinder tells you which ones pay.

### Target user for the demo
A small **juice / drink brand** on the Central Coast deciding which of ~30 events to apply to.

---

## 2. What we're building this weekend (scope)

A **working demo**, not a launch.

| # | Feature | Priority | What "done" means |
|---|---|---|---|
| 1 | **Event list** | P0 | 20–30 real Central Coast events in the DB, browsable and filterable in the UI |
| 2 | **AI extractor** | P0 | Paste a URL or upload a PDF → AI pulls structured event fields → saves to DB. Must work live on at least one real fair PDF |
| 3 | **Fit score calculator** | P0 | Brand enters price, margin, costs → every event gets a 0–100 Fit score → list re-ranks instantly |
| 4 | **Public-signal scores** | P1 | Returning vendor rate, vendor density, fee per attendee shown per event (where data exists) |
| 5 | **Rating screen (give-to-get)** | P2 | Vendor rates one event → unlocks all ratings. Uses **sample data clearly labeled "Sample"** |
| 6 | **Confidence labels** | P1 | Each score says where it came from: "Estimated from public data" vs "Based on N vendor reports" |

**Build order if time gets tight:** Event list + Fit score first → extractor → public signals → rating screen last.

### Explicitly OUT of scope (roadmap slide only)
Accounts/auth, payments, reminders/notifications, Square/Clover integration, real vendor verification (photo/receipt upload). **Do not build these.** If a card seems to need auth, fake it with a hardcoded demo brand.

---

## 3. The demo (what everything serves)

Judging slot = **4 min demo + 3 min Q&A**, live on our own laptop.

1. **(0:00–0:30)** Who it's for + problem: a juice brand staring at 30 events and $100–$2,000 booth fees.
2. **(0:30–1:30)** Show the event list. Extractor reads a **real fair PDF live** and a new event appears.
3. **(1:30–2:45)** Brand enters its numbers (price, margin, costs) → events **re-rank instantly** by Fit score. Click one to show the math breakdown + confidence label.
4. **(2:45–3:30)** Rating screen: how vendor reports make scores more accurate over time (give-to-get).
5. **(3:30–4:00)** Close: "Competitors list events. Boothfinder tells you which pay." + roadmap.

**Demo safety rules:** pre-run the extractor on every demo event; keep a recorded backup video open in a tab; the live link must work on judges' devices.

---

## 4. Scoring math (source of truth for the fit-score card)

### Expected sales
`E[S] = (A × p × T) / (1 + N)`

- **A** = attendance
- **p** = purchase rate (share of attendees who buy)
- **T** = average ticket ($)
- **N** = number of similar/competing vendors

### Return
`Return = (E[S] × m − F − C) / (F + C)`

- **m** = gross margin (0–1)
- **F** = booth fee
- **C** = other costs (travel, staff, supplies, electricity)

### Sales adjustments (multipliers, all default to 1.0)
`E[S]_adj = E[S] × M_region × M_day × M_weather × M_income`

| Factor | Evidence | How we apply it |
|---|---|---|
| Region | USDA: peak-day farmers market sales avg $17,951 West vs $5,284 South; national $11,615 | Index region average vs national |
| Weekday vs weekend | O'Hara et al.: weekend vendor sales rise as markets grow; weekday sales fall past ~30 vendors | Penalize crowded weekday events more |
| Weather | Cold/alcoholic drink sales rise with temp to ~32°C; hot drinks drop near zero above 22°C | Forecast high: boost cold drinks on warm days, hot drinks on cool days |
| Local income | Census median household income near event | Index vs state median (assumption, to validate) |

Multiplier values are **starting estimates**. Keep them in one config file so they're easy to tune.

### Fit score (0–100)
`Fit = 100 × (0.6 × R + 0.25 × Q_audience + 0.15 × Q_organization)`

- **R** = Return scaled to 0–1
- **Q_audience**, **Q_organization** = vendor ratings scaled to 0–1 (use a neutral 0.5 default when there are no ratings)
- Weights are a starting guess. Keep them in config.
- **Decided (Nov 14):** Return maps to R by clamping −100% → +200% onto 0–1 (see §10). The full model, with fee rules, capacity cap, scenarios and break-even, is the projection engine in `lib/scoring/projection.ts`.

### Worked example (use as a unit test)
8,000 attendees, 4% buy at $8, 3 rival drink vendors, 60% margin, $200 total cost (F + C)
→ E[S] = 8,000 × 0.04 × 8 / 4 = **$640**
→ Return = (640 × 0.6 − 200) / 200 = **92%**

### Public signals (no vendors needed)
- **Returning vendor rate:** compare vendor lists year over year. Returners signal an event that pays.
- **Attendance:** race finisher counts, fair press releases, organizer claims. Needs a fallback estimate when missing.
- **Vendor density:** food & drink vendors per 1,000 attendees.
- **Fee per attendee:** booth fee ÷ attendance.

---

## 5. Tech stack & architecture

| Layer | Choice |
|---|---|
| Framework | **Next.js** (App Router, TypeScript) |
| Styling | Tailwind CSS (+ shadcn/ui if wanted) |
| Database | **Supabase** (Postgres) |
| AI extractor | LLM API (OpenAI credits are free this weekend; Claude also fine). Called **server-side only** |
| Hosting | **Vercel** (auto-deploys `main` → the live link judges use) |
| Repo | One **public** GitHub repo owned by Duke, created **after Fri 5:00 PM** |

### Data model (plain-English; the DB card owner turns this into the schema)

- **events**: name, start/end dates, city, county, venue, event type (fair / race / market / festival), source URL, how to apply, application deadline, booth fee (low/high if tiered), application fee, electricity fee, booth size, expected attendance, attendance source, number of vendor spots, limits on similar vendors, % of sales taken, weekday/weekend, notes, `is_sample` flag, created via (manual / extractor).
- **event_vendor_lists**: event, year, vendor name, vendor category (food / drink / other). Powers returning-vendor rate and vendor density.
- **ratings**: event, booth cost, sales range, traffic (1–5), competing vendors count, audience fit (1–5), organization (1–5), would return (yes/no), `is_sample` flag.
- **brand profile**: NOT stored. Lives in client state for the demo (price, margin, purchase rate, other costs, product type hot/cold).

### Suggested folder layout
```
/app                     → pages & routes
  /events                → event list + event detail
  /extract               → extractor UI
  /rate                  → give-to-get rating flow
  /api/extract           → server route that calls the LLM
/components              → shared UI (one subfolder per feature)
  /events  /extract  /fit  /ratings  /ui
/lib
  /scoring               → pure scoring functions + config (multipliers, weights)
  /extractor             → prompt + parsing logic
  /supabase              → DB client
  types.ts               → SHARED types (protected, see §6)
/supabase/migrations     → DB schema changes (protected, see §6)
/data/seed               → seed events & sample ratings
MASTER.md                → this file
CLAUDE.md / AGENTS.md    → one line each: "Read MASTER.md first."
```

Scoring logic must be **pure functions** in `/lib/scoring` (no DB or UI calls) so the UI can re-rank instantly and anyone can test it.

### 5a. Accounts & environment setup

**Only Duke needs Supabase and Vercel accounts.** Everyone else works through the GitHub repo.

| Thing | Owner | Everyone else |
|---|---|---|
| Supabase project (database) | Duke | Gets the project URL + anon/publishable key privately → puts them in `.env.local` |
| Vercel project (live link) | Duke | Nothing. Merges to `main` auto-deploy; PRs get preview links |
| GitHub repo | Duke creates it | Added as collaborators |

**Duke's setup checklist (after Fri 5:00 PM):**
1. Create a **public** GitHub repo and add Bodie, Paxton and Hayden as collaborators. (Public is required: on Vercel's free Hobby plan, deploys from a private repo are blocked when the commit author isn't Duke.)
2. Import the repo into Vercel. Add the Supabase URL, anon key and service-role key as Vercel environment variables.
3. Send the team the Supabase URL and anon key privately (group chat, never the repo).
4. Optional: invite the team to the Supabase organization so anyone can view tables.

**Key rules:**
- `.env.local` is gitignored. Never commit keys. The repo is public.
- The **service-role key** skips all database security. Only Duke and Vercel have it. Never use it in client-side code.
- Teammates: add an `.env.example` file listing variable *names* only (no values) whenever you add a new env var, and tell Duke so he adds it to Vercel.

### 5b. Database changes (migrations)

Duke's Claude applies database changes through the **Supabase MCP**. Nobody edits the database by hand in the SQL editor.

**The loop:**
1. A teammate's card needs a DB change → their AI writes a **new** migration file in `/supabase/migrations/` (timestamped name, e.g. `20261114_add_sales_cut_to_events.sql`). Never edit an existing migration.
2. The migration ships in the card's PR. Mention it in the PR title, e.g. "feat: sales cut field (+ migration)".
3. After merging, **ping Duke in the group chat.** The change isn't in the database until he applies it, and code depending on it will break until then.
4. Duke runs the prompt below. His Claude shows each SQL change, waits for approval, applies it, and regenerates shared types.

**Prompt for Duke to paste into Claude:**
> Pull the latest `main`. Compare the files in `/supabase/migrations/` with the migrations already applied on our Supabase project (use `list_migrations`). For each migration not yet applied, oldest first: show me the SQL, wait for my OK, then run it with `apply_migration` (not `execute_sql`, so it's recorded in migration history). Afterwards, regenerate TypeScript types and update `/lib/types.ts`, then open a PR with the types change.

**Rules for agents writing migrations:**
- Prefer **adding** (new tables, new nullable columns) over renaming or dropping. Drops and renames break teammates' code and can delete data; flag them to the human first.
- One migration per logical change. Keep them small.
- Agents other than Duke's **must not** run SQL against the database. Write the migration file and stop.
- Duke's agent uses `apply_migration`, never `execute_sql`, for structure changes, so migration history stays accurate.
- The Supabase MCP must not be in read-only mode on Duke's machine, or migrations can't be applied.

---

## 6. Collaboration rules (how we don't break each other)

### The team
| Person | Notes |
|---|---|
| Bodie | |
| Duke | Wrote the original Boothfinder concept |
| Paxton | |
| Hayden | |

Nobody "owns" a layer. **You own whatever card you've claimed.** Schedules differ, so people jump in and out.

### The Kanban loop (every card, every time)
1. **Pull:** `git checkout main && git pull`.
2. **Claim:** move a card to *In Progress* on the board and put your name on it. One card per person at a time.
3. **Branch:** `feat/<card-short-name>` (e.g., `feat/fit-calculator`, `fix/extractor-pdf-dates`).
4. **Build** only what the card says. Commit small and often with clear messages.
5. **Sync:** before opening a PR, pull `main` into your branch and fix conflicts locally.
6. **PR → main:** short description (what changed, how to test, screenshots if UI). Confirm `npm run build` passes.
7. **Merge:** use a **merge commit** (not squash, not rebase). Self-merge is OK if the Vercel preview works and no one's reviewed within ~30 min. Ping the group chat when merged.
8. **Done:** move the card to *Done*, keep the branch (don't delete it), pick the next card.

### Protected shared files (announce in group chat BEFORE editing)
- `/lib/types.ts` — **add** fields freely; **renaming or removing** a field needs a heads-up, because it breaks other people's code.
- `/supabase/migrations/*` — never edit an existing migration. Add a new timestamped one, then ping Duke to apply it (see §5b).
- `/app/layout.tsx`, global styles, nav — keep changes minimal.
- `package.json` — adding a dependency is fine; say so in your PR description.
- `MASTER.md` — update when a decision is made (see §10), in its own small PR or commit.

### Rules for AI agents specifically
- **Read MASTER.md and the card before writing code.** Ask the human which card they're on if unclear.
- **Don't refactor, rename, or "clean up" files outside the current card.** Even if it looks wrong. Flag it to the human instead.
- **Don't add new libraries** when an existing one in the repo does the job.
- **Don't invent data.** Real events come from real sources. Anything fake must have `is_sample = true` and be visibly labeled "Sample" in the UI (fake data presented as real = disqualification).
- **Never commit secrets.** Use `.env.local` (gitignored). Never print keys in logs, screenshots, or the demo.
- **Never** run `git push --force`, `git reset --hard` on shared branches, delete branches, or squash history.
- **Keep the app deployable.** `main` must always build. If your change breaks the build, fix or revert before anything else.
- **Credit what we didn't make:** if you add a library, template, dataset, icon set, or font, add it to §9 Credits.
- **Log notable AI use** in §9 (judges score creative AI use, and the submission form asks what each tool did).

---

## 7. Starter Kanban cards

Copy these onto the board. **Sections = priority (P0/P1/P2/Pitch), tags = category.** On the board, keep status columns (To Do → In Progress → Done) and use priority + category as labels, sorting To Do with P0 on top. Split any card that feels bigger than ~2–3 hours.

**How to pick a card:** take the top unclaimed card in the highest-priority column. Don't start a P1 while a P0 is unclaimed, unless it's blocked or someone's already on it. Pitch cards are the exception: anyone can grab one anytime, especially non-coders.

**Category tags:** `[Setup]` `[Events]` `[Fit Score]` `[Extractor]` `[Signals]` `[Ratings]` `[UI]` `[Pitch]`

### P0 — Foundation (blocks everything; one person, Friday night)
- [ ] `[Setup]` Create repo + Next.js app + Tailwind; add MASTER.md, CLAUDE.md, AGENTS.md
- [ ] `[Setup]` Supabase project + initial schema migration (events, vendor lists, ratings) + shared types
- [ ] `[Setup]` Vercel deploy hooked to `main`; env vars set; share live link
- [ ] `[Events]` Seed script + first 10 real events (manual entry is fine)

### P0 — Must-have for the demo
- [ ] `[Fit Score]` Pure scoring functions + config (E[S], Return, R mapping, multipliers, Fit) + worked-example test
- [ ] `[Events]` `[UI]` Event list page: cards/table with name, date, location, fee, deadline, Fit score
- [ ] `[Fit Score]` `[UI]` Brand input panel (price, margin, purchase rate, other costs, hot/cold product) → instant re-rank
- [ ] `[Extractor]` `/api/extract` route: URL or PDF in → LLM → structured fields out (with nulls for missing)
- [ ] `[Extractor]` `[UI]` Extractor UI: upload/paste → preview extracted fields → edit → save to DB
- [ ] `[Extractor]` `[Events]` Run extractor on all demo events; fix failures; reach 20–30 events
- [ ] `[Events]` `[UI]` Event detail page: all fields + source link + "Apply" link-out

### P1 — Makes the demo convincing
- [ ] `[Fit Score]` `[UI]` Score breakdown on event detail ("why this score")
- [ ] `[Fit Score]` Confidence label logic ("Estimated from public data" vs "Based on N vendor reports")
- [ ] `[Signals]` Collect past vendor lists for events that publish them
- [ ] `[Signals]` Compute returning vendor rate, vendor density, fee per attendee; show on detail page
- [ ] `[Events]` `[UI]` Filters: county, event type, date range, deadline upcoming
- [ ] `[UI]` Landing hero: scroll-driven 3D booth with the one-line pitch (full spec + prompt in §12; timebox 2–3 hrs)

### P2 — Nice-to-have (only after all P0s are merged)
- [ ] `[Ratings]` Sample ratings seed (labeled Sample)
- [ ] `[Ratings]` `[UI]` Give-to-get flow: rate one event → unlock ratings view
- [ ] `[Ratings]` `[Fit Score]` Ratings feed into Q_audience / Q_organization in the Fit score

### Pitch — anytime, anyone (non-code)
- [ ] `[Pitch]` Talk to 2–3 real vendors at local markets (proof for "Real problem" score)
- [ ] `[Pitch]` Business model: who pays (vendor subscription? organizer listings?), how we get first users
- [ ] `[Pitch]` Demo script + slides (problem, demo, business model, roadmap)
- [ ] `[Pitch]` Record < 2 min backup demo video (unlisted YouTube/Loom) — needed for any challenge entry

---

## 8. Hackathon rules & deadlines that affect the code

**Build window:** Fri Nov 13, 5:00 PM → Sun Nov 15, 12:00 PM (Pacific). Nothing in the demo can be built before Fri 5:00 PM.

| When | What |
|---|---|
| Fri 8:50 PM | Lock team (one person submits the team-lock form) |
| Fri 9:00 PM | Required Codex workshop, whole team |
| **Sat 2:00 PM** | **Project link due** (GitHub repo link) |
| Sat 8:00 PM | **Sunday commit due** + live link (Vercel URL must work) |
| **Sun 12:00 PM** | **Submissions close.** After this: no new features, no fixes |
| Sun 12:55 PM | In judging room |

Room hours: Fri 5–9:45 PM, Sat 9:15 AM–9:45 PM, Sun 8:15 AM–12 PM. Building off-site after hours is allowed.

**Rules that matter for agents:**
- One repo, created after Fri 5 PM. Don't duplicate it or move to a fresh repo at the end.
- Don't delete commits, branches, or AI chats until prizes are paid. History is checked.
- Templates, open-source, APIs, public datasets are fine. **Credit them.**
- Use AI somewhere (we obviously will). List each tool + what it did on the submission form.
- No sensitive data collection. If we talk to real vendors, tell them it's a student hackathon project.
- Store only facts from event sites, link back to apply, respect site terms.

### Judging rubric (build toward the Top column)
| Category | Pts | What gets us top marks |
|---|---|---|
| Execution & design | 25 | Core flow runs live, smooth, good-looking |
| Real problem, real user | 25 | Specific user (small drink brands), proof they want it (vendor conversations) |
| Path to customers | 20 | Who pays, why they switch, where first users come from |
| Pitch & demo | 15 | Clear in first 30 sec, one clean user path, sharp Q&A |
| Creative use of AI | 15 | AI extractor turning messy PDFs/forms into structured, scored data, beyond a bolted-on chatbot |

Tiebreak: Real problem, then Execution & design.

---

## 9. Logs (append as you go)

### Credits (libraries, templates, data, icons, fonts)
- USDA farmers market sales data (region multiplier)
- O'Hara et al. (weekday/weekend vendor effect)
- U.S. Census median household income (income multiplier)
- three.js, React Three Fiber, drei (landing hero 3D)
- GSAP + ScrollTrigger (landing hero scroll animation)
- Lenis (smooth scrolling)
- Mapbox GL JS + Mapbox basemap (vendor dashboard map; free tier, public token)
- Leaflet (vendor dashboard map fallback when no Mapbox token is set)
- OpenStreetMap contributors (map tiles and data, ODbL)
- Lucide (icons)
- Figtree (typeface, Google Fonts, OFL)
- Tavily Search API (web search for vendor-opportunity discovery)
- Nominatim / OpenStreetMap (geocoding discovered events; data under ODbL)
- SeatGeek (visual reference for the vendor dashboard's layout and style; no assets or code used)
- unpdf (reads text from vendor packet PDFs for the AI extractor and discovery)
- _add more…_

### AI tools used & what they did (for the submission form)
- Claude Code / Codex — code generation
- LLM in product — event extraction from PDFs, web pages and pasted text (Groq, `openai/gpt-oss-120b`), on Event Host › Create Event
- LLM in product — vendor-opportunity discovery: reads organizer pages and linked vendor PDFs found by web search, returns each fact with a verbatim quote; code checks every quote against the source and discards facts that don't match, then a person approves before anything is published
- _add more…_

### Real-user evidence
- _who we talked to (no sensitive info), what they said_

---

## 10. Decision log

Record anything the team decides that changes how code is written. Newest at the top.

| Date/time | Decision | By |
|---|---|---|
| Nov 14 | Projection engine v1 (Bodie's `BOOTHFINDER_PROJECTION_ENGINE_SPEC.md`, team-approved) is the vendor score: projected **dollar profit** with conservative / base / optimistic scenarios, typed fee rules, booth-capacity cap and break-even. Fit score kept as a secondary ranking. Code: `lib/scoring/projection.ts` (+ tests) | Team (Hayden built) |
| Nov 14 | Purchase rate `p` = **category-wide** share of attendees (all competing vendors), split by `1 + N` | Team (Hayden) |
| Nov 14 | Return → R: clamp operating return **−100% … +200%** linearly onto 0–1 (`RETURN_TO_R` in `lib/scoring/projection.ts`) | Hayden (Fit-score card) |
| Nov 14 | Extractor = Event Host › Create Event (`/host/dashboard/create`); uses the shared Groq settings `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL` (`openai/gpt-oss-120b`) | Paxton |
| Nov 14 | Discovery covers all of California (58 counties, San Luis Obispo and Santa Barbara searched first). Discovered opportunities reach `events` only after a person approves them at `/admin/discovery` | Bodie |
| Nov 14 | Landing hero = scroll-driven 3D booth; all tuning lives in `/lib/hero/heroConfig.ts` (§12) | Bodie |
| Nov 13 | Stack: Next.js + Supabase + Vercel | Team |
| Nov 13 | Workflow: Kanban card → feature branch → PR → merge commit to main | Team |
| Nov 13 | Brand profile lives in client state, not DB (no auth) | Team |
| Nov 13 | Duke owns Supabase + Vercel; repo is public so everyone's merges deploy | Team |
| Nov 13 | DB changes = migration files in repo, applied by Duke's Claude via Supabase MCP | Team |

---

## 11. Risks

| Risk | Response |
|---|---|
| Judges ask where profitability data comes from | Public signals from day one; give-to-get ratings over time; confidence labels show it honestly |
| Extractor fails live | Pre-run on all demo events; backup video in a tab |
| Too much to build | Event list + Fit score first; rating screen last |
| Merge conflicts / broken main | Small cards, pull before branching, protected-files rule, fix-or-revert immediately |
| Missing attendance data | Fallback estimate by event type, labeled as estimated |
| 3D hero eats build time or lags on demo laptop | P1 only, timeboxed; text-only fallback; mobile + reduced-motion modes; demo can start on `/events` |

---

## 12. Landing hero: scroll-driven 3D booth (spec for the hero card)

> Card: `[UI]` **Landing hero: scroll-driven 3D booth** (P1). Only start it once the P0 cards are claimed or merged. **Timebox ~2–3 hrs.** If it fights you, ship the text-only version (sections without the canvas) and move on.

### 12.1 What it does
A single landing page at `/`. A stylized **pop-up vendor booth** (canopy, table, drink cups, a price sign) sits pinned on screen while the visitor scrolls through **4 full-screen sections**. Scroll position scrubs the animation directly (no autoplay). Each section's text slides in on its side while the booth moves to make room.

| # | Section | Text side | Booth does |
|---|---|---|---|
| 1 | Pitch: "Competitors list events. We tell you which ones pay." | Left | Sits right, angled 3/4 view |
| 2 | Problem: vendor calls are scattered everywhere | Right | Rotates **90°** and slides left |
| 3 | The math: $100–$2,000 fees, Fit score | Left | **Zooms in** on the price sign (the "fee" detail) |
| 4 | CTA: "Find your next booth" → `/events` | Right | Shrinks and **moves left** to make room for the CTA |

Sections mirror demo steps 1 and 3, so the hero can double as the opening 30 seconds of the pitch.

Look: dark (`neutral-950`), emerald accent, huge bold type (`font-black`, 5xl mobile / 7xl desktop). Target 60fps.

### 12.2 Stack (new dependencies, mention them in the PR)
`three`, `@react-three/fiber`, `@react-three/drei`, `gsap` (ScrollTrigger is included), `lenis`, dev: `@types/three`.
If the repo is on React 19 (Next 15 default), that means `@react-three/fiber@9` + `@react-three/drei@10`; latest versions handle this.

**No CDN assets at runtime** (no drei `<Environment preset>`, no drei `<Text>` default font). The demo must not depend on venue wifi for the hero.

### 12.3 Files (stay inside these)
```
/lib/hero/heroConfig.ts          → THE ONLY FILE you edit to tweak animation, copy, or swap the model
/components/hero/heroState.ts    → shared mutable target (GSAP writes, 3D scene reads)
/components/hero/HeroScroll.tsx  → page layout, Lenis, GSAP timelines, section text
/components/hero/HeroCanvas.tsx  → R3F canvas, lights, per-frame easing
/components/hero/BoothModel.tsx  → loads your .glb, or draws the placeholder booth
/public/models/                  → drop your .glb here later
/app/page.tsx                    → renders <HeroScroll />
```

### 12.4 How it works (one paragraph)
One GSAP timeline is attached to the whole hero with `scrub`. It tweens a plain object (`heroTarget`) from section 1's keyframe → 2 → 3 → 4, one tween per section of scroll. The R3F scene reads `heroTarget` every frame and **damps** the model and camera toward it, which keeps motion smooth even on jumpy trackpads. No React state changes at 60fps, so no re-renders. Lenis smooths wheel scrolling on desktop and feeds ScrollTrigger. Each text block has its own scrubbed timeline: slide in → hold → slide out as its section passes.

### 12.5 Mobile & accessibility rules
- **≤768px:** model moves to the top half, text sits at the bottom; text slides **up** instead of sideways; no Lenis (native touch scroll); no antialias; DPR capped at 1.5; no contact shadow.
- **prefers-reduced-motion:** no smooth scroll, no animation; booth stays at section 1's pose, text is just visible.
- Canvas is `aria-hidden` and `pointer-events-none`; all text is real HTML (one `h1`, rest `h2`).

### 12.6 Reference code

**`/lib/hero/heroConfig.ts`**
```ts
// ─────────────────────────────────────────────────────────────
// Landing hero config. Tweak animation, copy, and the 3D model HERE.
// Rotation = degrees. Position = world units (x: right+, y: up+).
// cameraZ = camera distance (smaller = more zoomed in).
// ─────────────────────────────────────────────────────────────
export type Vec3 = [number, number, number];

export type HeroKeyframe = {
  rotation: Vec3;
  position: Vec3;
  scale: number;
  cameraZ: number;
};

export type HeroSection = {
  id: string;
  side: "left" | "right"; // where the TEXT goes on desktop
  eyebrow: string;
  title: string;
  body: string;
  cta?: { label: string; href: string };
  desktop: HeroKeyframe; // pose the booth reaches when this section fills the screen
  mobile?: Partial<HeroKeyframe>; // overrides on top of HERO_MOBILE_BASE
};

// Swap in your own model: put it in /public/models/ and set url, e.g. "/models/booth.glb".
// null = built-in placeholder booth. Use scale/offset/baseRotation to make
// an imported model sit like the placeholder (~2.8 units tall, centered on 0,0,0).
export const HERO_MODEL = {
  url: null as string | null,
  scale: 1,
  offset: [0, 0, 0] as Vec3,
  baseRotation: [0, 0, 0] as Vec3,
};

export const HERO_SETTINGS = {
  scrub: 1, // seconds the animation trails the scroll (true = locked 1:1)
  damping: 8, // per-frame easing toward the target (higher = snappier)
  ease: "power2.inOut", // easing between section poses
  fov: 35,
  lenisDuration: 1.1, // smooth-scroll feel on desktop
  mobileBreakpoint: 768,
};

// Applied to every section on mobile, before that section's own `mobile` overrides.
export const HERO_MOBILE_BASE: Partial<HeroKeyframe> = {
  position: [0, 0.9, 0], // booth in the top half, text below
  scale: 0.6,
  cameraZ: 8,
};

export const HERO_SECTIONS: HeroSection[] = [
  {
    id: "pitch",
    side: "left",
    eyebrow: "Boothfinder",
    title: "Competitors list events. We tell you which ones pay.",
    body: "Vendor calls for fairs, races, and markets across San Luis Obispo and Santa Barbara counties, scored for your brand.",
    desktop: { rotation: [12, -25, 0], position: [1.6, 0, 0], scale: 1, cameraZ: 7 },
  },
  {
    id: "scattered",
    side: "right",
    eyebrow: "The problem",
    title: "Vendor calls are everywhere.",
    body: "Eventeny, ZAPP, Google Forms, PDFs. Our AI reads them and pulls out the fee, the deadline, and the crowd size.",
    desktop: { rotation: [12, 65, 0], position: [-1.6, 0, 0], scale: 1, cameraZ: 7 }, // +90° turn
  },
  {
    id: "fee",
    side: "left",
    eyebrow: "The math",
    title: "$100 to $2,000. Know before you pay.",
    body: "Enter your price, margin, and costs. Every event gets a 0–100 Fit score and re-ranks instantly.",
    desktop: { rotation: [5, 20, 0], position: [0, -0.2, 0], scale: 1, cameraZ: 3 }, // zoom on the price sign
    mobile: { position: [-0.55, 0.7, 0], scale: 1, cameraZ: 4.5 },
  },
  {
    id: "cta",
    side: "right",
    eyebrow: "Get started",
    title: "Find your next booth.",
    body: "Central Coast fairs, races, and markets, ranked by what they're likely to earn you.",
    cta: { label: "Browse events", href: "/events" },
    desktop: { rotation: [12, -35, 0], position: [-2, 0, 0], scale: 0.9, cameraZ: 7 }, // moves left for the CTA
  },
];

export function resolveKeyframe(s: HeroSection, isMobile: boolean): HeroKeyframe {
  return isMobile ? { ...s.desktop, ...HERO_MOBILE_BASE, ...s.mobile } : s.desktop;
}
```

**`/components/hero/heroState.ts`**
```ts
import type { HeroKeyframe } from "@/lib/hero/heroConfig";

// Plain mutable object, deliberately NOT React state: GSAP writes it on scroll,
// the 3D scene reads it every frame. No re-renders at 60fps.
export const heroTarget = { rx: 0, ry: 0, rz: 0, px: 0, py: 0, pz: 0, scale: 1, cameraZ: 7 };

export function toTarget(k: HeroKeyframe) {
  return {
    rx: k.rotation[0], ry: k.rotation[1], rz: k.rotation[2],
    px: k.position[0], py: k.position[1], pz: k.position[2],
    scale: k.scale, cameraZ: k.cameraZ,
  };
}
```

**`/components/hero/HeroScroll.tsx`**
```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import "lenis/dist/lenis.css";
import { HERO_SECTIONS, HERO_SETTINGS, resolveKeyframe } from "@/lib/hero/heroConfig";
import { heroTarget, toTarget } from "./heroState";

const HeroCanvas = dynamic(() => import("./HeroCanvas"), { ssr: false });

function useMediaQuery(query: string) {
  const [match, setMatch] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatch(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return match;
}

export default function HeroScroll() {
  const rootRef = useRef<HTMLDivElement>(null);
  const isMobile = useMediaQuery(`(max-width: ${HERO_SETTINGS.mobileBreakpoint}px)`);
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);
    const frames = HERO_SECTIONS.map((s) => toTarget(resolveKeyframe(s, isMobile)));
    Object.assign(heroTarget, frames[0]);
    if (reduceMotion) return;

    // Smooth scroll on desktop only; phones keep native touch scrolling.
    let lenis: Lenis | null = null;
    const raf = (time: number) => lenis?.raf(time * 1000);
    if (!isMobile) {
      lenis = new Lenis({ duration: HERO_SETTINGS.lenisDuration });
      lenis.on("scroll", ScrollTrigger.update);
      gsap.ticker.add(raf);
      gsap.ticker.lagSmoothing(0);
    }

    const ctx = gsap.context(() => {
      // 1) Booth: one tween per section, scrubbed across the whole hero.
      const tl = gsap.timeline({
        defaults: { ease: HERO_SETTINGS.ease, duration: 1 },
        scrollTrigger: {
          trigger: rootRef.current,
          start: "top top",
          end: "bottom bottom",
          scrub: HERO_SETTINGS.scrub,
        },
      });
      frames.slice(1).forEach((f) => tl.to(heroTarget, f));

      // 2) Text: slide in → hold → slide out while its section passes.
      gsap.utils.toArray<HTMLElement>("[data-hero-text]").forEach((el) => {
        const dx = isMobile ? 0 : el.dataset.side === "left" ? -80 : 80;
        const dy = isMobile ? 40 : 0;
        gsap
          .timeline({
            scrollTrigger: { trigger: el.closest("section"), start: "top bottom", end: "bottom top", scrub: true },
          })
          .fromTo(el, { autoAlpha: 0, x: dx, y: dy }, { autoAlpha: 1, x: 0, y: 0, duration: 0.35, ease: "power2.out" })
          .to({}, { duration: 0.3 })
          .to(el, { autoAlpha: 0, x: -dx / 2, y: -dy, duration: 0.35, ease: "power2.in" });
      });
    }, rootRef);

    ScrollTrigger.refresh();
    return () => {
      ctx.revert();
      if (lenis) {
        gsap.ticker.remove(raf);
        lenis.destroy();
      }
    };
  }, [isMobile, reduceMotion]);

  return (
    <div ref={rootRef} className="relative bg-neutral-950 text-white">
      {/* Pinned 3D layer */}
      <div aria-hidden className="pointer-events-none sticky top-0 h-svh w-full">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(16,185,129,0.14),transparent_60%)]" />
        <HeroCanvas key={isMobile ? "m" : "d"} isMobile={isMobile} />
      </div>

      {/* Scrolling text, pulled up over the pinned layer */}
      <div className="relative z-10 -mt-[100svh]">
        {HERO_SECTIONS.map((s, i) => {
          const Heading = i === 0 ? "h1" : "h2";
          return (
            <section
              key={s.id}
              className={`flex h-svh items-end px-6 pb-16 md:items-center md:px-16 md:pb-0 ${
                s.side === "left" ? "md:justify-start" : "md:justify-end"
              }`}
            >
              <div data-hero-text data-side={s.side} className="max-w-xl">
                <p className="mb-4 text-xs font-semibold uppercase tracking-[0.25em] text-emerald-400">{s.eyebrow}</p>
                <Heading className="text-5xl font-black leading-[0.95] tracking-tight md:text-7xl">{s.title}</Heading>
                <p className="mt-6 text-lg text-neutral-400 md:text-xl">{s.body}</p>
                {s.cta && (
                  <Link
                    href={s.cta.href}
                    className="mt-8 inline-flex rounded-full bg-emerald-400 px-7 py-3.5 font-semibold text-neutral-950 transition hover:bg-emerald-300"
                  >
                    {s.cta.label} →
                  </Link>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
```

**`/components/hero/HeroCanvas.tsx`**
```tsx
"use client";

import { Suspense, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows } from "@react-three/drei";
import * as THREE from "three";
import BoothModel from "./BoothModel";
import { heroTarget } from "./heroState";
import { HERO_SETTINGS } from "@/lib/hero/heroConfig";

const DEG = Math.PI / 180;
const { damp } = THREE.MathUtils;

function Rig({ isMobile }: { isMobile: boolean }) {
  const ref = useRef<THREE.Group>(null);

  useFrame(({ camera }, dt) => {
    const g = ref.current;
    if (!g) return;
    const k = HERO_SETTINGS.damping;
    g.rotation.set(
      damp(g.rotation.x, heroTarget.rx * DEG, k, dt),
      damp(g.rotation.y, heroTarget.ry * DEG, k, dt),
      damp(g.rotation.z, heroTarget.rz * DEG, k, dt),
    );
    g.position.set(
      damp(g.position.x, heroTarget.px, k, dt),
      damp(g.position.y, heroTarget.py, k, dt),
      damp(g.position.z, heroTarget.pz, k, dt),
    );
    g.scale.setScalar(damp(g.scale.x, heroTarget.scale, k, dt));
    camera.position.z = damp(camera.position.z, heroTarget.cameraZ, k, dt);
  });

  return (
    <group ref={ref}>
      <Suspense fallback={null}>
        <BoothModel />
        {!isMobile && (
          <ContactShadows position={[0, -1.22, 0]} scale={6} blur={2.4} opacity={0.55} far={3} frames={1} />
        )}
      </Suspense>
    </group>
  );
}

export default function HeroCanvas({ isMobile }: { isMobile: boolean }) {
  return (
    <Canvas
      camera={{ position: [0, 0, 7], fov: HERO_SETTINGS.fov }}
      dpr={isMobile ? [1, 1.5] : [1, 2]}
      gl={{ antialias: !isMobile, alpha: true, powerPreference: "high-performance" }}
    >
      <ambientLight intensity={0.5} />
      <directionalLight position={[4, 6, 5]} intensity={2.2} />
      <directionalLight position={[-5, 3, -4]} intensity={1.2} color="#34d399" />
      <Rig isMobile={isMobile} />
    </Canvas>
  );
}
```

**`/components/hero/BoothModel.tsx`**
```tsx
"use client";

import { useGLTF } from "@react-three/drei";
import { HERO_MODEL, type Vec3 } from "@/lib/hero/heroConfig";

const DEG = Math.PI / 180;

function GlbModel({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  return <primitive object={scene} />;
}

// Placeholder: 10x10 pop-up canopy booth built from primitives (no external assets).
function PlaceholderBooth() {
  const metal = <meshStandardMaterial color="#d4d4d8" metalness={0.6} roughness={0.3} />;
  return (
    <group position={[0, -1.2, 0]}>
      {/* legs */}
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]) => (
        <mesh key={`${x}${z}`} position={[x, 1, z]}>
          <cylinderGeometry args={[0.03, 0.03, 2, 8]} />
          {metal}
        </mesh>
      ))}
      {/* valance + canopy roof */}
      <mesh position={[0, 2.05, 0]}>
        <boxGeometry args={[2.1, 0.25, 2.1]} />
        <meshStandardMaterial color="#059669" />
      </mesh>
      <mesh position={[0, 2.55, 0]} rotation={[0, Math.PI / 4, 0]}>
        <coneGeometry args={[1.5, 0.75, 4]} />
        <meshStandardMaterial color="#10b981" flatShading />
      </mesh>
      {/* table top + front skirt */}
      <mesh position={[0, 0.9, 0.45]}>
        <boxGeometry args={[1.8, 0.06, 0.7]} />
        <meshStandardMaterial color="#3f3f46" />
      </mesh>
      <mesh position={[0, 0.45, 0.8]}>
        <boxGeometry args={[1.8, 0.84, 0.02]} />
        <meshStandardMaterial color="#27272a" />
      </mesh>
      {/* juice cups */}
      {[["#fb923c", -0.6], ["#f472b6", -0.4], ["#facc15", -0.2]].map(([c, x]) => (
        <mesh key={c as string} position={[x as number, 1.02, 0.45]}>
          <cylinderGeometry args={[0.07, 0.055, 0.18, 16]} />
          <meshStandardMaterial color={c as string} roughness={0.4} />
        </mesh>
      ))}
      {/* price sign: the "detail" section 3 zooms in on */}
      <mesh position={[0.5, 1.08, 0.6]}>
        <boxGeometry args={[0.03, 0.3, 0.03]} />
        {metal}
      </mesh>
      <mesh position={[0.5, 1.35, 0.6]}>
        <boxGeometry args={[0.5, 0.32, 0.03]} />
        <meshStandardMaterial color="#f59e0b" emissive="#f59e0b" emissiveIntensity={0.25} />
      </mesh>
      <mesh position={[0.5, 1.35, 0.617]}>
        <circleGeometry args={[0.09, 24]} />
        <meshStandardMaterial color="#0a0a0a" />
      </mesh>
    </group>
  );
}

export default function BoothModel() {
  const { url, scale, offset, baseRotation } = HERO_MODEL;
  return (
    <group scale={scale} position={offset} rotation={baseRotation.map((d) => d * DEG) as Vec3}>
      {url ? <GlbModel url={url} /> : <PlaceholderBooth />}
    </group>
  );
}
```

**`/app/page.tsx`** (if `/` already has content, put `<HeroScroll />` at the top and keep the rest)
```tsx
import HeroScroll from "@/components/hero/HeroScroll";

export default function Home() {
  return (
    <main className="bg-neutral-950">
      <HeroScroll />
    </main>
  );
}
```

### 12.7 Where to change things
| I want to… | Change this (all in `/lib/hero/heroConfig.ts`) |
|---|---|
| Edit any section's words or the CTA link | `HERO_SECTIONS[n].eyebrow / title / body / cta` |
| Change how the booth moves in a section | `HERO_SECTIONS[n].desktop` (rotation in degrees, position, scale, cameraZ) |
| Fix the phone layout for one section | `HERO_SECTIONS[n].mobile` |
| Fix the phone layout everywhere | `HERO_MOBILE_BASE` |
| Put text on the other side | `HERO_SECTIONS[n].side`, then mirror that section's `position[0]` |
| Add or remove a section | Add/remove an object in `HERO_SECTIONS` (page height and timeline adjust automatically) |
| Make scroll feel tighter or floatier | `HERO_SETTINGS.scrub`, `damping`, `lenisDuration` |
| Swap in a real model | Drop `booth.glb` in `/public/models/`, set `HERO_MODEL.url = "/models/booth.glb"`, then adjust `scale / offset / baseRotation` until it sits like the placeholder |
| Change colors / fonts | Tailwind classes in `HeroScroll.tsx`; placeholder colors in `BoothModel.tsx` |

**Model tips:** export `.glb` from Blender (or grab a CC-licensed booth from Poly Pizza / Sketchfab and **credit it in §9**). Keep it under ~3 MB. Aim for ~2.8 units tall, centered on the origin, front facing +Z. Skip Draco compression; drei loads the Draco decoder from a CDN, and we don't want the hero depending on venue wifi.

### 12.8 Done means
- [ ] Scrolling scrubs the booth through all 4 poses; scrolling back reverses it exactly.
- [ ] Text slides in on the correct side per section; CTA links to `/events`.
- [ ] Smooth on the demo laptop (no visible stutter), and usable on a phone-width viewport.
- [ ] Reduced motion (OS setting) shows a static booth and readable text.
- [ ] `npm run build` passes; no new console errors; no runtime network requests for 3D assets.

### 12.9 Prompt for whoever takes this card (paste into Claude Code / Codex)
> Read MASTER.md, especially §6 and §12. I'm on the card "Landing hero: scroll-driven 3D booth." Pull `main` and create branch `feat/landing-hero`. Install `three @react-three/fiber @react-three/drei gsap lenis` and `-D @types/three`, using versions compatible with the React version in our package.json. Create exactly the files listed in §12.3 using the reference code in §12.6. If `/app/page.tsx` already has content, add `<HeroScroll />` at the top and delete nothing; ask me first if that's unclear. Don't edit any file outside §12.3 (including MASTER.md and layout.tsx). Run `npm run build` and fix errors only inside the hero files. Then tell me how to test it on desktop, at phone width in dev tools, and with reduced motion on. Commit with clear messages and open a PR titled "feat: landing hero (3D scroll, new deps)" that lists the new dependencies.
