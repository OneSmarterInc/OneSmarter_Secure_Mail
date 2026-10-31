import {
  Component,
  useEffect,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { api, formatDate, post, recipientPortal } from "./api";
import type { InboxItem, Session, User } from "./types";
import {
  Badge,
  Brand,
  Empty,
  ErrorNotice,
  Icon,
  Loading,
  PageHeader,
} from "./components/ui";
import { Auth } from "./pages/Auth";
import { Compose, MailDetail, MailList } from "./pages/Mail";
import { Accounts, AuditLogs } from "./pages/Access";
import { EvidenceCatalog } from "./pages/EvidenceCatalog";
import { Connections } from "./pages/Connections";
import { Recipient } from "./pages/Recipient";

class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    /* Never log confidential component state. */
  }
  render() {
    return this.state.failed ? (
      <main className="fatal-error">
        <h1>The workspace could not be displayed</h1>
        <p>Reload to reconnect. Saved conversations remain on the server.</p>
        <button onClick={() => window.location.reload()}>
          Reload workspace
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}

function DevelopmentInbox() {
  const [refresh, setRefresh] = useState(0);
  const [token, setToken] = useState("");
  const [capability, setCapability] = useState("");
  const [result, setResult] = useState<{
    data: { results: InboxItem[] } | null;
    loading: boolean;
    error: string;
  }>({ data: null, loading: false, error: "" });
  useEffect(() => {
    const controller = new AbortController();
    if (!capability) {
      setResult({ data: null, loading: false, error: "" });
      return () => controller.abort();
    }
    setResult({ data: null, loading: true, error: "" });
    api<{ results: InboxItem[] }>("/dev/inbox", {
      headers: { "X-Dev-Inbox-Token": capability },
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted)
          setResult({ data, loading: false, error: "" });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setResult({
            data: null,
            loading: false,
            error: (error as Error).message,
          });
      });
    return () => controller.abort();
  }, [capability, refresh]);
  return (
    <div className="inbox-layout">
      <header className="recipient-header">
        <Brand />
        <a className="button" href="#/messages">
          Staff workspace
        </a>
      </header>
      <main className="inbox-main">
        <PageHeader
          eyebrow="SYNTHETIC TESTING ONLY"
          title="Development mailbox"
          description="Local email capture for trying invitations and verification codes. No email is sent to these mailboxes."
          actions={
            <button onClick={() => setRefresh((v) => v + 1)}>
              Refresh inbox
            </button>
          }
        />
        <div className="notice warning">
          This operator-protected mailbox displays synthetic notification
          contents. It is not available in production. The delivery worker must
          be running.
        </div>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            setCapability(token);
            setToken("");
            setRefresh((v) => v + 1);
          }}
        >
          <label>
            Development inbox token
            <input
              type="password"
              required
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </label>
          <button type="submit">Unlock inbox</button>
          {capability && (
            <button
              type="button"
              onClick={() => {
                setCapability("");
                setToken("");
              }}
            >
              Lock inbox
            </button>
          )}
        </form>
        <ErrorNotice message={result.error} />
        {result.loading ? (
          <Loading />
        ) : !result.data?.results.length ? (
          <Empty title="No notifications yet">
            Create an account or conversation, then refresh once the worker
            processes it.
          </Empty>
        ) : (
          <div className="stack">
            {result.data.results.map((mail) => (
              <article className="card" key={mail.id}>
                <div className="message-heading">
                  <div>
                    <strong>{mail.subject}</strong>
                    <small>To: {mail.to}</small>
                  </div>
                  <small>{formatDate(mail.created_at)}</small>
                </div>
                <p className="message-body">{mail.body}</p>
                {mail.link && (
                  <a className="button primary" href={mail.link}>
                    Open invitation
                    <Icon name="arrow" size={17} />
                  </a>
                )}
              </article>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function Application() {
  const [route, setRoute] = useState(
    window.location.hash.slice(1) || "/messages",
  );
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState("");
  const [sessionError, setSessionError] = useState("");
  const [sessionRetry, setSessionRetry] = useState(0);
  const [sessionChecking, setSessionChecking] = useState(false);
  const sessionEpoch = useRef(0);
  const [idleWarning, setIdleWarning] = useState(false);
  const deadline = useRef(0);
  useEffect(() => {
    deadline.current = Math.min(
      session?.idle_expires_at ?? Infinity,
      session?.absolute_expires_at ?? Infinity,
    );
  }, [session]);
  useEffect(() => {
    if (recipientPortal || !session?.user) return;
    let active = true;
    let pending = false;
    let dirty = false;
    let lastSent = 0;
    const epoch = sessionEpoch.current;
    const activity = (event: Event) => {
      if (event.isTrusted) dirty = true;
    };
    async function tick() {
      const now = Date.now() / 1000;
      if (now >= deadline.current) {
        window.dispatchEvent(new Event("session-expired"));
        return;
      }
      setIdleWarning(deadline.current - now <= 60);
      if (
        !dirty ||
        pending ||
        now - lastSent < 30 ||
        document.visibilityState !== "visible"
      )
        return;
      pending = true;
      dirty = false;
      lastSent = now;
      try {
        const times = await post<{
          idle_expires_at: number;
          absolute_expires_at: number;
        }>("/auth/activity");
        if (active && epoch === sessionEpoch.current)
          setSession((s) => (s?.user ? { ...s, ...times } : s));
      } catch {
        /* The confirmed deadline still locks the screen during an outage. */
      } finally {
        pending = false;
      }
    }
    const events = ["pointerdown", "keydown", "wheel", "touchstart"];
    events.forEach((name) =>
      window.addEventListener(name, activity, { passive: true }),
    );
    const timer = window.setInterval(() => void tick(), 1000);
    return () => {
      active = false;
      clearInterval(timer);
      events.forEach((name) => window.removeEventListener(name, activity));
    };
  }, [session?.user?.id]);
  useEffect(() => {
    if (!recipientPortal && route.startsWith("/invite/")) {
      window.location.replace(`/recipient/${window.location.hash}`);
    }
  }, [route]);
  useEffect(() => {
    const change = () => setRoute(window.location.hash.slice(1) || "/messages");
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    let active = true;
    let pending = false;
    const controller = new AbortController();
    async function refresh() {
      if (pending) return;
      pending = true;
      const epoch = sessionEpoch.current;
      setSessionChecking(true);
      try {
        const state = await api<Session>("/auth/session", {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(8000),
          ]),
        });
        if (active && epoch === sessionEpoch.current) {
          setSession(state);
          setSessionError("");
        }
      } catch (err) {
        if (active && epoch === sessionEpoch.current) {
          // Retain the last confirmed session and mounted drafts on transient
          // failures. A 401 emits session-expired and clears authentication.
          setSessionError(
            err instanceof DOMException && err.name === "TimeoutError"
              ? "Session check timed out. Please try again."
              : (err as Error).message,
          );
        }
      } finally {
        pending = false;
        if (active) setSessionChecking(false);
      }
    }
    const expired = () => {
      sessionEpoch.current++;
      setSession((s) => ({
        ...(s ?? {
          csrf: "",
          synthetic_mode: false,
          dev_tools: false,
          setup_required: false,
        }),
        user: null,
      }));
      setSessionError("");
    };
    const focus = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 60000);
    window.addEventListener("session-expired", expired);
    document.addEventListener("visibilitychange", focus);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("session-expired", expired);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [sessionRetry]);
  async function signedIn(user: User) {
    sessionEpoch.current++;
    const fresh = await api<Session>("/auth/session");
    setSession({ ...fresh, user });
    setSessionError("");
    window.location.hash = "/messages";
  }
  async function signOut() {
    try {
      await post("/auth/logout");
      sessionEpoch.current++;
      setSession((s) => (s ? { ...s, user: null } : s));
      window.location.hash = "/messages";
    } catch (err) {
      setError((err as Error).message);
    }
  }
  if (!session)
    return (
      <main className="fatal-error">
        <Brand />
        {sessionError ? (
          <>
            <ErrorNotice message={sessionError} />
            <p>Unable to check your session. Please try again.</p>
            <button
              disabled={sessionChecking}
              onClick={() => setSessionRetry((value) => value + 1)}
            >
              Try again
            </button>
          </>
        ) : (
          <Loading />
        )}
      </main>
    );
  const path = route.split("?")[0];
  const token = path.startsWith("/invite/")
    ? path.slice("/invite/".length)
    : "";
  const activation = path.startsWith("/activate/")
    ? path.slice("/activate/".length)
    : undefined;
  const user = session.user;
  if (path === "/development/inbox" && session.dev_tools && !recipientPortal)
    return <DevelopmentInbox />;
  if (token && !recipientPortal) {
    return <Loading />;
  }
  if (recipientPortal) {
    return token || path === "/conversation" ? (
      <Recipient key={token} token={token} />
    ) : (
      <main className="fatal-error">
        <Brand />
        <h1>Secure recipient portal</h1>
        <p>
          Open the invitation link in your email to view your conversation and
          submit documents.
        </p>
        <p>
          No staff account is required. Access is verified using your email
          address.
        </p>
      </main>
    );
  }
  if (!user || activation)
    return (
      <>
        <Auth
          key={activation || "login"}
          setup={session.setup_required}
          activation={activation}
          onLogin={(u) => void signedIn(u)}
        />
      </>
    );
  const admin = path.startsWith("/access");
  let page: ReactNode;
  if (path === "/messages" || path === "/") page = <MailList />;
  else if (path === "/compose" || path === "/request")
    page = <Compose user={user} />;
  else if (path.startsWith("/messages/"))
    page = <MailDetail key={path} id={path.slice("/messages/".length)} />;
  else if (path === "/evidence") page = <EvidenceCatalog />;
  else if (path === "/settings") page = <Connections />;
  else if (admin && user.role !== "admin")
    page = (
      <Empty title="Administrator access required">
        Contact your administrator if your responsibilities have changed.
      </Empty>
    );
  else if (path === "/access/audit")
    page = (
      <AuditLogs
        key={route}
        user={user}
        actorId={new URLSearchParams(route.split("?")[1]).get("actor") || ""}
      />
    );
  else if (path === "/access/accounts" || path === "/access")
    page = <Accounts user={user} />;
  else
    page = (
      <Empty title="Page not found">
        <a href="#/messages">Return to conversations</a>
      </Empty>
    );
  return (
    <>
      <a
        className="skip-link"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        Skip to content
      </a>
      <div className="app-layout">
        <aside className="sidebar">
          <Brand />
          <div className="workspace-label">{user.organization}</div>
          <nav className="main-navigation" aria-label="Main navigation">
            <a
              href="#/messages"
              className={path.startsWith("/messages") ? "active" : ""}
              aria-current={path.startsWith("/messages") ? "page" : undefined}
            >
              <Icon name="mail" />
              Conversations
            </a>
            <a
              href="#/compose"
              className={
                path === "/compose" || path === "/request" ? "active" : ""
              }
              aria-current={
                path === "/compose" || path === "/request" ? "page" : undefined
              }
            >
              <Icon name="plus" />
              New conversation
            </a>
            <a
              href="#/evidence"
              className={path === "/evidence" ? "active" : ""}
              aria-current={path === "/evidence" ? "page" : undefined}
            >
              <Icon name="file" />
              Archive
            </a>
            <span className="nav-divider" />
            {user.role === "admin" && (
              <a
                href="#/access/accounts"
                className={admin ? "active" : ""}
                aria-current={admin ? "page" : undefined}
              >
                <Icon name="users" />
                Access<Badge>Admin</Badge>
              </a>
            )}
            <a
              href="#/settings"
              className={path === "/settings" ? "active" : ""}
              aria-current={path === "/settings" ? "page" : undefined}
            >
              <Icon name="settings" />
              Connections
            </a>
          </nav>
          <div className="sidebar-note">
            <Icon name="lock" />
            <span>Private staff workspace</span>
          </div>
          <div className="profile">
            <span className="avatar small">
              {user.name.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <strong>{user.name}</strong>
              <small>{user.role === "admin" ? "Administrator" : "Staff"}</small>
            </div>
            <button
              className="icon-button"
              onClick={() => void signOut()}
              aria-label="Sign out"
            >
              <Icon name="logout" size={18} />
            </button>
          </div>
        </aside>
        <div className="workspace">
          <header className="topbar">
            <nav className="workspace-breadcrumb" aria-label="Breadcrumb">
              <a href="#/messages">OneSmarter</a>
              <span aria-hidden="true">/</span>
              <strong aria-current="page">
                {admin
                  ? "Access"
                  : path === "/settings"
                    ? "Connections"
                    : path === "/request"
                      ? "New conversation"
                      : path === "/compose"
                        ? "New conversation"
                        : path === "/evidence"
                          ? "Archive"
                          : "Conversations"}
              </strong>
            </nav>
            <span
              className={`verified-session ${sessionError ? "session-warning" : ""}`}
            >
              <Icon name={sessionError ? "clock" : "shield"} size={14} />
              {sessionError
                ? "Session check unavailable"
                : "MFA verified session"}
            </span>
            <button className="mobile-signout" onClick={() => void signOut()}>
              Sign out
            </button>
          </header>
          <main className="main-content" id="main-content" tabIndex={-1}>
            <ErrorNotice message={error} />
            {sessionError && (
              <div className="notice warning" role="status">
                <p>
                  Unable to check your session. Your work remains on this page.
                  We’ll retry automatically.
                </p>
                <button
                  disabled={sessionChecking}
                  onClick={() => setSessionRetry((value) => value + 1)}
                >
                  {sessionChecking
                    ? "Checking session…"
                    : "Retry session check"}
                </button>
              </div>
            )}
            {idleWarning && (
              <div className="notice warning" role="status">
                Your session will lock soon due to inactivity. Interact with
                this page to stay signed in.
              </div>
            )}
            {page}
          </main>
          <footer className="workspace-footer">
            OneSmarter Secure Mail
            <span>Only your assigned conversations are visible</span>
          </footer>
        </div>
      </div>
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <Application />
    </ErrorBoundary>
  );
}
