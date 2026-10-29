import { useEffect, useState, type FormEvent } from "react";
import QRCode from "qrcode";
import { post } from "../api";
import type { User } from "../types";
import { Brand, ErrorNotice, Icon } from "../components/ui";

export function Auth({
  setup,
  activation,
  onLogin,
}: {
  setup: boolean;
  activation?: string;
  onLogin: (u: User) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [stage, setStage] = useState<
    "password" | "enroll" | "mfa" | "recovery"
  >("password");
  const [secret, setSecret] = useState("");
  const [qr, setQr] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [verified, setVerified] = useState<User | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setStage("password");
    setPassword("");
    setToken("");
    setSecret("");
    setQr("");
  }, [activation]);
  async function credentials(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await post<{ enrollment_required: boolean }>(
        activation ? "/auth/activate" : setup ? "/auth/setup" : "/auth/login",
        activation ? { token: activation, password } : { email, password },
      );
      setPassword("");
      if (result.enrollment_required) {
        const enrollment = await post<{ secret: string; uri: string }>(
          "/auth/enroll",
        );
        setSecret(enrollment.secret);
        setQr(
          await QRCode.toDataURL(enrollment.uri, { margin: 1, width: 180 }),
        );
        setStage("enroll");
      } else setStage("mfa");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await post<{ user: User; recovery_codes: string[] }>(
        "/auth/verify",
        { token },
      );
      setSecret("");
      setQr("");
      setToken("");
      if (result.recovery_codes.length) {
        setCodes(result.recovery_codes);
        setVerified(result.user);
        setStage("recovery");
      } else onLogin(result.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-layout">
      <div className="auth-story">
        <Brand />
        <div>
          <div className="eyebrow">CONFIDENTIAL CONVERSATIONS, SIMPLIFIED</div>
          <h1>
            A safer place for
            <br />
            important information.
          </h1>
          <p>
            Request documents. Exchange messages. Keep access in the right
            hands.
          </p>
          <div className="story-features">
            <span>
              <Icon name="shield" />
              Permission-controlled conversations
            </span>
            <span>
              <Icon name="users" />
              No recipient account required
            </span>
            <span>
              <Icon name="clock" />
              Clear access and activity history
            </span>
          </div>
        </div>
        <small>OneSmarter Secure Mail · Staff workspace</small>
      </div>
      <main className="auth-main">
        <div className="auth-card">
          <span className="icon-tile">
            <Icon name="lock" size={26} />
          </span>
          <h1>
            {stage === "password"
              ? activation
                ? "Activate your access"
                : setup
                  ? "Set up your workspace"
                  : "Welcome back"
              : stage === "enroll"
                ? "Protect your account"
                : stage === "recovery"
                  ? "Save your recovery codes"
                  : "Verify it’s you"}
          </h1>
          <p>
            {stage === "password"
              ? activation
                ? "Set a strong password. Your next step is MFA verification."
                : setup
                  ? "Create the first workspace administrator account."
                  : "Staff and administrators: sign in with your @onesmarter.com account."
              : stage === "enroll"
                ? "Scan this QR code with your authenticator app, then enter its six-digit code."
                : stage === "recovery"
                  ? "These single-use codes are shown once. Store them in your password manager."
                  : "Use a fresh authenticator code, or a saved recovery code."}
          </p>
          <ErrorNotice message={error} />
          {stage === "password" && (
            <form onSubmit={credentials} className="stack">
              {!activation && (
                <label>
                  Company email
                  <input
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@onesmarter.com"
                    required
                  />
                </label>
              )}
              <label>
                Password
                <input
                  type="password"
                  autoComplete={
                    setup || activation ? "new-password" : "current-password"
                  }
                  minLength={setup || activation ? 12 : undefined}
                  maxLength={256}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </label>
              <button className="primary full" disabled={busy}>
                {busy
                  ? "Please wait…"
                  : setup
                    ? "Create administrator account"
                    : activation
                      ? "Continue to verification"
                      : "Sign in"}
                <Icon name="arrow" size={18} />
              </button>
              <small>
                Staff accounts are created by your administrator. Contact them
                for password recovery.
              </small>
            </form>
          )}
          {(stage === "enroll" || stage === "mfa") && (
            <form onSubmit={verify} className="stack">
              {stage === "enroll" && (
                <>
                  <img
                    className="qr"
                    src={qr}
                    alt="Authenticator enrollment QR code"
                  />
                  <details>
                    <summary>Enter the key manually</summary>
                    <code className="secret">{secret}</code>
                  </details>
                </>
              )}
              <label>
                Authenticator or recovery code
                <input
                  autoFocus
                  autoComplete="one-time-code"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  required
                />
              </label>
              <button className="primary full" disabled={busy}>
                Verify and continue
                <Icon name="arrow" size={18} />
              </button>
            </form>
          )}
          {stage === "recovery" && (
            <div className="stack">
              <div className="recovery-codes">
                {codes.map((code) => (
                  <code key={code}>{code}</code>
                ))}
              </div>
              <button
                className="primary full"
                onClick={() => {
                  setCodes([]);
                  if (verified) onLogin(verified);
                }}
              >
                I saved my recovery codes
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
