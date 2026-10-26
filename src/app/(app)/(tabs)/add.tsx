/**
 * The centre slot of the tab bar. It never renders: the slot's tab button
 * (see the tabs layout) is the round Add button, which opens /add-expense as
 * a modal instead of switching here. The route exists only because a tab
 * needs a screen behind it.
 */
export default function AddSlot() {
  return null;
}
