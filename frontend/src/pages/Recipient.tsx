import { useEffect, useState, type FormEvent } from "react";
import { api, post, ApiError } from "../api";
import type { Conversation, FileItem } from "../types";
import { Brand, ErrorNotice, Icon, Loading } from "../components/ui";
import { ReplyForm, ThreadContent } from "./Mail";

export function Recipient({ token }: { token: string }) {
  const [draft, setDraft] = useState<{ body: string; files: FileItem[] }>({
    body: "",
    files: [],
  });
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
    setDraft({ body: "", files: [] });
    if (!token) {
      void api<Conversation>("/recipient/conversation")
        .then((value) => {
          if (live) {
            setConversation(value);
            setStage("read");
          }
        })
        .catch(() => {
          if (live) {
            setStage("unavailable");
            setError("Open your latest invitation email to verify again.");
          }
        });
      return () => {
        live = false;
      };
    }
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
    const controller = new AbortController();
    const expire = () => {
      setConversation(null);
      setStage("reverify");
      setError(
        "Your access ended. Verify again if the invitation is still active.",
      );
    };
    window.addEventListener("session-expired", expire);
    const timer = setInterval(() => {
      void api<Conversation>("/recipient/conversation", {
        signal: controller.signal,
      })
        .then((value) => {
          if (!controller.signal.aborted) setConversation(value);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setConversation(null);
          setStage(
            err instanceof ApiError && err.status === 404
              ? "unavailable"
              : err instanceof ApiError && err.status === 401
                ? "reverify"
                : "read",
          );
          setError((err as Error).message);
          if (err instanceof ApiError && err.status === 404)
            setDraft({ body: "", files: [] });
        });
    }, 60000);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("session-expired", expire);
    };
  }, [stage, token]);
  useEffect(() => {
    if (stage !== "read") return;
    let last = 0;
    let pending = false;
    const active = () => {
      if (pending || Date.now() - last < 60000) return;
      last = Date.now();
      pending = true;
      void post("/recipient/activity")
        .catch((err: unknown) => {
          if (err instanceof ApiError && err.status === 404) {
            setConversation(null);
            setStage("unavailable");
            setDraft({ body: "", files: [] });
          }
        })
        .finally(() => {
          pending = false;
        });
    };
    window.addEventListener("keydown", active);
    window.addEventListener("pointerdown", active);
    window.addEventListener("wheel", active, { passive: true });
    window.addEventListener("scroll", active, { passive: true, capture: true });
    return () => {
      window.removeEventListener("keydown", active);
      window.removeEventListener("pointerdown", active);
      window.removeEventListener("wheel", active);
      window.removeEventListener("scroll", active, true);
    };
  }, [stage, token]);
  useEffect(() => {
    if (stage !== "reverify") return;
    // Send once per transition; preserve the draft throughout verification.
    setStage("code");
    setCode("");
    setBusy(true);
    void post("/recipient/code", { token })
      .then(() => {
        setCooldown(30);
        setError("");
      })
      .catch((err: unknown) => setError((err as Error).message))
      .finally(() => setBusy(false));
  }, [stage, token]);
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
      // Replace this history entry; keep the token only in component memory for
      // idle-session re-verification. Reload resumes from the HttpOnly session.
      window.history.replaceState(
        null,
        "",
        window.location.pathname + "#/conversation",
      );
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
      setStage(
        err instanceof ApiError && err.status === 404
          ? "unavailable"
          : "reverify",
      );
      if (err instanceof ApiError && err.status === 404)
        setDraft({ body: "", files: [] });
      setError((err as Error).message);
    }
  }
  async function lock() {
    try {
      await post("/recipient/logout");
    } finally {
      setConversation(null);
      setDraft({ body: "", files: [] });
      setStage(token ? "landing" : "unavailable");
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
              A newer reply may have replaced this link. Try the latest
              notification. Access may also have expired or been revoked;
              contact the sender if needed.
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
              draft={draft}
              onDraftChange={setDraft}
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
