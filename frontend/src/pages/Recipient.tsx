import { useEffect, useState, type FormEvent } from "react";
import { api, post, ApiError } from "../api";
import type { Conversation, FileItem } from "../types";
import { Badge, Brand, ErrorNotice, Icon, Loading } from "../components/ui";
import { ReplyForm, ThreadContent } from "./Mail";
import { RecipientCatalog } from "./RecipientCatalog";

function failureStage(error: unknown, token: string) {
  if (error instanceof ApiError && error.status === 404) return "unavailable";
  if (error instanceof ApiError && error.status === 401)
    return token ? "reverify" : "invitation";
  return "retry";
}

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
  const [view, setView] = useState<"conversation" | "catalog">("conversation");
  const [composerOpen, setComposerOpen] = useState(false);
  const [code, setCode] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    setConversation(null);
    setError("");
    setStage("landing");
    setView("conversation");
    setDraft({ body: "", files: [] });
    if (!token) {
      void api<Conversation>("/recipient/conversation")
        .then((value) => {
          if (live) {
            setConversation(value);
            setStage("read");
          }
        })
        .catch((err: unknown) => {
          if (live) {
            setStage(failureStage(err, token));
            setError((err as Error).message);
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
      setStage(token ? "reverify" : "invitation");
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
          setStage(failureStage(err, token));
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
  async function requestCode() {
    if (!token) {
      setStage("invitation");
      return;
    }
    if (busy || cooldown > 0) return;
    setBusy(true);
    setError("");
    try {
      await post("/recipient/code", { token });
      setCode("");
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
    setBusy(true);
    setError("");
    try {
      setConversation(await api<Conversation>("/recipient/conversation"));
      setStage("read");
    } catch (err) {
      setConversation(null);
      setStage(failureStage(err, token));
      if (err instanceof ApiError && err.status === 404)
        setDraft({ body: "", files: [] });
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function lock() {
    try {
      await post("/recipient/logout");
    } finally {
      setConversation(null);
      setDraft({ body: "", files: [] });
      setStage(token ? "landing" : "invitation");
    }
  }
  return (
    <div
      className={`recipient-layout${conversation ? " recipient-workspace" : ""}`}
    >
      {conversation && (
        <aside className="recipient-sidebar">
          <Brand />
          <nav aria-label="Recipient navigation">
            <button
              aria-current={view === "conversation" ? "page" : undefined}
              onClick={() => setView("conversation")}
            >
              <Icon name="mail" />
              Conversations
            </button>
            <button
              aria-current={view === "catalog" ? "page" : undefined}
              onClick={() => setView("catalog")}
            >
              <Icon name="file" />
              Archive
            </button>
          </nav>
          <div className="recipient-sidebar-note">
            <Icon name="lock" size={16} />
            Private recipient portal
          </div>
        </aside>
      )}
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
        {stage === "invitation" ? (
          <div className="card center">
            <h1>Open your invitation email</h1>
            <p>
              Your session has ended. Open the link in your latest invitation
              email to verify again.
            </p>
            <p>
              No verification email has been sent. Contact the sender if you
              cannot find your invitation.
            </p>
          </div>
        ) : stage === "retry" ? (
          <div className="card center">
            <h1>Unable to load your conversation</h1>
            <ErrorNotice message={error} />
            <button disabled={busy} onClick={() => void refresh()}>
              Try again
            </button>
          </div>
        ) : stage === "unavailable" ? (
          <div className="card center">
            <span className="icon-tile">
              <Icon name="lock" size={28} />
            </span>
            <h1>This message is unavailable</h1>
            <p>
              Access may have been revoked, or the link may be invalid. Contact
              the sender if needed.
            </p>
          </div>
        ) : conversation ? (
          <>
            {view === "catalog" && (
              <RecipientCatalog conversation={conversation} />
            )}
            <div
              className="recipient-chat-view"
              hidden={view !== "conversation"}
            >
              <header className="conversation-header recipient-conversation-header">
                <div className="conversation-heading">
                  <h1>{conversation.subject}</h1>
                </div>
                <Badge tone="success">
                  <Icon name="shield" size={14} /> Email verified
                </Badge>
                {!composerOpen && (
                  <button
                    type="button"
                    className="primary conversation-new-message"
                    onClick={() =>
                      window.dispatchEvent(
                        new CustomEvent("open-secure-composer", {
                          detail: { conversationId: conversation.id },
                        }),
                      )
                    }
                  >
                    <Icon name="plus" size={18} /> New message
                  </button>
                )}
              </header>
              <ErrorNotice message={error} />
              <div
                className="conversation-stream"
                role="region"
                aria-label="Conversation messages and reply"
                tabIndex={0}
              >
                <ReplyForm
                  conversation={conversation}
                  recipientMode
                  headerLauncher
                  onExpandedChange={setComposerOpen}
                  draft={draft}
                  onDraftChange={setDraft}
                  onSent={() => void refresh()}
                />
                <ThreadContent conversation={conversation} recipientMode />
              </div>
            </div>
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
                disabled={
                  busy ||
                  !token ||
                  cooldown > 0 ||
                  (stage === "landing" && !landing)
                }
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
