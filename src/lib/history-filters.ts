import { create } from 'zustand';

/**
 * History's filters, shared between the History tab and the full-screen
 * Filters page that edits them.
 *
 * A store rather than route params: the page edits a draft and applies it on
 * the way back, and params only travel forwards. Not persisted -- a filter
 * left on from last week would make History look like it had lost expenses.
 */
export type HistoryFilters = {
  /** Empty means every category. */
  categoryIds: string[];
  /** Who paid. Empty means anyone. */
  paidByIds: string[];
  /** Inclusive ISO dates; either may be open. */
  from: string | null;
  to: string | null;
};

export const NO_FILTERS: HistoryFilters = {
  categoryIds: [],
  paidByIds: [],
  from: null,
  to: null,
};

type Store = HistoryFilters & {
  apply: (filters: HistoryFilters) => void;
  clear: () => void;
};

export const useHistoryFilters = create<Store>((set) => ({
  ...NO_FILTERS,
  apply: (filters) => set(filters),
  clear: () => set(NO_FILTERS),
}));

/** How many kinds of filter are on -- the badge on History's filter button. */
export function activeFilterCount(f: HistoryFilters): number {
  return (
    (f.categoryIds.length > 0 ? 1 : 0) +
    (f.paidByIds.length > 0 ? 1 : 0) +
    (f.from || f.to ? 1 : 0)
  );
}
