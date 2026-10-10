-- What is actually in the tables right now?

select
  (select count(*) from expenses)                              as expenses_total,
  (select count(*) from expenses where voided_at is null)      as expenses_live,
  (select count(*) from expense_splits)                        as splits,
  (select count(*) from members)                               as members,
  (select count(*) from periods)                               as periods,
  (select count(*) from categories)                            as categories;

-- Every expense, with its split count.
select
  e.id,
  e.total_paise,
  e.description,
  e.expense_date,
  e.voided_at,
  c.name  as category,
  c.icon  as icon_slug,
  m.display_name as paid_by,
  (select count(*) from expense_splits s where s.expense_id = e.id) as split_count,
  (select coalesce(sum(s.amount_paise), 0) from expense_splits s where s.expense_id = e.id) as split_sum
from expenses e
left join categories c on c.id = e.category_id
left join members    m on m.id = e.paid_by
order by e.created_at desc;

-- Did the icon slugs land?
select name, icon, kind, respects_away_calendar
from categories
order by sort_order;

-- The canary: must be empty.
select * from ledger_imbalance();
