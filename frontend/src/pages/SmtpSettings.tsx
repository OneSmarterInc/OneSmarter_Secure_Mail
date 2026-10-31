import { useState } from "react";
import { ApiError, post, useResource } from "../api";
import { ErrorNotice, Icon, Loading, StepUp } from "../components/ui";

interface SMTPState {
  can_manage: boolean;
  organization: {
    host: string;
    sender_name: string;
    otp_sender: string;
    otp_configured: boolean;
    port: number;
    security: "starttls" | "tls";
    enabled: boolean;
  } | null;
  personal: { email: string; password_set: boolean; needs_password: boolean };
  approved_senders: string[];
}

export function SmtpSettings({ onChanged }: { onChanged: () => void }) {
  const resource = useResource<SMTPState>("/settings/smtp");
  if (resource.loading) return <Loading />;
  if (resource.error) return <ErrorNotice message={resource.error} />;
  return resource.data ? (
    <SMTPForms initial={resource.data} onChanged={onChanged} />
  ) : null;
}

function SMTPForms({
  initial,
  onChanged,
}: {
  initial: SMTPState;
  onChanged: () => void;
}) {
  const [data, setData] = useState(initial);
  const [senderName, setSenderName] = useState(
    initial.organization?.sender_name ?? "OneSmarter Support",
  );
  const [host, setHost] = useState(initial.organization?.host ?? "");
  const [security, setSecurity] = useState<"starttls" | "tls">(
    initial.organization?.security ?? "starttls",
  );
  const [enabled, setEnabled] = useState(initial.organization?.enabled ?? true);
  const [email, setEmail] = useState(
    initial.personal.email || initial.approved_senders[0] || "",
  );
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<
    "organization" | "personal" | "check" | null
  >(null);
  async function submit(action: "organization" | "personal" | "check") {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (action === "check") {
        const result = await post<{ message: string }>("/settings/smtp/check");
        setMessage(result.message);
      } else {
        const body =
          action === "organization"
            ? {
                host,
                sender_name: senderName,
                security,
                port: security === "tls" ? 465 : 587,
                enabled,
              }
            : { email, password };
        setData(await post<SMTPState>(`/settings/smtp/${action}`, body));
        if (action === "personal") setPassword("");
        onChanged();
        setMessage(
          action === "personal"
            ? "Your sender credentials were saved securely."
            : "Organisation SMTP settings saved.",
        );
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === "step_up_required")
        setPending(action);
      else setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (pending)
    return (
      <section className="card">
        <StepUp
          onDone={() => {
            const action = pending;
            setPending(null);
            void submit(action);
          }}
        />
      </section>
    );
  return (
    <section
      aria-label="SMTP setup"
      className={`compact-smtp${data.can_manage ? "" : " staff-smtp"}`}
    >
      <h2>SMTP setup</h2>
      <p className="muted">
        {data.can_manage
          ? "Manage the organisation mail server and your own sender credentials."
          : "Set your sender credentials using the mail server provided by your organisation."}{" "}
        Replies stay in the portal.
      </p>
      <details className="settings-help">
        <summary>How verification emails are sent</summary>
        <p className="muted">
          OTP emails use your SMTP username and password with
          support@onesmarter.com as the sender. Your mail provider must permit
          sending as this address. Message notifications use your own sender
          address.
        </p>
      </details>
      <ErrorNotice message={error} />
      {message && (
        <p className="notice success" role="status">
          {message}
        </p>
      )}
      <div className="settings-grid">
        <section className="card smtp-server-card">
          <h3>Organisation mail server</h3>
          {data.can_manage ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit("organization");
              }}
            >
              <label>
                Sender name
                <input
                  required
                  maxLength={160}
                  value={senderName}
                  onChange={(e) => setSenderName(e.target.value)}
                />
              </label>
              <label>
                SMTP hostname
                <input
                  required
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="smtp.your-organisation.com"
                  autoComplete="off"
                />
              </label>
              <label>
                Connection security
                <select
                  value={security}
                  onChange={(e) =>
                    setSecurity(e.target.value as "starttls" | "tls")
                  }
                >
                  <option value="starttls">STARTTLS — port 587</option>
                  <option value="tls">TLS — port 465</option>
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                />{" "}
                Enable organisation email delivery
              </label>
              <p className="muted">
                Applies to all staff. Passwords are set privately by each staff
                member.
              </p>
              <button className="button primary" disabled={busy}>
                Save organisation settings
              </button>
            </form>
          ) : (
            <p>
              {data.organization
                ? `${data.organization.host} · ${data.organization.security.toUpperCase()} · port ${data.organization.port}`
                : "Your administrator has not configured the mail server yet."}
            </p>
          )}
        </section>
        <section className="card smtp-personal-card">
          <h3>My sender credentials</h3>
          {data.personal.password_set && data.personal.needs_password && (
            <p className="notice warning">
              The organisation server changed. Confirm its hostname above, then
              enter your password again before sending.
            </p>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit("personal");
            }}
          >
            <label>
              SMTP username (email)
              <select
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              >
                <option value="" disabled>
                  Choose your approved address
                </option>
                {data.approved_senders.map((address) => (
                  <option key={address} value={address}>
                    {address}
                  </option>
                ))}
              </select>
            </label>
            <label>
              SMTP password
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required={
                  !data.personal.password_set ||
                  data.personal.needs_password ||
                  email !== data.personal.email
                }
                maxLength={4096}
              />
            </label>
            <p className="muted">
              {data.personal.password_set
                ? "A password is saved. Leave blank to keep it, or enter a replacement."
                : "Use your mailbox password or provider-issued SMTP app password."}{" "}
              Your password is encrypted and is never displayed again.
            </p>
            <div className="smtp-actions">
              <button
                className="button primary"
                disabled={busy || !email || !data.organization}
              >
                Save my sender
              </button>{" "}
              <button
                className="button"
                type="button"
                onClick={() => void submit("check")}
                disabled={
                  busy ||
                  !data.personal.password_set ||
                  data.personal.needs_password ||
                  !data.organization?.enabled
                }
              >
                Check SMTP login
              </button>
            </div>
            <p className="muted">
              From and Reply-To: {email || "your SMTP username"}
            </p>
            <p className="muted">
              The login check does not send an email. Secure-message
              notifications use your address; OTPs use support@onesmarter.com.
            </p>
          </form>
          <p className="credential-note">
            <Icon name="lock" size={16} />
            <span>
              Passwords are encrypted. Their keys are protected by the key
              service. Sending pauses while the service is sealed.
            </span>
          </p>
        </section>
      </div>
    </section>
  );
}
