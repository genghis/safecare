import { Pressable, View, Text, StyleSheet } from "react-native";

type DeliveryStatus = "pending" | "in_transit" | "delivered";

type Props = {
  delivery: {
    id: string;
    sequence: number;
    address: string;
    notes: string;
    status: DeliveryStatus;
  };
  onPress: () => void;
};

const STATUS_CONFIG: Record<
  DeliveryStatus,
  { label: string; bg: string; fg: string }
> = {
  pending: { label: "Pending", bg: "#E0E0E0", fg: "#555" },
  in_transit: { label: "In Transit", bg: "#FDEBD0", fg: "#A04000" },
  delivered: { label: "Delivered", bg: "#D5F5E3", fg: "#1A6B3C" },
};

export function DeliveryCard({ delivery, onPress }: Props) {
  const status = STATUS_CONFIG[delivery.status];

  // Show first line of address as a snippet
  const addressSnippet =
    delivery.address.length > 60
      ? delivery.address.slice(0, 57) + "..."
      : delivery.address;

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Delivery number ${delivery.sequence}, ${addressSnippet}, ${status.label}`}
    >
      <View style={styles.row}>
        <View style={styles.sequenceBadge}>
          <Text style={styles.sequenceText}>{delivery.sequence}</Text>
        </View>

        <View style={styles.info}>
          <Text style={styles.address} numberOfLines={2}>
            {addressSnippet}
          </Text>
          {delivery.notes ? (
            <Text style={styles.notes} numberOfLines={1}>
              {delivery.notes}
            </Text>
          ) : null}
        </View>

        <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
          <Text style={[styles.statusText, { color: status.fg }]}>
            {status.label}
          </Text>
        </View>
      </View>

      <View style={styles.tapHint}>
        <Text style={styles.tapHintText}>Tap to view details</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#E0E0E0",
    // Ensure large tap target
    minHeight: 80,
  },
  cardPressed: {
    backgroundColor: "#F0F0F0",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  sequenceBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#1A6B3C",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  sequenceText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "800",
  },
  info: {
    flex: 1,
    marginRight: 10,
  },
  address: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    lineHeight: 22,
  },
  notes: {
    fontSize: 13,
    color: "#777",
    marginTop: 4,
  },
  statusBadge: {
    borderRadius: 12,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: "700",
  },
  tapHint: {
    marginTop: 8,
    alignItems: "flex-end",
  },
  tapHintText: {
    fontSize: 12,
    color: "#AAA",
  },
});
