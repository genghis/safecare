import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import { getProfile, updateProfile, getZones } from "../lib/api";

const VEHICLE_SIZES: Record<
  string,
  { label: string; defaultMaxDeliveries: number }
> = {
  sedan: { label: "Sedan", defaultMaxDeliveries: 5 },
  suv: { label: "SUV", defaultMaxDeliveries: 8 },
  minivan: { label: "Minivan", defaultMaxDeliveries: 12 },
  truck: { label: "Pickup Truck", defaultMaxDeliveries: 15 },
  van: { label: "Cargo Van", defaultMaxDeliveries: 25 },
};

const DAYS_OF_WEEK = [
  { value: "mon", short: "Mon" },
  { value: "tue", short: "Tue" },
  { value: "wed", short: "Wed" },
  { value: "thu", short: "Thu" },
  { value: "fri", short: "Fri" },
  { value: "sat", short: "Sat" },
  { value: "sun", short: "Sun" },
] as const;

/** Generate time slots from 08:00 to 20:00 in 30-min increments. */
function generateTimeSlots(): string[] {
  const slots: string[] = [];
  for (let h = 8; h <= 20; h++) {
    slots.push(`${h}:00`);
    if (h < 20) slots.push(`${h}:30`);
  }
  return slots;
}

const TIME_SLOTS = generateTimeSlots();

type DayAvailability = {
  start: string;
  end: string;
};

type Zone = {
  id: string;
  name: string;
  color: string;
};

