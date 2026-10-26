# Supabase setup

Run every file in `migrations/` in the Supabase **SQL Editor**, in numeric
order, top to bottom. Each ends with a `select` whose columns must all read
`true` — that is how you confirm it applied, because a migration pasted into
the SQL Editor can roll back silently.

| # | File | What it does |
|---|------|--------------|
| 0001 | Schema | Tables, enums, indexes |
| 0002 | Invariants | Triggers: split balance, period derivation, residency, audit |
| 0003 | RLS | Row level security policies |
| 0004 | Functions | `create_household`, invites, join approval, month close |
| 0005 | Views | `member_balances`, reports, the imbalance canary |
| 0006–0021 | Fixes and features | Settlements, recurring, notifications, push, member admin |
| 0022 | Expense idempotency | `p_client_id` so a replayed offline write cannot duplicate money |
| 0023 | Recurring | Claim-before-write, missed-month backfill, day 1–31 |
| 0024 | One balance expression | `member_balance()`; departed members' history frozen |
| 0025 | Closed months | Period checks on the three functions that bypassed RLS |
| 0026 | Payee confirms | The person paid confirms the payment, not the owner |
| 0027 | Rejoin + Realtime | One *active* membership per account; Realtime publication |
| 0028–0033 | Fixes | Joined-on dates, payment guards, household timezone, member autonomy, settlement period trigger |
| 0034 | Lock function grants | Every function closed to clients except an explicit allowlist; new functions start closed |
| 0035 | Phone sign-in | Phone number + password as a second way to sign in, no SMS. The only two functions open to `anon` |

## Adding a function

Since `0034`, new functions in `public` get **no** EXECUTE for `anon` or
`authenticated`. End every migration that adds a function the app calls (or
drops and re-creates one, which also resets its grants; `create or replace`
keeps them) with `grant execute on function … to authenticated;`. Forget it and the
RPC fails with "permission denied", which is the safe way to fail. Functions
that only triggers or other SECURITY DEFINER functions call need no grant.

## After running them

1. **Authentication → Providers**: enable Email. (Google sign-in is *not*
   implemented in the app — there is no `signInWithOAuth` call anywhere in
   `src/`. Enabling the provider alone does nothing.)
2. **Authentication → URL Configuration**: add `roomly://` to the redirect
   allowlist, or password reset will silently go nowhere.
3. **Realtime**: nothing to do — `0027` adds `notifications` and
   `join_requests` to the `supabase_realtime` publication in SQL.

   This used to be a manual **Database → Replication** step, and it named the
   wrong tables: `expenses` and `pending_changes` are not subscribed to by
   anything, while `notifications` — which `src/lib/realtime.ts` actually
   listens to — was never mentioned. Following this file exactly left live
   refresh dead and the waiting-for-approval screen stuck forever.

## Upgrading an existing project past 0022

`0022` **drops** the old 7-argument `create_expense` and replaces it with an
8-argument one, because two overloads differing only by a defaulted trailing
argument make PostgREST refuse to pick. Any build older than 0022 will fail on
Add Expense the moment it is applied — **rebuild the APK in the same sitting**.

## Sanity check

```sql
select * from ledger_imbalance();
```

Must return zero rows. If it ever returns a household, money has been
invented or destroyed — look at the split balance trigger first.

## Never

- Put the `service_role` key in the app, `.env`, or git. It bypasses every
  policy in `0003_rls.sql`.
- Store a balance in a column. They are derived in `0005_views.sql` for a
  reason.
- Accept `period_id` from the client. `0002` derives it from `expense_date`
  so nobody can backdate into a closed month.
