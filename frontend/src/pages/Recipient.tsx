import { useEffect, useState, type FormEvent } from "react";
import { api, post } from "../api";
import type { Conversation } from "../types";
import { Brand, ErrorNotice, Icon, Loading } from "../components/ui";
import { ReplyForm, ThreadContent } from "./Mail";

export function Recipient({ token }: { token: string }) {
  const [landing, setLanding] = useState<{
    organization: string;
    recipient: string;
  } | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [stage, setStage] = useState("landing");
  const [code, setCode] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    setConversation(null);
    setError("");
    setStage("landing");
    post<{ organization: string; recipient: string }>("/recipient/landing", {
      token,
    })
      .then((data) => {
        if (live) setLanding(data);
      })
      .catch((err: unknown) => {
        if (live) {
          setError((err as Error).message);
          setStage("unavailable");
        }
      });
    return () => {
      live = false;
    };
  }, [token]);
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((v) => v - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  useEffect(() => {
    if (stage !== "read") return;
    const expire = () => {
      setConversation(null);
      setStage("code");
      setError(
        "Your access ended. Verify again if the invitation is still active.",
      );
    };
    window.addEventListener("session-expired", expire);
    const timer = setInterval(() => {
      void api<Conversation>("/recipient/conversation")
        .then(setConversation)
        .catch(() => {
          setConversation(null);
          setStage("unavailable");
        });
    }, 60000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("session-expired", expire);
    };
  }, [stage]);
  async function requestCode() {
    setBusy(true);
    setError("");
    try {
      await post("/recipient/code", { token });
      setStage("code");
      setCooldown(30);
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
      await post("/recipient/verify", { token, code });
      setCode("");
      setConversation(await api<Conversation>("/recipient/conversation"));
      setStage("read");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    try {
      setConversation(await api<Conversation>("/recipient/conversation"));
    } catch (err) {
      setConversation(null);
      setStage("unavailable");
      setError((err as Error).message);
    }
  }
  async function lock() {
    try {
      await post("/recipient/logout");
    } finally {
      setConversation(null);
      setStage("landing");
    }
  }
  return (
    <div className="recipient-layout">
      <header className="recipient-header">
        <Brand />
        <span className="muted">
          <Icon name="lock" size={16} />
          Private recipient portal
        </span>
        {conversation && (
          <button onClick={() => void lock()}>Close & lock</button>
        )}
      </header>
      <main className={conversation ? "recipient-thread" : "recipient-verify"}>
        {stage === "unavailable" ? (
          <div className="card center">
            <span className="icon-tile">
              <Icon name="lock" size={28} />
            </span>
            <h1>This message is unavailable</h1>
            <p>
              Access may have expired or been revoked. Contact the sender if you
              need a new invitation.
            </p>
          </div>
        ) : conversation ? (
          <>
            <div className="recipient-title">
              <span className="eyebrow">EMAIL VERIFIED</span>
              <h1>{conversation.subject}</h1>
              <p>
                Your reply and files will be submitted inside this conversation.
              </p>
            </div>
            <ErrorNotice message={error} />
            <ThreadContent conversation={conversation} />
            <ReplyForm
              conversation={conversation}
              recipientMode
              onSent={() => void refresh()}
            />
          </>
        ) : (
          <div className="card center">
            <span className="icon-tile large">
              <Icon name="shield" size={32} />
            </span>
            <span className="eyebrow">ONESMARTER SECURE MAIL</span>
            <h1>
              {stage === "code"
                ? "Check your email"
                : "A private conversation awaits"}
            </h1>
            <p>
              {stage === "code"
                ? "Enter the six-digit code sent to your designated mailbox."
                : "Verify your email to read the message and share your documents. No account or password needed."}
            </p>
            {!landing && !error ? (
              <Loading />
            ) : (
              <div className="recipient-address">{landing?.recipient}</div>
            )}
            <ErrorNotice message={error} />
            {stage === "code" ? (
              <form onSubmit={verify} className="stack">
                <label>
                  Verification code
                  <input
                    className="otp-input"
                    autoFocus
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    required
                  />
                </label>
                <button className="primary full" disabled={busy}>
                  Verify & open
                  <Icon name="arrow" size={18} />
                </button>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy || cooldown > 0}
                  onClick={() => void requestCode()}
                >
                  {cooldown
                    ? `Resend code in ${cooldown}s`
                    : "Email a new code"}
                </button>
              </form>
            ) : (
              <button
                className="primary full"
                disabled={busy || !landing}
                onClick={() => void requestCode()}
              >
                Email me a code
                <Icon name="arrow" size={18} />
              </button>
            )}
            <small>
              Codes are sent only to the original recipient.
              <br />
              Keep sensitive replies inside this portal.
            </small>
          </div>
        )}
      </main>
      <footer className="recipient-footer">
        OneSmarter Secure Mail · Mailbox verification controls access
      </footer>
    </div>
  );
}
