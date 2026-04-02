import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { requestOtp, verifyOtp, setToken } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import InstallPrompt from "@/components/InstallPrompt";

type Stage = "phone" | "otp";

export default function Login() {
  const { t } = useLocale();
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
      setError(t('driver.login.errorPhone'));
      return;
    }
    setLoading(true);
    try {
      const result = await requestOtp(phone);
      // In explicit test mode, the OTP can be echoed for automated suites.
      if ((result as any)?.otp) {
        setDevOtp((result as any).otp);
      }
      setStage("otp");
    } catch {
      setError(t('driver.login.errorOtpRequest'));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    setError("");
    if (otpCode.length < 6) {
      setError(t('driver.login.errorOtp'));
      return;
    }
    setLoading(true);
    try {
      const result = await verifyOtp(phone, otpCode);
      setToken(result.token);
      // JWT stays in memory only until route download provides the encryption key,
      // at which point it's persisted to encrypted IndexedDB.
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(t('driver.login.errorOtpInvalid'));
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
          {t('driver.login.appName')}
        </h1>
        <p
          style={{
            fontSize: 16,
            color: "var(--color-text-secondary)",
            marginTop: 4,
          }}
        >
          {t('driver.login.subtitle')}
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
            {t('driver.login.phoneLabel')}
          </label>
          <input
            id="phone"
            data-testid="driver-phone-input"
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
            data-testid="driver-request-otp"
          >
            {loading ? <span className="spinner" /> : t('driver.login.sendCode')}
          </button>
        </>
      ) : (
        <>
          <label className="label" htmlFor="otp">
            {t('driver.login.otpLabel')}
          </label>
          <p className="hint">{t('driver.login.otpHint', { phone })}</p>

          {/* Show OTP only when the backend is explicitly in test-echo mode */}
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
              {t('driver.login.devOtp')} <strong>{devOtp}</strong>
            </div>
          )}

          <input
            id="otp"
            data-testid="driver-otp-input"
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
            data-testid="driver-verify-otp"
          >
            {loading ? <span className="spinner" /> : t('driver.login.verify')}
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
            {t('driver.login.back')}
          </button>
        </>
      )}

      <InstallPrompt />
    </div>
  );
}
