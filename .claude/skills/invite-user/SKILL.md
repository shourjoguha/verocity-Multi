---
name: invite-user
description: Mint a Verocity invite (promo) code for a new user and publish the welcome page that goes with it — invite code, a five-step Get started guide (register, onboarding, pick a plan, settings, first log) and a Reference map of every screen and term. Also answers "how many invites/spots are left", "which codes are used or expired", and revokes a code. Use when asked for an invite, promo or signup code, a new-user guide, or the state of signups.
---

# Invite a new user

The output is always the same two things: **the code**, and **a published
welcome page** in the exact format of `scripts/invites/welcome.template.html`.
Do not redesign the page per request. If the app changes, change the template
once and every later invite follows.

## Where things live

| | |
|---|---|
| Code + page generator | `scripts/invites/new-invite.mjs` |
| Page template | `scripts/invites/welcome.template.html` (placeholders `{{CODE}}`, `{{EXPIRES_LONG}}`, `{{EXPIRES_SHORT}}`, `{{READY_PLANS}}`, `{{SITE}}`) |
| Ledger queries | `scripts/invites/ledger.sql` |
| Ledger views | `public.invite_ledger`, `public.invite_capacity` (`supabase/migrations/0051_invite_ledger.sql`) |
| What redeems a code | `supabase/functions/signup/index.ts` (sha-256 of the trimmed code, single use, expiry, cap of 100) |

Supabase project: `zwuaieavvmjacqtbzowm`. Site: `lift.shourjoguha.com`.

## Mint one

1. **Check headroom first:** `select * from public.invite_capacity;`
   If `spots_without_a_code` is 0, stop and say so: every free spot already
   has an open code, and another code could be refused with `cap_reached`.
2. **Get the live ready-plan names** (the page names them, so they must be
   real):
   `select name from public.plan_templates where not retired order by sort_order;`
3. **Generate**, writing the page to the scratchpad:
   ```
   node scripts/invites/new-invite.mjs --label "<who it is for>" \
     --plans "<name1>|<name2>|<name3>" --days 30 --out <scratchpad>/verocity-welcome-<who>.html
   ```
   Ask who it's for if you weren't told; the label is the only way to tell
   codes apart later. 30 days is the default expiry.
4. **Register it:** run the printed `sql` with the Supabase MCP `execute_sql`.
   Then confirm it's there:
   `select status, label, code_hint, expires_at from public.invite_ledger where code_hint = '<last 4>';`
   A code that was never inserted is worthless, so don't hand it over without this check.
5. **Publish** the rendered file with the Artifact tool (`icon: "guide"`).
   It is private: tell the user they must share it before the recipient can
   open it, and that anyone with the link can use the code (single use).
6. **Reply** with the code, the expiry, the artifact link, and the
   `invite_capacity` numbers.

The plaintext code is never stored. If it's lost, expire it and mint a new one.

## Report on the ledger

Run both queries in `scripts/invites/ledger.sql`. The fields mean:

- `spots_left` = 100 minus profiles. Signups still possible.
- `open_codes`: unused, unexpired codes that are out there.
- `spots_without_a_code` = spots left minus open codes. Spots nobody has been given a code for yet.
- `status`: `open` / `used` / `expired`, derived at read time and never stored.

Codes minted before 0051 have no `label` or `code_hint`.

## Revoke one

`update public.invites set expires_at = now() where code_hint = '<last 4>' and used_at is null;`
Check `code_hint` is unique among open codes first; it's only 4 characters.

## Don't

- Don't store a plaintext code anywhere: database, repo, or commit message.
- Don't change the 100 in `invite_capacity` without also changing
  `PROFILE_CAP` in `supabase/functions/signup/index.ts`. Both are needed:
  the edge function enforces the cap, and the view only reports it.
- Don't hand-edit a rendered page to fix wording. Fix the template.
