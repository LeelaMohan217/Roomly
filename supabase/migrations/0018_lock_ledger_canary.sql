-- Roomly -- take ledger_imbalance() away from clients.
--
-- The function is SECURITY DEFINER with no auth filter, and Postgres grants
-- EXECUTE to PUBLIC on every new function. So anyone holding the publishable
-- key -- which ships inside the APK, and is meant to -- could call it:
--
--   POST /rest/v1/rpc/ledger_imbalance  ->  200 []
--
-- Today it answers with an empty array because no household is imbalanced.
-- If one ever were, it would hand a stranger that household's UUID and the
-- exact drift amount. No names, no balances, nothing about who owes whom, so
-- the severity is low -- but it is the only function in the schema that
-- reports across ALL households, and nothing in the app ever calls it.
--
-- Not scoped to current_household() instead, deliberately. Its whole job is to
-- be a global canary run from the SQL editor after a migration, and the SQL
-- editor has no auth.uid() -- scoping it would make every verification query
-- in 0017 and the seed file silently report "balanced" while checking nothing.
-- Revoking keeps it honest for the owner and unreachable for everyone else.
--
-- Pure ASCII, no transaction wrapper, verification at the end.


-- PUBLIC matters more than the role names here: without revoking it, anon and
-- authenticated keep EXECUTE through the default grant.
revoke execute on function ledger_imbalance() from public;
revoke execute on function ledger_imbalance() from anon;
revoke execute on function ledger_imbalance() from authenticated;


-- ---------------------------  verification  ---------------------------
-- Both must read true. The third confirms the canary itself still works for
-- the owner, so this migration has not blinded the check it is protecting.

select
  not has_function_privilege('anon', 'ledger_imbalance()', 'execute')
    as anon_cannot_execute,
  not has_function_privilege('authenticated', 'ledger_imbalance()', 'execute')
    as authenticated_cannot_execute,
  (select count(*) = 0 from ledger_imbalance())
    as ledger_still_balances;
