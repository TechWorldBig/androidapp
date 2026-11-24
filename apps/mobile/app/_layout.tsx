import { Stack } from 'expo-router';

export default function Layout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#141517' },
        headerTintColor: '#f6f5f0',
        contentStyle: { backgroundColor: '#f5f4ef' },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="profile" options={{ title: 'My Profile' }} />
      <Stack.Screen name="quizzes" options={{ title: 'Bible Challenges' }} />
      <Stack.Screen name="quiz/[id]" options={{ title: 'Challenge' }} />
    </Stack>
  );
}
