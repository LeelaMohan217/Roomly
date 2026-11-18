/**
 * The app is light-only. It ignores the phone's dark mode setting, so anything
 * that asks for the colour scheme always gets 'light'.
 */
export function useColorScheme(): 'light' {
  return 'light';
}
