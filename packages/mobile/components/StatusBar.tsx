import { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { isOnline, pendingCount } from "../lib/sync";

type Props = {
  sessionStatus: string;
};

const SESSION_LABELS: Record<string, string> = {
  idle: "Not checked in",
  checked_in: "Checked in - awaiting routes",
  routes_released: "Routes active",
  shift_ended: "Shift ended",
};

/**
 * Top status bar showing connection state and session info.
 * Polls connectivity every 10 seconds to keep the indicator current.
 */
export function StatusBar({ sessionStatus }: Props) {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    // Check immediately
    isOnline().then(setOnline).catch(() => setOnline(true));

    // Poll periodically
    const handle = setInterval(() => {
      isOnline().then(setOnline).catch(() => setOnline(true));
    }, 10_000);

    return () => clearInterval(handle);
  }, []);

  const queueCount = pendingCount();
  const sessionLabel = SESSION_LABELS[sessionStatus] ?? sessionStatus;

  return (
    <View style={[styles.bar, !online && styles.barOffline]}>
      <View style={styles.row}>
        <View
          style={[
            styles.dot,
            { backgroundColor: online ? "#2ECC71" : "#E74C3C" },
          ]}
        />
        <Text style={styles.connectionText}>
          {online ? "Online" : "Offline"}
        </Text>

        {!online && (
          <Text style={styles.airplaneHint}>
            {" "}-- airplane mode may be active
          </Text>
        )}
      </View>

      <View style={styles.row}>
        <Text style={styles.sessionText}>{sessionLabel}</Text>
        {queueCount > 0 && (
          <View style={styles.queueBadge}>
            <Text style={styles.queueText}>
              {queueCount} pending sync{queueCount !== 1 ? "s" : ""}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: "#FFFFFF",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#E0E0E0",
  },
  barOffline: {
    backgroundColor: "#FFF8F0",
    borderBottomColor: "#F5C6A0",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 2,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  connectionText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#333",
  },
  airplaneHint: {
    fontSize: 12,
    color: "#E67E22",
    fontWeight: "600",
  },
  sessionText: {
    fontSize: 13,
    color: "#666",
    fontWeight: "500",
  },
  queueBadge: {
    marginLeft: 10,
    backgroundColor: "#FEF3E2",
    borderRadius: 8,
    paddingVertical: 2,
    paddingHorizontal: 8,
  },
  queueText: {
    fontSize: 11,
    color: "#A04000",
    fontWeight: "600",
  },
});
