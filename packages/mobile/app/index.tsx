import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { router } from "expo-router";
import { saveToken } from "../lib/storage";
import { requestOtp, verifyOtp } from "../lib/api";

type Stage = "phone" | "otp";

export default function LoginScreen() {
  const [stage, setStage] = useState<Stage>("phone");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [loading, setLoading] = useState(false);

  const handleRequestOtp = async () => {
    if (phone.length < 10 || pin.length < 4) {
      Alert.alert("Invalid Input", "Enter a valid phone number and 4-digit PIN.");
      return;
    }
    setLoading(true);
    try {
      await requestOtp(phone, pin);
      setStage("otp");
    } catch (err) {
      Alert.alert("Error", "Could not request OTP. Check your phone number and PIN.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (otpCode.length < 6) {
      Alert.alert("Invalid Code", "Enter the 6-digit code sent to your phone.");
      return;
    }
    setLoading(true);
    try {
      const { token } = await verifyOtp(phone, otpCode);
      await saveToken(token);
      router.replace("/dashboard");
    } catch (err) {
      Alert.alert("Error", "Invalid or expired code. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={styles.header}>
        <Text style={styles.title}>SafeCare</Text>
        <Text style={styles.subtitle}>Driver Delivery App</Text>
      </View>

      <View style={styles.form}>
        {stage === "phone" ? (
          <>
            <Text style={styles.label}>Phone Number</Text>
            <TextInput
              style={styles.input}
              placeholder="(555) 123-4567"
              placeholderTextColor="#999"
              keyboardType="phone-pad"
              autoComplete="tel"
              value={phone}
              onChangeText={setPhone}
              accessibilityLabel="Phone number"
            />

            <Text style={styles.label}>PIN</Text>
            <TextInput
              style={styles.input}
              placeholder="4-digit PIN"
              placeholderTextColor="#999"
              keyboardType="number-pad"
              secureTextEntry
              maxLength={4}
              value={pin}
              onChangeText={setPin}
              accessibilityLabel="4-digit PIN"
            />

            <Pressable
              style={({ pressed }) => [
                styles.button,
                pressed && styles.buttonPressed,
                loading && styles.buttonDisabled,
              ]}
              onPress={handleRequestOtp}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel="Request one-time passcode"
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.buttonText}>Request OTP</Text>
              )}
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.label}>Enter Verification Code</Text>
            <Text style={styles.hint}>
              A 6-digit code was sent to {phone}
            </Text>
            <TextInput
              style={styles.input}
              placeholder="123456"
              placeholderTextColor="#999"
              keyboardType="number-pad"
              maxLength={6}
              value={otpCode}
              onChangeText={setOtpCode}
              accessibilityLabel="6-digit verification code"
            />

            <Pressable
              style={({ pressed }) => [
                styles.button,
                pressed && styles.buttonPressed,
                loading && styles.buttonDisabled,
              ]}
              onPress={handleVerifyOtp}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel="Verify code and sign in"
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.buttonText}>Verify & Sign In</Text>
              )}
            </Pressable>

            <Pressable
              style={styles.linkButton}
              onPress={() => {
                setStage("phone");
                setOtpCode("");
              }}
              accessibilityRole="button"
            >
              <Text style={styles.linkText}>Back to phone entry</Text>
            </Pressable>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F5F5F0",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  header: {
    alignItems: "center",
    marginBottom: 48,
  },
  title: {
    fontSize: 36,
    fontWeight: "800",
    color: "#1A6B3C",
  },
  subtitle: {
    fontSize: 16,
    color: "#555",
    marginTop: 4,
  },
  form: {
    width: "100%",
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    marginBottom: 6,
    marginTop: 16,
  },
  hint: {
    fontSize: 14,
    color: "#666",
    marginBottom: 8,
  },
  input: {
    backgroundColor: "#FFFFFF",
    borderWidth: 2,
    borderColor: "#D0D0D0",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 18,
    color: "#333",
  },
  button: {
    backgroundColor: "#1A6B3C",
    borderRadius: 10,
    paddingVertical: 18,
    alignItems: "center",
    marginTop: 28,
    minHeight: 56,
    justifyContent: "center",
  },
  buttonPressed: {
    backgroundColor: "#145530",
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
  },
  linkButton: {
    alignItems: "center",
    marginTop: 20,
    paddingVertical: 12,
  },
  linkText: {
    color: "#1A6B3C",
    fontSize: 16,
    fontWeight: "600",
  },
});
