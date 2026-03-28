import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  FlatList,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { router } from "expo-router";
import { StatusBar } from "../components/StatusBar";
import { DeliveryCard } from "../components/DeliveryCard";
import { checkIn, pollStatus, downloadRoute } from "../lib/api";
import { getRouteData, setRouteData, clearAll } from "../lib/storage";
import { flushSyncQueue } from "../lib/sync";

export type Delivery = {
  id: string;
  sequence: number;
  address: string;
  notes: string;
  status: "pending" | "in_transit" | "delivered";
};

type SessionStatus = "idle" | "checked_in" | "routes_released" | "shift_ended";

export default function DashboardScreen() {
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>("idle");
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadCachedRoute = useCallback(async () => {
    const cached = getRouteData();
    if (cached) {
      setDeliveries(cached);
      setSessionStatus("routes_released");
    }
  }, []);

  useEffect(() => {
    loadCachedRoute();
  }, [loadCachedRoute]);

  const handleCheckIn = async () => {
    setLoading(true);
    try {
      await checkIn();
      setSessionStatus("checked_in");
      Alert.alert("Checked In", "You are now marked as ready for routes.");
    } catch (err) {
      Alert.alert("Error", "Could not check in. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handlePollAndDownload = async () => {
    setRefreshing(true);
    try {
      const status = await pollStatus();
      if (status.routesReady) {
        const route = await downloadRoute();
        const items: Delivery[] = route.deliveries.map(
          (d: Delivery, i: number) => ({
            ...d,
            sequence: d.sequence ?? i + 1,
            status: d.status ?? "pending",
          })
        );
        setDeliveries(items);
        setRouteData(items);
        setSessionStatus("routes_released");
      } else {
        Alert.alert("Not Ready", "Routes have not been released yet. Try again shortly.");
      }
    } catch (err) {
      Alert.alert("Error", "Could not fetch routes. Check your connection.");
    } finally {
      setRefreshing(false);
    }
  };

  const handleEndShift = async () => {
    Alert.alert(
      "End Shift",
      "This will sync remaining updates and clear local data. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "End Shift",
          style: "destructive",
          onPress: async () => {
            setLoading(true);
            try {
              await flushSyncQueue();
              await clearAll();
              setDeliveries([]);
              setSessionStatus("shift_ended");
              Alert.alert("Shift Ended", "All data cleared. You may close the app.", [
                { text: "OK", onPress: () => router.replace("/") },
              ]);
            } catch (err) {
              Alert.alert("Error", "Could not end shift. Try again when online.");
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  const renderCheckedInView = () => (
    <View style={styles.centeredContent}>
      <Text style={styles.statusEmoji}>&#9203;</Text>
      <Text style={styles.waitingText}>Waiting for routes to be released...</Text>
      <Pressable
        style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
        onPress={handlePollAndDownload}
        accessibilityRole="button"
        accessibilityLabel="Check for routes"
      >
        <Text style={styles.secondaryButtonText}>Check for Routes</Text>
      </Pressable>
    </View>
  );

  const pendingCount = deliveries.filter((d) => d.status !== "delivered").length;
  const completedCount = deliveries.filter((d) => d.status === "delivered").length;

  return (
    <View style={styles.container}>
      <StatusBar sessionStatus={sessionStatus} />

      {sessionStatus === "idle" && (
        <View style={styles.centeredContent}>
          <Text style={styles.welcomeText}>Ready to start your shift?</Text>
          <Pressable
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.buttonPressed,
              loading && styles.buttonDisabled,
            ]}
            onPress={handleCheckIn}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel="Check in and mark ready for routes"
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryButtonText}>Ready for Routes</Text>
            )}
          </Pressable>
        </View>
      )}

      {sessionStatus === "checked_in" && renderCheckedInView()}

      {sessionStatus === "routes_released" && (
        <View style={styles.routeContent}>
          <View style={styles.summaryRow}>
            <View style={styles.summaryBox}>
              <Text style={styles.summaryNumber}>{pendingCount}</Text>
              <Text style={styles.summaryLabel}>Remaining</Text>
            </View>
            <View style={styles.summaryBox}>
              <Text style={[styles.summaryNumber, { color: "#1A6B3C" }]}>
                {completedCount}
              </Text>
              <Text style={styles.summaryLabel}>Delivered</Text>
            </View>
            <View style={styles.summaryBox}>
              <Text style={styles.summaryNumber}>{deliveries.length}</Text>
              <Text style={styles.summaryLabel}>Total</Text>
            </View>
          </View>

          <FlatList
            data={deliveries}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <DeliveryCard
                delivery={item}
                onPress={() => router.push(`/delivery/${item.id}`)}
              />
            )}
            contentContainerStyle={styles.list}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handlePollAndDownload}
                tintColor="#1A6B3C"
              />
            }
          />

          <Pressable
            style={({ pressed }) => [
              styles.endShiftButton,
              pressed && styles.buttonPressed,
              loading && styles.buttonDisabled,
            ]}
            onPress={handleEndShift}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel="End shift and clear data"
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.endShiftText}>End Shift</Text>
            )}
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F5F5F0",
  },
  centeredContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  welcomeText: {
    fontSize: 22,
    fontWeight: "600",
    color: "#333",
    textAlign: "center",
    marginBottom: 32,
  },
  statusEmoji: {
    fontSize: 48,
    marginBottom: 16,
  },
  waitingText: {
    fontSize: 18,
    color: "#555",
    textAlign: "center",
    marginBottom: 24,
  },
  primaryButton: {
    backgroundColor: "#1A6B3C",
    borderRadius: 12,
    paddingVertical: 20,
    paddingHorizontal: 40,
    minHeight: 64,
    minWidth: 240,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "700",
  },
  secondaryButton: {
    backgroundColor: "#FFFFFF",
    borderWidth: 2,
    borderColor: "#1A6B3C",
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 32,
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    color: "#1A6B3C",
    fontSize: 18,
    fontWeight: "700",
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  routeContent: {
    flex: 1,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: 16,
    paddingHorizontal: 12,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E0E0E0",
  },
  summaryBox: {
    alignItems: "center",
  },
  summaryNumber: {
    fontSize: 28,
    fontWeight: "800",
    color: "#333",
  },
  summaryLabel: {
    fontSize: 13,
    color: "#777",
    marginTop: 2,
  },
  list: {
    padding: 12,
    paddingBottom: 100,
  },
  endShiftButton: {
    position: "absolute",
    bottom: 24,
    left: 24,
    right: 24,
    backgroundColor: "#C0392B",
    borderRadius: 12,
    paddingVertical: 18,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 56,
  },
  endShiftText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
  },
});
