import { Stack } from 'expo-router';

// The tab bar lives in (tabs). Everything here sits above it: screens you
// visit and come back from, and Add Expense as a modal because it's a task
// you start and finish rather than a place you navigate to.
export default function AppLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="settle" />
      <Stack.Screen name="away" />
      <Stack.Screen name="household" />
      <Stack.Screen name="expense/[id]" />
      <Stack.Screen name="pair/[id]" />
      <Stack.Screen name="settings" />
      <Stack.Screen name="account-edit" />
      <Stack.Screen name="edit-history" />
      <Stack.Screen name="recurring" />
      <Stack.Screen name="recurring-edit" />
      <Stack.Screen name="owner" />
      <Stack.Screen name="categories" />
      <Stack.Screen name="category-edit" />
      <Stack.Screen name="search" />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="settlements" />
      <Stack.Screen name="month-statement" />
      <Stack.Screen name="add-expense" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