export default function ProfileScreen() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Vehicle state
  const [vehicleSize, setVehicleSize] = useState<string>("sedan");
  const [maxDeliveries, setMaxDeliveries] = useState(5);

  // Availability state
  const [selectedDays, setSelectedDays] = useState<Set<string>>(new Set());
  const [dayTimes, setDayTimes] = useState<Record<string, DayAvailability>>({});

  // Zones state
  const [zones, setZones] = useState<Zone[]>([]);
  const [selectedZones, setSelectedZones] = useState<Set<string>>(new Set());

  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const [profile, zonesData] = await Promise.all([
        getProfile(),
        getZones(),
      ]);

      setZones(zonesData.zones ?? []);

      if (profile) {
        if (profile.vehicleSize && VEHICLE_SIZES[profile.vehicleSize]) {
          setVehicleSize(profile.vehicleSize);
        }
        if (typeof profile.maxDeliveries === "number") {
          setMaxDeliveries(profile.maxDeliveries);
        }
        if (profile.availability) {
          const days = new Set<string>(Object.keys(profile.availability));
          setSelectedDays(days);
          setDayTimes(profile.availability);
        }
        if (Array.isArray(profile.selectedZones)) {
          setSelectedZones(new Set(profile.selectedZones));
        }
      }
    } catch (err) {
      Alert.alert("Error", "Could not load profile. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const handleSelectVehicle = (key: string) => {
    setVehicleSize(key);
    setMaxDeliveries(VEHICLE_SIZES[key].defaultMaxDeliveries);
  };

  const adjustMaxDeliveries = (delta: number) => {
    setMaxDeliveries((prev) => {
      const next = prev + delta;
      if (next < 1) return 1;
      const cap = VEHICLE_SIZES[vehicleSize].defaultMaxDeliveries;
      if (next > cap) return cap;
      return next;
    });
  };

  const toggleDay = (day: string) => {
    setSelectedDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) {
        next.delete(day);
      } else {
        next.add(day);
        if (!dayTimes[day]) {
          setDayTimes((t) => ({ ...t, [day]: { start: "9:00", end: "17:00" } }));
        }
      }
      return next;
    });
  };

  const setDayTime = (day: string, field: "start" | "end", value: string) => {
    setDayTimes((prev) => ({
      ...prev,
      [day]: { ...prev[day], [field]: value },
    }));
  };

  const toggleZone = (zoneId: string) => {
    setSelectedZones((prev) => {
      const next = new Set(prev);
      if (next.has(zoneId)) {
        next.delete(zoneId);
      } else {
        next.add(zoneId);
      }
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const availability: Record<string, DayAvailability> = {};
      selectedDays.forEach((day) => {
        availability[day] = dayTimes[day] ?? { start: "9:00", end: "17:00" };
      });

      await updateProfile({
        vehicleSize,
        maxDeliveries,
        availability,
        selectedZones: Array.from(selectedZones),
      });

      Alert.alert("Saved", "Your profile has been updated.");
    } catch (err) {
      Alert.alert("Error", "Could not save profile. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1A6B3C" />
        <Text style={styles.loadingText}>Loading profile...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
    >
      {/* ---- Vehicle Section ---- */}
      <Text style={styles.sectionTitle}>Vehicle</Text>
      <View style={styles.vehicleGrid}>
        {Object.entries(VEHICLE_SIZES).map(([key, v]) => {
          const isSelected = vehicleSize === key;
          return (
            <Pressable
              key={key}
              style={[
                styles.vehicleButton,
                isSelected && styles.vehicleButtonSelected,
              ]}
              onPress={() => handleSelectVehicle(key)}
              accessibilityRole="button"
              accessibilityLabel={`${v.label}, up to ${v.defaultMaxDeliveries} deliveries`}
              accessibilityState={{ selected: isSelected }}
            >
              <Text
                style={[
                  styles.vehicleLabel,
                  isSelected && styles.vehicleLabelSelected,
                ]}
              >
                {v.label}
              </Text>
              <Text
                style={[
                  styles.vehicleSub,
                  isSelected && styles.vehicleSubSelected,
                ]}
              >
                up to {v.defaultMaxDeliveries} deliveries
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.fieldLabel}>Max deliveries per shift</Text>
      <View style={styles.stepperRow}>
        <Pressable
          style={({ pressed }) => [
            styles.stepperButton,
            pressed && styles.stepperPressed,
          ]}
          onPress={() => adjustMaxDeliveries(-1)}
          accessibilityRole="button"
          accessibilityLabel="Decrease max deliveries"
        >
          <Text style={styles.stepperText}>-</Text>
        </Pressable>
        <Text style={styles.stepperValue}>{maxDeliveries}</Text>
        <Pressable
          style={({ pressed }) => [
            styles.stepperButton,
            pressed && styles.stepperPressed,
          ]}
          onPress={() => adjustMaxDeliveries(1)}
          accessibilityRole="button"
          accessibilityLabel="Increase max deliveries"
        >
          <Text style={styles.stepperText}>+</Text>
        </Pressable>
      </View>

      {/* ---- Availability Section ---- */}
      <Text style={styles.sectionTitle}>Availability</Text>
      <View style={styles.daysRow}>
        {DAYS_OF_WEEK.map((d) => {
          const isSelected = selectedDays.has(d.value);
          return (
            <Pressable
              key={d.value}
              style={[
                styles.dayButton,
                isSelected && styles.dayButtonSelected,
              ]}
              onPress={() => toggleDay(d.value)}
              accessibilityRole="button"
              accessibilityLabel={`${d.short}, ${isSelected ? "selected" : "not selected"}`}
              accessibilityState={{ selected: isSelected }}
            >
              <Text
                style={[
                  styles.dayText,
                  isSelected && styles.dayTextSelected,
                ]}
              >
                {d.short}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {DAYS_OF_WEEK.filter((d) => selectedDays.has(d.value)).map((d) => (
        <View key={d.value} style={styles.dayTimeRow}>
          <Text style={styles.dayTimeLabel}>{d.short}</Text>
          <View style={styles.timePickerGroup}>
            <Text style={styles.timeFieldLabel}>Start</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.timeScroll}
            >
              {TIME_SLOTS.map((t) => {
                const isActive = dayTimes[d.value]?.start === t;
                return (
                  <Pressable
                    key={t}
                    style={[
                      styles.timeChip,
                      isActive && styles.timeChipActive,
                    ]}
                    onPress={() => setDayTime(d.value, "start", t)}
                    accessibilityRole="button"
                    accessibilityLabel={`Start time ${t}`}
                  >
                    <Text
                      style={[
                        styles.timeChipText,
                        isActive && styles.timeChipTextActive,
                      ]}
                    >
                      {t}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
          <View style={styles.timePickerGroup}>
            <Text style={styles.timeFieldLabel}>End</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.timeScroll}
            >
              {TIME_SLOTS.map((t) => {
                const isActive = dayTimes[d.value]?.end === t;
                return (
                  <Pressable
                    key={t}
                    style={[
                      styles.timeChip,
                      isActive && styles.timeChipActive,
                    ]}
                    onPress={() => setDayTime(d.value, "end", t)}
                    accessibilityRole="button"
                    accessibilityLabel={`End time ${t}`}
                  >
                    <Text
                      style={[
                        styles.timeChipText,
                        isActive && styles.timeChipTextActive,
                      ]}
                    >
                      {t}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      ))}

      {/* ---- Delivery Zones Section ---- */}
      <Text style={styles.sectionTitle}>Areas I Can Deliver To</Text>
      {zones.length === 0 ? (
        <Text style={styles.emptyText}>No delivery zones available.</Text>
      ) : (
        <View style={styles.zonesGrid}>
          {zones.map((zone) => {
            const isSelected = selectedZones.has(zone.id);
            return (
              <Pressable
                key={zone.id}
                style={[
                  styles.zoneChip,
                  {
                    backgroundColor: isSelected ? zone.color : "#F0F0F0",
                    borderColor: zone.color,
                  },
                ]}
                onPress={() => toggleZone(zone.id)}
                accessibilityRole="button"
                accessibilityLabel={`Zone ${zone.name}, ${isSelected ? "selected" : "not selected"}`}
                accessibilityState={{ selected: isSelected }}
              >
                {isSelected && (
                  <Text style={styles.zoneCheck}>&#10003; </Text>
                )}
                <Text
                  style={[
                    styles.zoneText,
                    { color: isSelected ? "#FFFFFF" : "#333" },
                  ]}
                >
                  {zone.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {/* ---- Save Button ---- */}
      <Pressable
        style={({ pressed }) => [
          styles.saveButton,
          pressed && styles.saveButtonPressed,
          saving && styles.saveButtonDisabled,
        ]}
        onPress={handleSave}
        disabled={saving}
        accessibilityRole="button"
        accessibilityLabel="Save profile"
      >
        {saving ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.saveButtonText}>Save Profile</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F5F5F0",
  },
  contentContainer: {
    padding: 20,
    paddingBottom: 48,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: "#F5F5F0",
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: "#555",
  },

  // Sections
  sectionTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#333",
    marginTop: 24,
    marginBottom: 12,
  },
  fieldLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    marginTop: 16,
    marginBottom: 8,
  },

  // Vehicle grid
  vehicleGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  vehicleButton: {
    backgroundColor: "#FFFFFF",
    borderWidth: 2,
    borderColor: "#D0D0D0",
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 12,
    minHeight: 72,
    minWidth: "45%",
    flexGrow: 1,
    flexBasis: "45%",
    justifyContent: "center",
    alignItems: "center",
  },
  vehicleButtonSelected: {
    backgroundColor: "#1A6B3C",
    borderColor: "#1A6B3C",
  },
  vehicleLabel: {
    fontSize: 16,
    fontWeight: "700",
    color: "#333",
  },
  vehicleLabelSelected: {
    color: "#FFFFFF",
  },
  vehicleSub: {
    fontSize: 13,
    color: "#777",
    marginTop: 2,
  },
  vehicleSubSelected: {
    color: "#D4EDDA",
  },

  // Stepper
  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 16,
  },
  stepperButton: {
    width: 52,
    height: 52,
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
    borderWidth: 2,
    borderColor: "#1A6B3C",
    justifyContent: "center",
    alignItems: "center",
  },
  stepperPressed: {
    backgroundColor: "#E8F5E9",
  },
  stepperText: {
    fontSize: 24,
    fontWeight: "700",
    color: "#1A6B3C",
  },
  stepperValue: {
    fontSize: 28,
    fontWeight: "800",
    color: "#333",
    minWidth: 40,
    textAlign: "center",
  },

  // Days row
  daysRow: {
    flexDirection: "row",
    gap: 6,
  },
  dayButton: {
    flex: 1,
    minHeight: 48,
    backgroundColor: "#D0D0D0",
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 10,
  },
  dayButtonSelected: {
    backgroundColor: "#1A6B3C",
  },
  dayText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#555",
  },
  dayTextSelected: {
    color: "#FFFFFF",
  },

  // Day time rows
  dayTimeRow: {
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    padding: 12,
    marginTop: 10,
  },
  dayTimeLabel: {
    fontSize: 15,
    fontWeight: "700",
    color: "#333",
    marginBottom: 6,
  },
  timePickerGroup: {
    marginBottom: 6,
  },
  timeFieldLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#777",
    marginBottom: 4,
  },
  timeScroll: {
    flexGrow: 0,
  },
  timeChip: {
    minWidth: 56,
    minHeight: 36,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "#F0F0F0",
    borderRadius: 6,
    marginRight: 6,
    justifyContent: "center",
    alignItems: "center",
  },
  timeChipActive: {
    backgroundColor: "#1A6B3C",
  },
  timeChipText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#555",
  },
  timeChipTextActive: {
    color: "#FFFFFF",
  },

  // Zones
  zonesGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  zoneChip: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 2,
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 16,
    minHeight: 48,
  },
  zoneCheck: {
    fontSize: 14,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  zoneText: {
    fontSize: 15,
    fontWeight: "600",
  },
  emptyText: {
    fontSize: 15,
    color: "#777",
    fontStyle: "italic",
  },

  // Save
  saveButton: {
    backgroundColor: "#1A6B3C",
    borderRadius: 12,
    paddingVertical: 20,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 32,
    minHeight: 64,
  },
  saveButtonPressed: {
    backgroundColor: "#145530",
  },
  saveButtonDisabled: {
    opacity: 0.7,
  },
  saveButtonText: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "700",
  },
});
