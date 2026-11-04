import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { api, ApiError, post } from "../api";

type Thread = {
  id: string;
  name: string;
  subject: string;
  source: string;
  updated_at: string;
  unread: boolean;
};
type Message = {
  id: string;
  sender: string;
  body: string;
  mine: boolean;
  system?: boolean;
  created_at: string;
};
type Participant = { name: string; email: string; mine: boolean; role: string };
type Detail = { provider_action?: { url: string; expires_at: number } | null;
  participants?: Participant[];
  request_summary?: string;
  id: string;
  subject: string;
  messages: Message[];
  next_before: string | null;
};

function mergeDetail(current: Detail | null, result: Detail): Detail {
  if (!current || current.id !== result.id) return result;
  // A poll started before a reply committed must not erase that newer reply.
  const merged = new Map(
    [...current.messages, ...result.messages].map((message) => [
      message.id,
      message,
    ]),
  );
  return {
    ...result,
    next_before:
      current.messages.length > 50 ? current.next_before : result.next_before,
    messages: [...merged.values()].sort(
      (a, b) =>
        a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
    ),
  };
}

export function PortalInbox() {
  const [verified, setVerified] = useState(false);
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Thread[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [selected, setSelected] = useState(
    () => /^#thread\/([a-f0-9-]{36})$/.exec(location.hash)?.[1] || "",
  );
  const [detail, setDetail] = useState<Detail | null>(null);
  const [draft, setDraft] = useState("");
  const messageList = useRef<HTMLDivElement>(null);
  const lastMessageId = detail?.messages.at(-1)?.id;
  const followLatest = useRef(true);
  const viewedThread = useRef("");
  useEffect(() => {
    const node = messageList.current;
    if (!node) return;
    // Layout changes (address disclosures, composer resizing) must not move
    // the reader. Follow new messages only when already near the bottom.
    if (viewedThread.current !== selected || followLatest.current) {
      node.scrollTop = node.scrollHeight;
      followLatest.current = true;
    }
    viewedThread.current = selected;
  }, [lastMessageId, selected]);
  const submission = useRef({ body: "", key: "" });
  const generation = useRef(0);
  const activeSession = useRef(false);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const source =
    new URLSearchParams(location.search).get("source") || "selfpay";
  const lock = useCallback(() => {
    activeSession.current = false;
    generation.current += 1;
    setVerified(false);
    setEmail("");
    setRows([]);
    setDetail(null);
    setDraft("");
    setCode("");
    setSent(false);
    submission.current = { body: "", key: "" };
  }, []);
  useEffect(() => {
    activeSession.current = verified;
  }, [verified]);
  const fail = useCallback(
    (reason: unknown) => {
      if (reason instanceof ApiError && reason.status === 401) lock();
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to complete the request. Please retry.",
      );
    },
    [lock],
  );

  useEffect(() => {
    const controller = new AbortController();
    api<{ verified: boolean; email?: string }>("/inbox/session", {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) {
          setVerified(result.verified);
          if (result.email) setEmail(result.email);
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) fail(reason);
      })
      .finally(() => {
        if (!controller.signal.aborted) setReady(true);
      });
    return () => controller.abort();
  }, [fail]);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(
      () => setCooldown((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => clearTimeout(timer);
  }, [cooldown]);

  const refresh = useCallback(
    async (offset = 0, append = false) => {
      const version = generation.current;
      const result = await api<{
        results: Thread[];
        next_offset: number | null;
      }>(`/inbox/threads?q=${encodeURIComponent(query)}&offset=${offset}`);
      if (version !== generation.current) return;
      setRows((old) =>
        append
          ? [
              ...old,
              ...result.results.filter(
                (item) => !old.some((row) => row.id === item.id),
              ),
            ]
          : result.results,
      );
      setNextOffset(result.next_offset);
    },
    [query],
  );
  useEffect(() => {
    if (!verified) return;
    generation.current += 1;
    const timer = setTimeout(() => void refresh().catch(fail), 250);
    const poll = setInterval(() => {
      if (!document.hidden) void refresh().catch(fail);
    }, 15000);
    return () => {
      clearTimeout(timer);
      clearInterval(poll);
      generation.current += 1;
    };
  }, [verified, refresh, fail]);

  useEffect(() => {
    setDetail(null);
    setDraft("");
    submission.current = { body: "", key: "" };
    if (!verified || !selected) return;
    const controller = new AbortController();
    async function load() {
      try {
        const result = await api<Detail>(`/inbox/threads/${selected}`, {
          signal: controller.signal,
        });
        if (
          !controller.signal.aborted &&
          activeSession.current &&
          selectedRef.current === selected
        ) {
          setDetail((current) => mergeDetail(current, result));
          setRows((old) =>
            old.map((row) =>
              row.id === selected ? { ...row, unread: false } : row,
            ),
          );
        }
      } catch (reason) {
        if (!controller.signal.aborted) {
          setDetail(null);
          fail(reason);
        }
      }
    }
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 10000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [selected, verified, fail]);
  useEffect(() => {
    if (!verified) return;
    let lastActivity = Date.now();
    let renewed = Date.now();
    function activity() {
      lastActivity = Date.now();
      if (lastActivity - renewed > 60000) {
        renewed = lastActivity;
        void post("/inbox/activity").catch(fail);
      }
    }
    const timer = setInterval(() => {
      if (Date.now() - lastActivity >= 15 * 60000) {
        lock();
        void post("/inbox/logout").catch(() => {});
      }
    }, 1000);
    window.addEventListener("pointerdown", activity);
    window.addEventListener("keydown", activity);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pointerdown", activity);
      window.removeEventListener("keydown", activity);
    };
  }, [verified, lock, fail]);

  async function authenticate(event: FormEvent, verify: boolean) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (verify) {
        await post("/inbox/verify", { code });
        setCode("");
        setVerified(true);
      } else {
        await post("/inbox/code", { email, source });
        setSent(true);
        setCooldown(60);
      }
    } catch (reason) {
      fail(reason);
    } finally {
      setBusy(false);
    }
  }
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!selected || !draft.trim()) return;
    setBusy(true);
    setError("");
    const id = selected;
    if (submission.current.body !== draft)
      submission.current = { body: draft, key: crypto.randomUUID() };
    try {
      await post(
        `/inbox/threads/${id}`,
        { body: draft },
        submission.current.key,
      );
      if (!activeSession.current || selectedRef.current !== id) return;
      setDraft("");
      submission.current = { body: "", key: "" };
      const result = await api<Detail>(`/inbox/threads/${id}`);
      if (!activeSession.current || selectedRef.current !== id) return;
      setDetail((current) => mergeDetail(current, result));
      await refresh();
    } catch (reason) {
      fail(reason);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="partner-portal">
      <header className="partner-heading">
        <div>
          <p>OneSmarter Secure Mail</p>
          <h1>Your secure conversations</h1>
          {verified && email && (
            <span className="partner-account">{email}</span>
          )}
        </div>
        {verified && (
          <button
            onClick={() => {
              lock();
              void post("/inbox/logout").catch(fail);
            }}
          >
            Lock inbox
          </button>
        )}
      </header>
      {error && (
        <p role="alert" className="notice warning">
          {error}
        </p>
      )}
      {!ready ? (
        <p role="status">Checking your session…</p>
      ) : !verified ? (
        <section className="partner-login">
          <h2>Verify your email</h2>
          <p>
            Use the email address associated with your appointment requests.
            Only conversations assigned to that address will be visible.
          </p>
          <form onSubmit={(event) => void authenticate(event, false)}>
            <label>
              Email address
              <input
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setSent(false);
                }}
              />
            </label>
            <button disabled={busy || cooldown > 0}>
              {cooldown
                ? `Resend in ${cooldown}s`
                : "Email a verification code"}
            </button>
          </form>
          {sent && (
            <form onSubmit={(event) => void authenticate(event, true)}>
              <p role="status">
                If this address has conversations, a code will arrive shortly.
              </p>
              <label>
                Six-digit code
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
              </label>
              <button disabled={busy}>Open inbox</button>
            </form>
          )}
        </section>
      ) : (
        <div
          className={`partner-layout ${selected ? "partner-has-selection" : ""}`}
        >
          <aside className="partner-list" aria-label="Conversations">
            <label className="partner-search">
              <span className="partner-visually-hidden">
                Search conversations
              </span>
              <input
                type="search"
                value={query}
                maxLength={100}
                placeholder="Search conversations"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            {rows.map((row) => (
              <button
                key={row.id}
                disabled={busy}
                aria-current={selected === row.id ? "true" : undefined}
                className={`partner-row ${row.unread ? "partner-unread" : ""}`}
                onClick={() => {
                  setSelected(row.id);
                  history.replaceState(null, "", `#thread/${row.id}`);
                }}
              >
                <span className="partner-row-top">
                  <strong>
                    {row.unread && (
                      <span className="partner-dot" aria-label="Unread" />
                    )}
                    {row.name}
                  </strong>
                  <time
                    dateTime={row.updated_at}
                    title={new Date(row.updated_at).toLocaleString()}
                  >
                    {new Date(row.updated_at).toDateString() ===
                    new Date().toDateString()
                      ? new Date(row.updated_at).toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })
                      : new Date(row.updated_at).toLocaleDateString([], {
                          month: "short",
                          day: "numeric",
                        })}
                  </time>
                </span>
                <span className="partner-row-subject" title={row.subject}>
                  {row.subject}
                </span>
              </button>
            ))}
            {!rows.length && <p>No conversations found.</p>}
            {nextOffset !== null && (
              <button
                onClick={() => void refresh(nextOffset, true).catch(fail)}
              >
                Search / load more conversations
              </button>
            )}
          </aside>
          <section className="partner-thread" aria-label="Messages">
            {!detail && (
              <button
                type="button"
                className="partner-back"
                onClick={() => setSelected("")}
              >
                ← Inbox
              </button>
            )}
            {!detail ? (
              <p>
                {selected
                  ? "Loading conversation…"
                  : "Choose a conversation to read and reply."}
              </p>
            ) : (
              <>
                <header className="partner-conversation-heading">
                  <button
                    type="button"
                    className="partner-back"
                    onClick={() => {
                      setSelected("");
                      history.replaceState(
                        null,
                        "",
                        location.pathname + location.search,
                      );
                    }}
                  >
                    ← Inbox
                  </button>
                  <h2>{detail.subject}</h2>
                </header>
                {detail.provider_action && <div className="partner-clinic-action"><span>Review this request and confirm the appointment.</span><a href={detail.provider_action.url} target="_blank" rel="noopener noreferrer" className="button">Review & confirm request</a></div>}
          {detail.request_summary && (
                  <details className="partner-summary">
                    <summary>
                      Appointment request details{" "}
                      <span>Patient information & requested times</span>
                    </summary>
                    <p>{detail.request_summary}</p>
                  </details>
                )}
                {detail.next_before && (
                  <button
                    onClick={async () => {
                      try {
                        const older = await api<Detail>(
                          `/inbox/threads/${detail.id}?before=${detail.next_before}`,
                        );
                        setDetail((current) =>
                          current?.id === older.id
                            ? {
                                ...current,
                                messages: [
                                  ...older.messages,
                                  ...current.messages,
                                ],
                                next_before: older.next_before,
                              }
                            : current,
                        );
                      } catch (reason) {
                        fail(reason);
                      }
                    }}
                  >
                    Load earlier messages
                  </button>
                )}
                <div
                  className="partner-messages"
                  ref={messageList}
                  onScroll={(event) => {
                    const node = event.currentTarget;
                    followLatest.current =
                      node.scrollHeight - node.scrollTop - node.clientHeight <
                      64;
                  }}
                >
                  {detail.messages
                    .filter((message) => !message.system)
                    .map((message) => (
                      <article
                        key={message.id}
                        className={`partner-message ${message.mine ? "partner-mine" : ""}`}
                      >
                        <header>
                          <details className="partner-message-addresses">
                            <summary>
                              <strong>{message.sender}</strong>
                              <svg
                                className="partner-address-chevron"
                                viewBox="0 0 16 16"
                                width="14"
                                height="14"
                                aria-hidden="true"
                              >
                                <path
                                  d="m4 6 4 4 4-4"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.5"
                                />
                              </svg>
                              <span className="partner-visually-hidden">
                                Show sender and recipient
                              </span>
                            </summary>
                            <dl>
                              <dt>From</dt>
                              <dd>
                                {detail.participants
                                  ?.filter(
                                    (person) => person.mine === message.mine,
                                  )
                                  .map((person) => (
                                    <span key={person.email}>
                                      {person.name}{" "}
                                      <span className="partner-email">
                                        {person.email}
                                      </span>
                                    </span>
                                  ))}
                              </dd>
                              <dt>To</dt>
                              <dd>
                                {detail.participants
                                  ?.filter(
                                    (person) => person.mine !== message.mine,
                                  )
                                  .map((person) => (
                                    <span key={person.email}>
                                      {person.name}{" "}
                                      <span className="partner-email">
                                        {person.email}
                                      </span>
                                    </span>
                                  ))}
                              </dd>
                            </dl>
                          </details>
                          <time dateTime={message.created_at}>
                            {new Date(message.created_at).toLocaleString()}
                          </time>
                        </header>
                        <p>{message.body}</p>
                      </article>
                    ))}
                </div>
                <form
                  className="partner-composer"
                  onSubmit={(event) => void send(event)}
                >
                  <label>
                    Secure reply
                    <textarea
                      required
                      maxLength={16000}
                      rows={2}
                      placeholder="Write a message…"
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                    />
                  </label>
                  <div className="partner-compose-actions">
                    <span>
                      Email notifications keep both participants updated.
                    </span>
                    <button disabled={busy || !draft.trim()}>
                      {busy ? "Sending…" : "Send securely"}
                    </button>
                  </div>
                </form>
              </>
            )}
          </section>
        </div>
      )}
      <p className="partner-muted">
        Email verification required · Automatically locks after 15 minutes of
        inactivity · Please reply inside this portal.
      </p>
    </main>
  );
}
