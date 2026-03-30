import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { requestOtp, verifyOtp, setToken, persistToken } from "@/lib/api";
import InstallPrompt from "@/components/InstallPrompt";

type Stage = "phone" | "otp";

export default function Login() {
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>("phone");
  const [phone, setPhone] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [devOtp, setDevOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleRequestOtp = async () => {
    setError("");
    if (phone.length < 10) {
      setError("Enter a valid phone number.");
      return;
    }
    setLoading(true);
    try {
      const result = await requestOtp(phone);
      // In dev/test mode, the OTP is returned in the response
      if ((result as any)?.otp) {
        setDevOtp((result as any).otp);
      }
      setStage("otp");
    } catch {
      setError("Could not request OTP. Is this phone number registered as a driver?");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    setError("");
    if (otpCode.length < 6) {
      setError("Enter the 6-digit code.");
      return;
    }
    setLoading(true);
    try {
      const result = await verifyOtp(phone, otpCode);
      setToken(result.token);
      try { await persistToken(result.token); } catch { /* crypto not ready, token in memory only */ }
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError("Invalid or expired code. Please try again.");
      console.error("Login failed:", err);
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
            placeholder="6505551011"
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => handleKeyDown(e, handleRequestOtp)}
          />

          <button
            className="btn btn-primary btn-block"
            style={{ marginTop: 28, minHeight: 56, fontSize: 18 }}
            onClick={handleRequestOtp}
            disabled={loading || phone.length < 10}
          >
            {loading ? <span className="spinner" /> : "Send Verification Code"}
          </button>
        </>
      ) : (
        <>
          <label className="label" htmlFor="otp">
            Enter Verification Code
          </label>
          <p className="hint">A 6-digit code was sent to {phone}</p>

          {/* Show OTP in dev mode */}
          {devOtp && (
            <div
              style={{
                backgroundColor: "#f0fdf4",
                border: "1px solid #86efac",
                color: "#166534",
                padding: "12px 16px",
                borderRadius: "var(--radius-md)",
                fontSize: 14,
                marginBottom: 16,
                textAlign: "center",
              }}
            >
              Dev mode — your code is: <strong>{devOtp}</strong>
            </div>
          )}

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
            disabled={loading || otpCode.length < 6}
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
              setDevOtp("");
              setError("");
            }}
          >
            Back
          </button>
        </>
      )}

      <InstallPrompt />
    </div>
  );
}
