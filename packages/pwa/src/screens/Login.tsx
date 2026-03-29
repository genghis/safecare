import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { requestOtp, verifyOtp, setToken, persistToken } from "@/lib/api";
import InstallPrompt from "@/components/InstallPrompt";

type Stage = "phone" | "otp";

export default function Login() {
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>("phone");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleRequestOtp = async () => {
    setError("");
    if (phone.length < 10 || pin.length < 4) {
      setError("Enter a valid phone number and 4-digit PIN.");
      return;
    }
    setLoading(true);
    try {
      await requestOtp(phone);
      setStage("otp");
    } catch {
      setError("Could not request OTP. Check your phone number and PIN.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    setError("");
    if (otpCode.length < 6) {
      setError("Enter the 6-digit code sent to your phone.");
      return;
    }
    setLoading(true);
    try {
      const { token } = await verifyOtp(phone, otpCode);
      setToken(token);
      await persistToken(token);
      navigate("/dashboard", { replace: true });
    } catch {
      setError("Invalid or expired code. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, action: () => void) => {
    if (e.key === "Enter") action();
  };

  return (
    <div
      className="screen"
      style={{
        justifyContent: "center",
        padding: "0 24px",
        overflow: "auto",
      }}
    >
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <h1
          style={{
            fontSize: 36,
            fontWeight: 800,
            color: "var(--color-primary)",
            margin: 0,
          }}
        >
          SafeCare
        </h1>
        <p
          style={{
            fontSize: 16,
            color: "var(--color-text-secondary)",
            marginTop: 4,
          }}
        >
          Driver Delivery App
        </p>
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            backgroundColor: "var(--color-danger-light)",
            color: "var(--color-danger)",
            padding: "12px 16px",
            borderRadius: "var(--radius-md)",
            fontSize: 14,
            fontWeight: 600,
            marginBottom: 16,
            textAlign: "center",
          }}
        >
          {error}
        </div>
      )}

      {/* Phone stage */}
      {stage === "phone" ? (
        <>
          <label className="label" htmlFor="phone">
            Phone Number
          </label>
          <input
            id="phone"
            className="input"
            type="tel"
            autoComplete="tel"
            placeholder="(555) 123-4567"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, handleRequestOtp)}
          />

          <label className="label" htmlFor="pin" style={{ marginTop: 16 }}>
            PIN
          </label>
          <input
            id="pin"
            className="input"
            type="password"
            inputMode="numeric"
            maxLength={4}
            placeholder="4-digit PIN"
            autoComplete="off"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, handleRequestOtp)}
          />

          <button
            className="btn btn-primary btn-block"
            style={{ marginTop: 28, minHeight: 56, fontSize: 18 }}
            onClick={handleRequestOtp}
            disabled={loading}
          >
            {loading ? <span className="spinner" /> : "Request OTP"}
          </button>
        </>
      ) : (
        <>
          <label className="label" htmlFor="otp">
            Enter Verification Code
          </label>
          <p className="hint">A 6-digit code was sent to {phone}</p>
          <input
            id="otp"
            className="input"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="123456"
            value={otpCode}
            onChange={(e) =>
              setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
            onKeyDown={(e) => handleKeyDown(e, handleVerifyOtp)}
            style={{ fontSize: 24, letterSpacing: 8, textAlign: "center" }}
          />

          <button
            className="btn btn-primary btn-block"
            style={{ marginTop: 28, minHeight: 56, fontSize: 18 }}
            onClick={handleVerifyOtp}
            disabled={loading}
          >
            {loading ? <span className="spinner" /> : "Verify & Sign In"}
          </button>

          <button
            style={{
              display: "block",
              margin: "20px auto 0",
              padding: "12px 16px",
              color: "var(--color-primary)",
              fontSize: 16,
              fontWeight: 600,
              background: "none",
              border: "none",
              cursor: "pointer",
            }}
            onClick={() => {
              setStage("phone");
              setOtpCode("");
              setError("");
            }}
          >
            Back to phone entry
          </button>
        </>
      )}

      <InstallPrompt />
    </div>
  );
}
