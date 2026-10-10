import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

/**
 * A durable queue of writes that haven't reached the server yet.
 *
 * AsyncStorage rather than the SQLite outbox table: this holds a handful of
 * pending expenses, not a mirror of the ledger, and AsyncStorage works
 * identically on device and in the web preview. The SQLite schema stays in
 * place for the day reads move local too.
 *
 * Display fields (category name, payer name) are stored alongside the payload
 * so a queued expense can be rendered without joining against data we may not
 * have cached.
 */

const KEY = 'roomly.outbox.v1';
const MAX_ATTEMPTS = 5;

export type PendingExpense = {
  id: string;
  createdAt: string;
  totalPaise: number;
  categoryId: string;
  categoryName: string;
  categoryIcon: string | null;
  description: string | null;
  expenseDate: string;
  paidBy: string;
  paidByName: string;
  splits: { member_id: string; amount_paise: number }[];
  attempts: number;
  lastError: string | null;
  /** Stopped retrying — the server rejected it for a reason time won't fix. */
  blocked: boolean;
};

export async function loadOutbox(): Promise<PendingExpense[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PendingExpense[]) : [];
  } catch {
    // A corrupt queue must not brick the app; losing unsent items is bad but
    // an unopenable app is worse.
    return [];
  }
}

async function save(items: PendingExpense[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(items));
}

/** A fresh idempotency key. Minted before the first send attempt, not after
 *  it fails, so a queued retry carries the same key the lost attempt used. */
export function newClientId(): string {
  return Crypto.randomUUID();
}

export async function enqueue(
  item: Omit<PendingExpense, 'id' | 'createdAt' | 'attempts' | 'lastError' | 'blocked'>,
  id: string = newClientId()
): Promise<PendingExpense> {
  const entry: PendingExpense = {
    ...item,
    // Generated on the client so the row has its identity before it ever
    // reaches the server. This id is sent as create_expense's p_client_id and
    // is what makes a replay return the original row instead of a second one
    // (migration 0022) -- for years it was generated and then never sent,
    // which is precisely how a lost response duplicated an expense.
    id,
    createdAt: new Date().toISOString(),
    attempts: 0,
    lastError: null,
    blocked: false,
  };

  const items = await loadOutbox();
  items.push(entry);
  await save(items);
  return entry;
}

export async function remove(id: string): Promise<PendingExpense[]> {
  const items = (await loadOutbox()).filter((i) => i.id !== id);
  await save(items);
  return items;
}

export async function recordFailure(id: string, message: string): Promise<PendingExpense[]> {
  const items = await loadOutbox();
  const item = items.find((i) => i.id === id);
  if (item) {
    item.attempts += 1;
    item.lastError = message;
    // Past a handful of tries this isn't a network blip — it's a rejection.
    // Stop hammering the server and surface it instead.
    item.blocked = item.attempts >= MAX_ATTEMPTS;
  }
  await save(items);
  return items;
}

export async function retry(id: string): Promise<PendingExpense[]> {
  const items = await loadOutbox();
  const item = items.find((i) => i.id === id);
  if (item) {
    item.attempts = 0;
    item.blocked = false;
    item.lastError = null;
  }
  await save(items);
  return items;
}

export async function clear(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}
