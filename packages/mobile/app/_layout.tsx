import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: "#1A6B3C" },
          headerTintColor: "#FFFFFF",
          headerTitleStyle: { fontWeight: "700", fontSize: 18 },
          contentStyle: { backgroundColor: "#F5F5F0" },
        }}
      >
        <Stack.Screen
          name="index"
          options={{ title: "SafeCare Driver", headerShown: false }}
        />
        <Stack.Screen
          name="dashboard"
          options={{ title: "Dashboard", headerBackVisible: false }}
        />
        <Stack.Screen
          name="delivery/[id]"
          options={{ title: "Delivery" }}
        />
      </Stack>
    </SafeAreaProvider>
  );
}
