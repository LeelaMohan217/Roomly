import { requireOptionalNativeModule } from 'expo';

/** An installed app that can pay by UPI, as Android reports it. */
export type PayApp = {
  packageName: string;
  label: string;
  /** PNG data URI of the app's own icon; null when Android could not draw it. */
  icon: string | null;
};

type UpiAppsModule = {
  list(): Promise<PayApp[]>;
  open(packageName: string): boolean;
};

/**
 * modules/upi-apps, when this build has it.
 *
 * It is a native module, so APKs built before it was added do not have it --
 * and an EAS update can reach those APKs. Optional, so the Pay button simply
 * does not appear there instead of crashing the screen. Null on web too.
 */
const native = requireOptionalNativeModule<UpiAppsModule>('RoomlyUpiApps');

export function canPayByUpi(): boolean {
  return native != null;
}

/** Every installed app that opens upi:// links, sorted by name. */
export async function listPayApps(): Promise<PayApp[]> {
  if (!native) return [];
  try {
    return await native.list();
  } catch {
    return [];
  }
}

/** Opens the app at its home screen. False if it could not be opened. */
export function openPayApp(packageName: string): boolean {
  try {
    return native?.open(packageName) ?? false;
  } catch {
    return false;
  }
}

/**
 * The amount as a payment app's amount box wants it pasted: digits and at
 * most two decimals, no rupee sign, no grouping commas. 124000 -> "1240",
 * 124050 -> "1240.50".
 */
export function pasteableAmount(paise: number): string {
  const rupees = Math.floor(paise / 100);
  const rest = paise % 100;
  return rest === 0 ? String(rupees) : `${rupees}.${String(rest).padStart(2, '0')}`;
}
