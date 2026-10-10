# Manual test cases

Everything here needs a signed-in session, a real device, or a second person —
so it cannot be run from the automated suites. Tick these off on the APK.

Legend: **[P1]** breaks the ledger or loses money · **[P2]** breaks a feature ·
**[P3]** cosmetic

---

## 1. Auth

| # | Case | Expected | P |
|---|---|---|---|
| 1.1 | Register with a new email | "Check your email" screen appears | P2 |
| 1.2 | Register with an email already in use | Clear error, no crash | P2 |
| 1.3 | Register with a 7-character password | Blocked with "Use at least 8 characters" | P3 |
| 1.4 | Sign in with a wrong password | Error shown, stays on the form | P2 |
| 1.5 | Tap "Forgot password?" → submit email | "Check your email", regardless of whether the account exists | P2 |
| 1.6 | Open the reset link from the phone | Lands on "Choose a new password", **not** the app home | P1 |
| 1.7 | Open the same reset link twice | Second time: "Link didn't work" | P2 |
| 1.8 | Set a new password, then sign in with it | Works; the old password is refused | P1 |
| 1.9 | Kill and reopen the app while signed in | Still signed in, no flash of the login screen | P2 |
| 1.10 | Cold launch while **signed out** | **Sign-in screen**, not "Link didn't work" | P1 |
| 1.11 | Sign in successfully | Lands on Home, **not** "Choose a new password" | P1 |
| 1.12 | Cold launch signed in with no household | Onboarding, not the reset screen | P2 |

## 2. Onboarding and joining

| # | Case | Expected | P |
|---|---|---|---|
| 2.1 | New account → Create household | 13 categories are seeded, you are Owner | P2 |
| 2.2 | New account → Join with a bad code | "That invite code is not valid" | P2 |
| 2.3 | Join with a valid code, claiming a placeholder | Waiting screen appears | P2 |
| 2.4 | Owner approves that request | Joiner's screen **advances by itself** over Realtime | P2 |
| 2.5 | Joiner inherits the placeholder's expenses | Their balance is unchanged by the claim | P1 |
| 2.6 | Owner rejects a request | Joiner sees a dead end and can request again | P3 |
| 2.7 | Reuse a single-use code after approval | Refused | P2 |

## 3. Adding expenses — the core path

| # | Case | Expected | P |
|---|---|---|---|
| 3.1 | Add ₹100 Groceries split 3 ways | Splits are 3334/3333/3333, payer takes the extra paisa | P1 |
| 3.2 | Balances after 3.1 | All balances still sum to exactly zero | P1 |
| 3.3 | Add an expense with no category chosen | Save stays disabled | P3 |
| 3.4 | Deselect everyone in the split | Last person cannot be removed | P2 |
| 3.5 | Enter "12.999" as the amount | Save stays disabled | P3 |
| 3.6 | Enter a very large amount (10,00,000) | Accepted, formatted correctly | P3 |
| 3.7 | Tap a suggestion chip | Amount, category and description all fill in | P3 |
| 3.8 | Add backdated to "Yesterday" | Lands in the right day group in History | P2 |
| 3.9 | Add the first expense of a new month | **Succeeds** — this was the RLS/period bug | P1 |

## 4. The away calendar — the app's core idea

| # | Case | Expected | P |
|---|---|---|---|
| 4.1 | Mark Ravi away today, add **Groceries** | Ravi is struck through, labelled "away", not charged | P1 |
| 4.2 | Same day, add **Rent** | Ravi **is** charged — fixed costs ignore the calendar | P1 |
| 4.3 | Same day, add **Gas Cylinder** | Ravi **is** charged — bulk ignores the calendar | P1 |
| 4.4 | Add an expense dated the day after the trip ends | Ravi is back in | P1 |
| 4.5 | Mark a trip overlapping an existing one | "That overlaps a trip already marked for this person." | P2 |
| 4.6 | Mark a backdated trip | Warning naming how many expenses were already split | P2 |
| 4.7 | Mark everyone away, add Groceries | Falls back to everyone rather than an empty split | P1 |
| 4.8 | Remove a trip | Splits already saved do **not** change | P1 |

## 5. Editing and deleting

| # | Case | Expected | P |
|---|---|---|---|
| 5.1 | Owner edits an expense amount | Saves; balances and Reports both move | P1 |
| 5.2 | Member edits an expense | Creates a request; figures do not change yet | P1 |
| 5.3 | Owner approves that request | Change applies, balances move | P1 |
| 5.4 | Second edit while one is pending | "There is already a change waiting" | P2 |
| 5.5 | Owner deletes an expense | Marked deleted, drops out of balances, still visible | P1 |
| 5.6 | Restore a deleted expense | Returns to balances | P2 |
| 5.7 | Edit an expense in a closed month | Blocked with the lock explanation | P1 |

## 6. Settling up

| # | Case | Expected | P |
|---|---|---|---|
| 6.1 | Four people with mixed balances | At most 3 transfers, everyone lands at zero | P1 |
| 6.2 | "Why this amount?" | Breakdown adds up to the stated balance | P2 |
| 6.3 | Mark a payment | Confirm dialog says it does **not** move real money | P1 |
| 6.4 | Balances after marking paid | Both people move by exactly that amount | P1 |
| 6.5 | Undo a payment | Struck through, both balances revert | P1 |
| 6.6 | Close a month with a pending change | Refused until it is resolved | P2 |
| 6.7 | Add an expense into a closed month | Refused | P1 |

## 7. Recurring

