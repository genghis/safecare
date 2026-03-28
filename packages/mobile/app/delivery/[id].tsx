import { useState, useEffect } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  Alert,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { StatusBar } from "../../components/StatusBar";
import { getRouteData, setRouteData } from "../../lib/storage";
import { enqueueStatusUpdate } from "../../lib/sync";
import type { Delivery } from "../dashboard";

export default function DeliveryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [delivery, setDelivery] = useState<Delivery | null>(null);

  useEffect(() => {
    const route = getRouteData();
    if (route) {
      const found = route.find((d: Delivery) => d.id === id);
      setDelivery(found ?? null);
    }
  }, [id]);

  const updateStatus = (newStatus: Delivery["status"]) => {
    if (!delivery) return;

    const updated = { ...delivery, status: newStatus };
    setDelivery(updated);

    const route = getRouteData();
    if (route) {
      const updatedRoute = route.map((d: Delivery) =>
        d.id === delivery.id ? updated : d
      );
      setRouteData(updatedRoute);
    }

    enqueueStatusUpdate({
      deliveryId: delivery.id,
      status: newStatus,
      timestamp: new Date().toISOString(),
    });
  };

  const handleHeadingToRoute = () => {
    Alert.alert("Confirm", "Mark this delivery as in-transit?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Yes, Heading Out",
        onPress: () => updateStatus("in_transit"),
      },
    ]);
  };

  const handleDelivered = () => {
    Alert.alert("Confirm Delivery", "Mark this delivery as completed?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Yes, Delivered",
        onPress: () => {
          updateStatus("delivered");
          Alert.alert("Done", "Delivery marked as complete.", [
            { text: "OK", onPress: () => router.back() },
          ]);
        },
      },
    ]);
  };

  if (!delivery) {
    return (
      <View style={styles.container}>
        <StatusBar sessionStatus="routes_released" />
        <View style={styles.centered}>
          <Text style={styles.errorText}>Delivery not found.</Text>
          <Pressable
            style={styles.backButton}
            onPress={() => router.back()}
            accessibilityRole="button"
          >
            <Text style={styles.backButtonText}>Go Back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const statusLabel =
    delivery.status === "delivered"
      ? "Delivered"
      : delivery.status === "in_transit"
      ? "In Transit"
      : "Pending";

  const statusColor =
    delivery.status === "delivered"
      ? "#1A6B3C"
      : delivery.status === "in_transit"
      ? "#E67E22"
      : "#777";

  return (
    <View style={styles.container}>
      <StatusBar sessionStatus="routes_released" />

      <View style={styles.airplaneBanner}>
        <Text style={styles.airplaneBannerText}>
          Reminder: Enable airplane mode before viewing delivery addresses to
          minimize location tracking.
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.sequenceBadge}>
          <Text style={styles.sequenceText}>#{delivery.sequence}</Text>
        </View>

        <Text style={styles.sectionLabel}>Address</Text>
        <View style={styles.card}>
          <Text style={styles.addressText}>{delivery.address}</Text>
        </View>

        {delivery.notes ? (
          <>
            <Text style={styles.sectionLabel}>Notes</Text>
            <View style={styles.card}>
              <Text style={styles.notesText}>{delivery.notes}</Text>
            </View>
          </>
        ) : null}

        <Text style={styles.sectionLabel}>Status</Text>
        <View style={[styles.statusPill, { backgroundColor: statusColor }]}>
          <Text style={styles.statusPillText}>{statusLabel}</Text>
        </View>

        <View style={styles.actions}>
          {delivery.status === "pending" && (
            <Pressable
              style={({ pressed }) => [
                styles.actionButton,
                styles.transitButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={handleHeadingToRoute}
              accessibilityRole="button"
              accessibilityLabel="Mark as heading to delivery"
            >
              <Text style={styles.actionButtonText}>Heading to Route</Text>
            </Pressable>
          )}

          {(delivery.status === "pending" || delivery.status === "in_transit") && (
            <Pressable
              style={({ pressed }) => [
                styles.actionButton,
                styles.deliveredButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={handleDelivered}
              accessibilityRole="button"
              accessibilityLabel="Mark as delivered"
            >
              <Text style={styles.actionButtonText}>Delivered</Text>
            </Pressable>
          )}

          {delivery.status === "delivered" && (
            <View style={styles.completedBanner}>
              <Text style={styles.completedText}>
                This delivery has been completed.
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F5F5F0",
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  errorText: {
    fontSize: 18,
    color: "#666",
    marginBottom: 16,
  },
  backButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: "#1A6B3C",
    borderRadius: 10,
  },
  backButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
  airplaneBanner: {
    backgroundColor: "#FFF3CD",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#FFE08A",
  },
  airplaneBannerText: {
    color: "#856404",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
    lineHeight: 20,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  sequenceBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#1A6B3C",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  sequenceText: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "800",
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: "#888",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 8,
    marginTop: 16,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E0E0E0",
  },
  addressText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    lineHeight: 26,
  },
  notesText: {
    fontSize: 16,
    color: "#555",
    lineHeight: 24,
  },
  statusPill: {
    alignSelf: "flex-start",
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 20,
  },
  statusPillText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  actions: {
    marginTop: 32,
    gap: 16,
  },
  actionButton: {
    borderRadius: 12,
    paddingVertical: 20,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 64,
  },
  transitButton: {
    backgroundColor: "#E67E22",
  },
  deliveredButton: {
    backgroundColor: "#1A6B3C",
  },
  buttonPressed: {
    opacity: 0.8,
  },
  actionButtonText: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "700",
  },
  completedBanner: {
    backgroundColor: "#D5F5E3",
    borderRadius: 10,
    padding: 20,
    alignItems: "center",
  },
  completedText: {
    color: "#1A6B3C",
    fontSize: 16,
    fontWeight: "600",
  },
});
