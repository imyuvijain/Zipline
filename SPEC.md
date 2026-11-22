# Team 23 — Master Spec

YC × ElevenLabs Hackathon · UWaterloo E7 · Sun 2026-11-22
Challenge: **"an AI coworker they'd actually use."**

> **The idea is NOT final yet.** Sections marked `TBD` get filled in once we lock it.
> Until then: set up accounts, claim perks, and get your workstream's skeleton running.

---

## 1. Hard deadlines (all ET)

| Time | What |
|---|---|
| 11:00 | Hacking starts (repo created 11:00:01) |
| **11:20** | **Idea locked.** Fill in §3 and the names in §4 |
| 12:00 | Every workstream has a "hello world" running end to end with fake data |
| 12:30 | Lunch (eat at your laptop, 15 min max) |
| 13:30 | Happy path works end to end on real input |
| **14:15** | **Feature freeze.** Only bug fixes and demo polish after this |
| 14:30 | Record the 2-min demo video. Rehearse the 3-min live demo twice |
| **14:50** | **Submit the form** (closes 15:00 sharp, late = not judged) |
| 15:00–16:30 | Expo judging at our table: 3-min demo + 2-min Q&A, twice, to 2 judges |
| 16:35 | Top 4 pitch live to partner CEOs |

## 2. How we get judged

| Weight | Criterion | What it means for us |
|---|---|---|
| 25% | Technical execution | Works **live on real input**. No slides, no fake screens |
| 25% | ElevenLabs + partner tools | Voice and partner tools are **central**, not bolted on |
| 25% | Usefulness / impact | A real problem for a clear user |
| 15% | Demo & communication | Clear in 3 minutes. Lead with the demo |
| 10% | Creativity | One moment judges remember |

**Partner prizes stack** with everything, so use tools where they do real work:
ElevenLabs (Best Use) · Maritime (top 3 agents run on Maritime) · Codevisor (Mac Mini) · Wasp (built with Wasp).
List **every** partner tool we used on the submission form.

## 3. The product — `TBD at 11:20`

- **One-liner:** TBD
- **User:** TBD
- **The 3-minute demo, beat by beat:** TBD
- **The "wow" moment:** TBD
- **Partner tools and the job each one does:** TBD
- **Out of scope (we're NOT building):** TBD

## 4. Roles

Four workstreams. Each person owns one end to end, and owners decide inside their lane.

| Role | Owner | Owns | Done by 12:00 |
|---|---|---|---|
| **A. Lead / Product / Pitch** | TBD | Locks scope, keeps §1 deadlines, owns `SPEC.md`, demo script, 2-min video, submission form, Q&A prep. Also does integration glue | Demo script v1 + submission form drafted |
| **B. Voice** | TBD | Everything ElevenLabs: agent persona, prompts, voice, phone/call flow, tool calls back into our backend | Agent talks and can hit one of our endpoints |
| **C. Agent / Backend** | TBD | The brain: LLM agent loop, tools, data, API server, partner APIs (Maritime, Alter, etc.) | Server running, one endpoint returns fake data |
| **D. Frontend / Demo surface** | TBD | What judges see: UI (Wasp and/or assistant-ui), live status, the demo environment, sabotage/real-input hooks | UI renders fake data from C's endpoint |

**Rules for roles**
- If you're blocked for **more than 10 minutes**, say so in the group chat. Don't wait it out.
- Lead (A) is the tiebreaker on scope. Owners decide implementation.
- Done early? Pick up the top item from the "nice to have" list in §3. Ask A first.

## 5. Interfaces — `TBD with the idea`

Agree on these **before** writing real code, so all four lanes can build in parallel against fake data.

- API endpoints + request/response JSON shapes: TBD
- Events the UI shows (what, when): TBD
- Who calls whom: Voice ↔ Backend ↔ UI: TBD

Put shared types/schemas in `shared/` and don't change them without telling the group.

## 6. Repo conventions

```
/web        D: frontend
/server     C: backend + agent
/voice      B: ElevenLabs agent config, prompts, call scripts
/shared     shared types / schemas
/demo       A: demo script, seed data, video notes
SPEC.md     this file (A owns it)
```

- **Branch per person** (`a/…`, `b/…`, `c/…`, `d/…`). Merge to `main` often, small PRs or straight merges. `main` must always run.
- **Commit at least every 30 min.** The judges only count work done today, and the history proves it.
- **No secrets in git.** Use `.env` (gitignored) and keep `.env.example` updated with key *names* only.
- **Don't commit the hacker package PDF or any promo codes.**
- Stuck on a partner API for 20+ min? Fake it behind an interface, flag it to A, move on.

## 7. Setup checklist (everyone, first 15 min)

- [ ] Accept GitHub invite to `imyuvijain/team23-hack`, clone, make your branch
- [ ] ElevenLabs account + claim the Creator coupon (ElevenLabs Discord → #coupon-codes)
- [ ] Claim the partner perks your lane needs. Codes are in the hacker package PDF
      (Maritime, assistant-ui, Alter, Rowboat, traceroot, Expected Parrot, Ploid). Don't paste codes in the repo
- [ ] Check email for the free API-credits login
- [ ] Put your API keys in your local `.env`

## 8. Demo rules

- **Live on real input.** Judges may try to break it, so make that a feature, not a risk.
- Have a **fallback**: the recorded 2-min video, ready to play if Wi-Fi or a partner API dies.
- Pre-load and seed everything before judging. Run the full demo once right before each judge.
- Start with the demo, not slides. First 20 seconds: who the user is and what hurts.

## 9. Submission (A owns, due 14:50)

Google Form (link in the hacker package PDF). Needs:
- [ ] Project link (repo, make it **public** before submitting if needed)
- [ ] 2-minute demo video that **anyone can open** (test the link in incognito)
- [ ] Every partner tool we used