| # | Case | Expected | P |
|---|---|---|---|
| 7.1 | Add fixed-amount rent for the 1st | "First posts on 1 <next month>" | P2 |
| 7.2 | Reopen the app on/after that day | Rent posts **once** | P1 |
| 7.3 | Open the app repeatedly that day | Still only **one** rent expense | P1 |
| 7.4 | Two people open the app the same morning | Still only **one** rent expense | P1 |
| 7.5 | "Varies" bill on its due day | Prompt for the amount, nothing auto-posted | P1 |
| 7.6 | Post a varying bill with an amount | Expense created with that amount | P2 |
| 7.7 | Pause a rule | Stops posting; past expenses stay | P2 |
| 7.8 | Delete a rule | Past expenses stay untouched | P1 |

## 8. Offline — never yet run for real

| # | Case | Expected | P |
|---|---|---|---|
| 8.1 | Aeroplane mode, open the app | Balances and expenses still shown from cache | P2 |
| 8.2 | Aeroplane mode, add an expense | Saves, form closes, shows "sending…" | P1 |
| 8.3 | Aeroplane mode banner | "Offline — N expenses will send when you reconnect" | P2 |
| 8.4 | Turn aeroplane mode off | Queue drains, expense appears normally | P1 |
| 8.5 | Queue two, then reconnect | Both send, no duplicates | P1 |
| 8.6 | Kill the app while offline with a queued item | Item survives the restart | P1 |
| 8.7 | Add into a closed month while offline | Rejected **immediately**, not queued | P2 |

## 9. Notifications

| # | Case | Expected | P |
|---|---|---|---|
| 9.1 | You add an expense | **No** unread badge for you | P3 |
| 9.2 | Ravi adds an expense | Your bell shows unread | P2 |
| 9.3 | Both apps open when Ravi adds | Your Home updates without a refresh | P2 |
| 9.4 | Open Activity, then leave | Unread clears on exit, not on entry | P3 |
| 9.5 | Tap an expense notification | Opens that expense | P3 |
| 9.6 | Recurring rent posts | Everyone else is notified | P2 |

## 10. Permissions

| # | Case | Expected | P |
|---|---|---|---|
| 10.1 | Sign in as a non-owner | No Owner tools; Categories read-only | P1 |
| 10.2 | Non-owner opens /owner directly | "Owner only" screen | P2 |
| 10.3 | Non-owner tries to add a housemate | No button offered | P2 |
| 10.4 | Non-owner deletes their own expense | Creates a request, not a deletion | P1 |

## 11. Robustness — R8 shrinking is untested

Open **every** screen once on the release APK. R8 removes code it cannot see
used, and React Native uses reflection, so a crash would appear on one screen
only and only in the release build.

Home · History · Reports · More · Add expense · Expense detail · Settle up ·
Payments · Month statement · Away · Household · Categories · Category edit ·
Recurring · Recurring edit · Notifications · Search · Owner tools · Account

| # | Case | Expected | P |
|---|---|---|---|
| 11.1 | Visit all 19 screens | None crash | P1 |
| 11.2 | Rotate the device on each | No layout break | P3 |
| 11.3 | Set the system font to largest | Text stays readable, no clipping | P3 |
| 11.4 | Switch the system to light mode | Every screen readable | P2 |

## 12. Sheets and safe areas

The sheet used to be pinned to the bottom of the physical display with a fixed
32dp gutter, which is less than a 48dp three-button navigation bar. Check on a
device with **three-button navigation**, not gestures, and not an emulator.

| # | Case | Expected | P |
|---|---|---|---|
| 12.1 | Household -> Add housemate | The whole button is visible and tappable | P1 |
| 12.2 | Same sheet, focus the Name field | Button stays above the keyboard | P1 |
| 12.3 | Same sheet, keyboard up, drag the form | Scrolls; the button can be reached | P2 |
| 12.4 | Household -> Invite with a code | "Create a code" fully visible | P2 |
| 12.5 | Add expense -> category picker | Last option clears the nav bar | P2 |
| 12.6 | System font at maximum, any button | Label stays on one line | P3 |

## 13. Editing your details

| # | Case | Expected | P |
|---|---|---|---|
| 13.1 | Settings -> tap the profile card | Opens "Edit your details" | P2 |
| 13.2 | Rename yourself **as a non-owner** | Saves. This silently did nothing before | P1 |
| 13.3 | Pick an avatar colour | Changes everywhere, incl. History and Settle | P3 |
| 13.4 | Owner renames the household | Name updates in Settings and Household | P2 |
| 13.5 | Non-owner opens the screen | No household section offered | P2 |
| 13.6 | Change password, sign out, sign back in | New password works, old one refused | P1 |
| 13.7 | Change email | Confirmation sent to the new address | P2 |

## 14. Removing a housemate

| # | Case | Expected | P |
|---|---|---|---|
| 14.1 | Remove a placeholder with no expenses | Actually disappears. Did nothing before | P1 |
| 14.2 | Remove someone who has paid for things | "has moved out"; history untouched | P1 |
| 14.3 | Balances after 14.2 | `ledger_imbalance()` still returns no rows | P1 |
| 14.4 | Remove someone with a non-zero balance | Refused, told to settle up first | P1 |
| 14.5 | Remove the payer of a recurring rule | Refused, told to fix the rule first | P2 |
| 14.6 | Try to remove yourself, or the owner | No trash icon offered | P2 |
| 14.7 | Non-owner views Household | No trash icons at all | P1 |
| 14.8 | A moved-out person's past expenses | Still show their name and amounts | P1 |
