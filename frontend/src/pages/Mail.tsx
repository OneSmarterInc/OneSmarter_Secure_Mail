import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  api,
  ApiError,
  downloadAttachment,
  formatDate,
  post,
  query,
  useDebounced,
  useResource,
  useDocumentService,
} from "../api";
import type { Conversation, FileItem, Page, User } from "../types";
import {
  Badge,
  Empty,
  ErrorNotice,
  Icon,
  Loading,
  Modal,
  PageHeader,
  Pagination,
} from "../components/ui";
import { Uploads } from "../components/Uploads";
import { DeliveryRetry } from "../components/DeliveryRetry";

export function MailList() {
  const [q, setQ] = useState("");
  const debounced = useDebounced(q);
  const [state, setState] = useState("");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [refresh, setRefresh] = useState(0);
  const resource = useResource<Page<Conversation>>(
    "/conversations" + query({ q: debounced, state, page, page_size: size }),
    refresh,
  );
  const listPanel = useRef<HTMLElement>(null);
  const [settledHeight, setSettledHeight] = useState(0);
  useLayoutEffect(() => {
    if (resource.loading || !listPanel.current) return;
    // Keep the last completed layout while filters replace rows with a spinner.
    // Otherwise the document shrinks and the browser clamps the scroll position.
    const panel = listPanel.current;
    const measure = () =>
      setSettledHeight(panel.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [resource.loading, resource.data, resource.error]);
  const stats = useResource<{
    conversations: number;
    awaiting: number;
    replied: number;
    active: number;
    delivery_attention: number;
  }>("/dashboard", refresh);
  return (
    <>
      <PageHeader
        eyebrow="YOUR WORKSPACE"
        title="Conversations"
        description="A clear view of what’s sent, what’s received, and what needs you."
        actions={
          <a className="button primary" href="#/compose">
            <Icon name="plus" size={18} />
            New conversation
          </a>
        }
      />
      <div className="stat-grid">
        {[
          ["mail", "Total conversations", stats.data?.conversations],
          ["clock", "Awaiting a response", stats.data?.awaiting],
          ["check", "Recipient replied", stats.data?.replied],
          ["shield", "Active protected access", stats.data?.active],
        ].map(([icon, label, value]) => (
          <div className="stat-card" key={String(label)}>
            <div className="stat-top">
              <span>{label}</span>
              <Icon name={String(icon)} />
            </div>
            <strong>{value ?? "—"}</strong>
          </div>
        ))}
      </div>
      {!!stats.data?.delivery_attention && (
        <div className="notice warning">
          {stats.data.delivery_attention} delivery jobs need attention. Open the
          relevant conversation to review.
        </div>
      )}
      <section
        className="card flush"
        ref={listPanel}
        aria-busy={resource.loading}
        style={resource.loading ? { minHeight: settledHeight } : undefined}
      >
        <div className="list-toolbar">
          <div className="segmented">
            <button
              aria-pressed={!state}
              className={!state ? "selected" : ""}
              onClick={() => {
                setState("");
                setPage(1);
              }}
            >
              All conversations
            </button>
            <button
              aria-pressed={state === "replied"}
              className={state === "replied" ? "selected" : ""}
              onClick={() => {
                setState("replied");
                setPage(1);
              }}
            >
              Replied
            </button>
            <button
              aria-pressed={state === "awaiting_recipient"}
              className={state === "awaiting_recipient" ? "selected" : ""}
              onClick={() => {
                setState("awaiting_recipient");
                setPage(1);
              }}
            >
              Awaiting
            </button>
          </div>
          <div className="toolbar-end">
            <label className="search">
              <Icon name="search" size={18} />
              <input
                aria-label="Search subject, recipient or status"
                placeholder="Search conversations…"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
              />
            </label>
            <button
              onClick={() => setRefresh((v) => v + 1)}
              aria-label="Refresh conversations"
            >
              ↻
            </button>
          </div>
        </div>
        <ErrorNotice message={resource.error} />
        {resource.loading ? (
          <Loading />
        ) : resource.error ? (
          <div className="notice warning">
            Conversations could not be loaded. This does not mean your inbox is
            empty. Your saved conversations have not been deleted. Contact your
            administrator if refreshing does not resolve the problem.
          </div>
        ) : resource.data?.results.length ? (
          <div className="conversation-list">
            {resource.data.results.map((c) => (
              <a
                className={`conversation-row ${c.unread ? "unread" : ""}`}
                href={`#/messages/${c.id}`}
                key={c.id}
              >
                <span className={`mail-avatar ${c.protected ? "" : "normal"}`}>
                  <Icon name={c.protected ? "shield" : "mail"} />
                </span>
                <div className="conversation-summary">
                  <div>
                    <strong>{c.subject}</strong>
                    {c.unread && (
                      <span
                        className="unread-dot"
                        role="img"
                        aria-label="Unread"
                      />
                    )}
                  </div>
                  <p>{c.recipients.map((r) => r.email).join(", ")}</p>
                  <small>
                    {c.mode === "secure_request"
                      ? "Secure conversation"
                      : c.protected
                        ? "Protected conversation"
                        : "Normal email"}
                  </small>
                </div>
                <div className="conversation-status">
                  <Badge
                    tone={
                      c.revoked
                        ? "danger"
                        : c.state === "replied"
                          ? "success"
                          : "neutral"
                    }
                  >
                    {c.revoked
                      ? "Access revoked"
                      : c.state === "replied"
                        ? "Replied"
                        : "Awaiting recipient"}
                  </Badge>
                  <small>{formatDate(c.updated_at)}</small>
                </div>
                <Icon name="arrow" size={18} />
              </a>
            ))}
          </div>
        ) : (
          <Empty
            title={
              q
                ? "No matching conversations"
                : state
                  ? "No conversations in this view"
                  : "Your conversations start here"
            }
          >
            {q || state
              ? "Try another search or choose All conversations."
              : "Send a message or request documents. Your protected exchanges will appear here."}
          </Empty>
        )}
        {!resource.error && resource.data && (
          <Pagination
            count={resource.data.count}
            page={page}
            size={size}
            onPage={setPage}
            onSize={(n) => {
              setSize(n);
              setPage(1);
            }}
          />
        )}
      </section>
      <div className="quiet-note">
        <Icon name="lock" size={16} />
        Only conversations assigned to you appear here. Administrator access
        does not unlock confidential content.
      </div>
    </>
  );
}

function Addresses({
  label,
  values,
  onChange,
  required = false,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  required?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  function add() {
    const items = draft.split(/[;,\s]+/).filter(Boolean);
    if (items.some((v) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v))) {
      setError("Enter complete email addresses.");
      return;
    }
    onChange([...new Set([...values, ...items.map((v) => v.toLowerCase())])]);
    setDraft("");
    setError("");
  }
  return (
    <div className="address-field">
      <label htmlFor={`addresses-${label}`}>
        {label}
        {required ? " *" : ""}
      </label>
      <div className="recipient-input">
        {values.map((v) => (
          <span className="recipient-chip" key={v}>
            {v}
            <button
              type="button"
              aria-label={`Remove ${v} from ${label}`}
              onClick={() => onChange(values.filter((e) => e !== v))}
            >
              ×
            </button>
          </span>
        ))}
        <input
          id={`addresses-${label}`}
          type="text"
          value={draft}
          placeholder={values.length ? "Add another…" : "recipient@example.com"}
          onChange={(e) => {
            setDraft(e.target.value);
            e.target.setCustomValidity(
              e.target.value.trim()
                ? "Add or correct this address before sending."
                : "",
            );
          }}
          onBlur={(e) => {
            const valid = !draft
              .split(/[;,\s]+/)
              .filter(Boolean)
              .some((v) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v));
            add();
            e.target.setCustomValidity(
              valid ? "" : "Enter complete email addresses.",
            );
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "," || e.key === ";") {
              e.preventDefault();
              add();
              const valid = !draft
                .split(/[;,\s]+/)
                .filter(Boolean)
                .some((v) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v));
              e.currentTarget.setCustomValidity(
                valid ? "" : "Enter complete email addresses.",
              );
            }
          }}
          aria-invalid={!!error}
        />
      </div>
      {error && (
        <small className="error-text" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}

export function Compose({ user }: { user: User }) {
  const serviceReady = useDocumentService();
  const [to, setTo] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [bcc, setBcc] = useState<string[]>([]);
  const [extras, setExtras] = useState(false);
  const [sender, setSender] = useState(user.sender_addresses[0] ?? "");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [nophi, setNophi] = useState(false);
  const requestMode = !nophi;
  const [acknowledged, setAcknowledged] = useState(false);
  const [routeSignature, setRouteSignature] = useState("");
  const [routeRevision, setRouteRevision] = useState(0);
  const [expiry, setExpiry] = useState(7);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [route, setRoute] = useState<{
    protected: boolean;
    reason: string;
  } | null>(
    requestMode ? { protected: true, reason: "secure_conversation" } : null,
  );
  const [routeError, setRouteError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submission = useRef({ signature: "", key: crypto.randomUUID() });
  const payload = {
    sender,
    to,
    cc,
    bcc,
    subject,
    body,
    expiry_days: expiry,
    attachments: files.map((f) => f.id),
    nophi_override: nophi,
    nophi_acknowledged: acknowledged,
    mode: requestMode ? "secure_request" : "ordinary",
  };
  const signature = JSON.stringify(payload);
  const debounced = useDebounced(signature);
  const routeFresh =
    !!route && routeSignature === signature && debounced === signature;
  useEffect(() => {
    const controller = new AbortController();
    setRouteError("");
    if (!to.length) {
      setRoute(
        requestMode ? { protected: true, reason: "secure_conversation" } : null,
      );
      return;
    }
    api<{ protected: boolean; reason: string }>("/routing/preview", {
      method: "POST",
      body: debounced,
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) {
          setRoute(value);
          setRouteSignature(debounced);
        }
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setRoute(null);
          setRouteError((err as Error).message);
        }
      });
    return () => controller.abort();
  }, [debounced, requestMode, to.length, routeRevision]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!serviceReady) {
      setError(
        serviceReady === null
          ? "Checking service availability. Please wait."
          : "Service is disabled.",
      );
      return;
    }
    if (!routeFresh || (nophi && !acknowledged)) {
      setError("Review the current delivery route before sending.");
      return;
    }
    setBusy(true);
    setError("");
    if (submission.current.signature !== signature)
      submission.current = { signature, key: crypto.randomUUID() };
    try {
      const result = await post<{ id: string }>(
        "/conversations",
        { ...payload, expected_route: route },
        submission.current.key,
      );
      window.location.hash = "/messages/" + result.id;
    } catch (err) {
      if (err instanceof ApiError && err.code === "route_changed") {
        setRouteSignature("");
        setRoute(null);
        setRouteRevision((value) => value + 1);
        submission.current = { signature: "", key: crypto.randomUUID() };
      }
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="START A CONVERSATION"
        title="New conversation"
        description="Send a message, share files, or ask for documents in one secure conversation."
      />
      <div className="compose-layout compact-compose">
        <form onSubmit={submit} className="card stack compose-form">
          <ErrorNotice message={error} />
          <div className="compose-address-row">
            <label>
              From
              <select
                value={sender}
                onChange={(e) => setSender(e.target.value)}
                required
              >
                {user.sender_addresses.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <Addresses label="To" values={to} onChange={setTo} required />
          </div>
          {
            <>
              <button
                type="button"
                className="text-button"
                onClick={() => setExtras((v) => !v)}
              >
                {extras ? "Hide" : "Add"} Cc / Bcc
              </button>
              {extras && (
                <>
                  <Addresses label="Cc" values={cc} onChange={setCc} />
                  <Addresses label="Bcc" values={bcc} onChange={setBcc} />
                </>
              )}
            </>
          }
          <label>
            {requestMode ? "Subject (optional)" : "Subject"}
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={180}
              placeholder={
                requestMode
                  ? "e.g. Documents for your application"
                  : "What is this about?"
              }
              required={!requestMode}
            />
          </label>
          {
            <div className="stack compose-delivery-choice">
              <label>
                <input
                  type="checkbox"
                  checked={nophi}
                  disabled={!user.can_nophi}
                  onChange={(e) => {
                    setNophi(e.target.checked);
                    setAcknowledged(false);
                  }}
                />
                Use Nophi: send as normal email
              </label>
              <small>
                {user.can_nophi
                  ? "Only enable this for content suitable for ordinary email."
                  : "Your account does not have permission to use Nophi."}
              </small>
              {nophi && (
                <label>
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(e) => setAcknowledged(e.target.checked)}
                  />
                  I understand that the content and attachments will be emailed
                  and cannot be recalled through the portal.
                </label>
              )}
            </div>
          }
          <label>
            {requestMode ? "Message or document request (optional)" : "Message"}
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              maxLength={100000}
              placeholder={
                requestMode
                  ? "Write a message or describe the documents you need."
                  : "Write your message…"
              }
            />
          </label>
          {serviceReady === false && (
            <div className="notice warning" role="status">
              Service is disabled.
            </div>
          )}
          <fieldset
            disabled={!serviceReady}
            style={{ border: 0, padding: 0, margin: 0 }}
          >
            <Uploads files={files} onChange={setFiles} onBusy={setUploading} />
          </fieldset>
          <div className="form-footer">
            <a className="button" href="#/messages">
              Cancel
            </a>
            <button
              className="primary"
              disabled={
                !serviceReady ||
                !routeFresh ||
                (nophi && !acknowledged) ||
                busy ||
                uploading ||
                !to.length ||
                !!routeError
              }
            >
              {busy
                ? "Saving…"
                : requestMode
                  ? "Start secure conversation"
                  : route?.protected === false
                    ? "Send normal email"
                    : "Send protected"}
              <Icon name="arrow" size={18} />
            </button>
          </div>
        </form>
        <aside className="compose-aside">
          <div className="card">
            <h2>Delivery settings</h2>
            <p>
              {requestMode
                ? "Recipients open an email link and verify their email to reply securely."
                : "Routing is checked again by the server when you send."}
            </p>
            <div className="route-preview">
              <small>DELIVERY ROUTE</small>
              <strong>
                {!routeFresh
                  ? "Checking delivery route…"
                  : route?.protected === false
                    ? route.reason === "explicit_nophi_override"
                      ? "Normal email: Nophi override"
                      : "Normal email"
                    : route?.protected
                      ? "Protected portal"
                      : "Complete message details"}
              </strong>
              <small>
                {route?.reason === "explicit_nophi_override"
                  ? "Nophi override — the actual content will be emailed."
                  : "Content stays in the portal for all recipients; notifications contain a link."}
              </small>
            </div>
            <ErrorNotice message={routeError} />
            <label>
              Recipient access expires
              <select
                value={expiry}
                onChange={(e) => setExpiry(Number(e.target.value))}
                disabled={route?.protected === false}
              >
                <option value={1}>After 1 day</option>
                <option value={7}>After 7 days</option>
                <option value={30}>After 30 days</option>
              </select>
            </label>
            <small>
              Access expiry does not delete retained records or recall
              downloaded files.
            </small>
          </div>
        </aside>
      </div>
    </>
  );
}

export function ThreadContent({
  conversation,
}: {
  conversation: Conversation;
}) {
  const threadRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const pane = threadRef.current?.closest<HTMLElement>(
      ".conversation-stream",
    );
    if (!pane) return;
    let frame = 0;
    const fit = () => {
      const top = Math.max(12, pane.getBoundingClientRect().top);
      pane.style.setProperty("--conversation-pane-top", `${top}px`);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };
    fit();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [conversation.id]);
  const position = useRef({ conversation: "", lastMessage: "", follow: true });
  const lastMessage = conversation.messages?.at(-1)?.id ?? "";
  useEffect(() => {
    const trackPosition = () => {
      const pane = threadRef.current?.closest<HTMLElement>(
        ".conversation-stream",
      );
      const last = threadRef.current?.firstElementChild;
      if (pane && pane.scrollHeight > pane.clientHeight)
        position.current.follow = pane.scrollTop < 160;
      else if (last)
        position.current.follow = last.getBoundingClientRect().top >= -160;
    };
    const sent = (event: Event) => {
      if (
        (event as CustomEvent<{ conversationId: string }>).detail
          .conversationId === conversation.id
      )
        position.current.follow = true;
    };
    window.addEventListener("scroll", trackPosition, {
      passive: true,
      capture: true,
    });
    window.addEventListener("secure-reply-saved", sent);
    return () => {
      window.removeEventListener("scroll", trackPosition, true);
      window.removeEventListener("secure-reply-saved", sent);
    };
  }, [conversation.id]);
  useLayoutEffect(() => {
    const initial = position.current.conversation !== conversation.id;
    const changed = position.current.lastMessage !== lastMessage;
    const follow = initial || (changed && position.current.follow);
    if (!follow) {
      position.current.lastMessage = lastMessage;
      return;
    }
    const frame = requestAnimationFrame(() => {
      position.current.conversation = conversation.id;
      position.current.lastMessage = lastMessage;
      const pane = threadRef.current?.closest<HTMLElement>(
        ".conversation-stream",
      );
      if (pane && getComputedStyle(pane).overflowY === "auto") {
        pane.scrollTop = 0;
        return;
      }
      const target =
        threadRef.current?.querySelector("article:first-of-type") ??
        document.getElementById(`reply-${conversation.id}`);
      target?.scrollIntoView({ block: "start", behavior: "instant" });
    });
    return () => cancelAnimationFrame(frame);
  }, [conversation.id, lastMessage]);
  function chooseReply(messageId: string, mode: "sender" | "all") {
    window.dispatchEvent(
      new CustomEvent("select-secure-reply", {
        detail: { conversationId: conversation.id, messageId, mode },
      }),
    );
    document
      .getElementById(`reply-${conversation.id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const [downloadError, setDownloadError] = useState("");
  const [downloading, setDownloading] = useState<string | null>(null);
  const downloadController = useRef<AbortController | null>(null);
  useEffect(() => () => downloadController.current?.abort(), []);
  async function download(file: FileItem) {
    if (downloadController.current) return;
    const controller = new AbortController();
    downloadController.current = controller;
    setDownloading(file.id);
    setDownloadError("");
    try {
      await downloadAttachment(file.id, file.name, controller.signal);
    } catch (err) {
      if (!controller.signal.aborted) setDownloadError((err as Error).message);
    } finally {
      downloadController.current = null;
      if (!controller.signal.aborted) setDownloading(null);
    }
  }
  return (
    <div className="thread" ref={threadRef}>
      <ErrorNotice message={downloadError} />
      {[...(conversation.messages ?? [])]
        .reverse()
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
        .map((message) => (
          <article
            className={`message-card ${message.headers?.from_email?.toLowerCase() === conversation.viewer_email?.toLowerCase() && conversation.viewer_email ? "message-own" : "message-other"}`}
            key={message.id}
          >
            <div className="message-heading">
              <span className="avatar small">
                {message.author.slice(0, 2).toUpperCase()}
              </span>
              <div className="message-identity">
                <div className="message-author-line">
                  <strong>{message.author}</strong>
                  <time dateTime={message.created_at}>
                    {formatDate(message.created_at)}
                  </time>
                </div>
                {message.audience && <small>Private recipient reply</small>}
                {message.headers && (
                  <details className="mail-details">
                    <summary>
                      Message details
                      {message.headers.cc.includes(
                        conversation.viewer_email ?? "",
                      )
                        ? " · Cc"
                        : message.headers.bcc.includes(
                              conversation.viewer_email ?? "",
                            )
                          ? " · Bcc (private copy)"
                          : ""}
                    </summary>
                    <dl>
                      <dt>From</dt>
                      <dd>
                        {message.headers.from_name} &lt;
                        {message.headers.from_email}
                        &gt;
                      </dd>
                      <dt>To</dt>
                      <dd>{message.headers.to.join(", ") || "—"}</dd>
                      {message.headers.cc.length > 0 && (
                        <>
                          <dt>Cc</dt>
                          <dd>{message.headers.cc.join(", ")}</dd>
                        </>
                      )}
                      {message.headers.bcc.length > 0 && (
                        <>
                          <dt>Bcc</dt>
                          <dd>{message.headers.bcc.join(", ")}</dd>
                        </>
                      )}
                      <dt>Sent</dt>
                      <dd>{formatDate(message.created_at)}</dd>
                    </dl>
                  </details>
                )}
              </div>
              <Badge
                tone={
                  message.author_type === "recipient" ? "success" : "neutral"
                }
              >
                {message.author_type === "recipient" ? "Recipient" : "Staff"}
              </Badge>
            </div>
            <div className="message-body">
              {message.body || (
                <span className="muted">
                  You’re invited to submit information using the form below.
                </span>
              )}
            </div>
            {message.attachments.map((a) => (
              <button
                type="button"
                className="attachment"
                key={a.id}
                disabled={downloading !== null}
                onClick={() => void download(a)}
                aria-label={`Download ${a.name}`}
              >
                <Icon name="file" />
                <span>
                  <strong>{a.name}</strong>
                  <small>
                    {downloading === a.id
                      ? "Downloading…"
                      : a.scan_method === "synthetic-validation-only"
                        ? "Antivirus scan not performed"
                        : a.state}
                  </small>
                </span>
                <Icon name="download" size={18} />
              </button>
            ))}
            <div className="mail-reply-actions">
              {message.headers?.from_email !== conversation.viewer_email && (
                <button
                  type="button"
                  className="message-reply-button"
                  aria-label="Reply to sender"
                  title="Reply to sender"
                  onClick={() => chooseReply(message.id, "sender")}
                >
                  <Icon name="reply" size={18} />
                </button>
              )}
              {conversation.can_reply_all && (
                <button
                  type="button"
                  className="message-reply-button"
                  aria-label="Reply all"
                  title="Reply all"
                  onClick={() => chooseReply(message.id, "all")}
                >
                  <Icon name="reply-all" size={18} />
                </button>
              )}
            </div>
          </article>
        ))}
    </div>
  );
}

export function ReplyForm({
  conversation,
  recipientMode = false,
  onSent,
  draft,
  onDraftChange,
  headerLauncher = false,
  onExpandedChange,
}: {
  conversation: Conversation;
  recipientMode?: boolean;
  headerLauncher?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  onSent: () => void;
  draft?: { body: string; files: FileItem[] };
  onDraftChange?: (value: { body: string; files: FileItem[] }) => void;
}) {
  const serviceReady = useDocumentService();
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    onExpandedChange?.(expanded);
  }, [expanded, onExpandedChange]);
  useEffect(() => {
    const open = (event: Event) => {
      if (
        (event as CustomEvent<{ conversationId: string }>).detail
          .conversationId === conversation.id
      )
        setExpanded(true);
    };
    window.addEventListener("open-secure-composer", open);
    return () => window.removeEventListener("open-secure-composer", open);
  }, [conversation.id]);
  const composerRef = useRef<HTMLFormElement>(null);
  useLayoutEffect(() => {
    if (!expanded) return;
    composerRef.current?.scrollIntoView({ block: "nearest" });
    composerRef.current
      ?.querySelector("textarea")
      ?.focus({ preventScroll: true });
  }, [expanded]);
  const [body, setBody] = useState(draft?.body ?? "");
  const [files, setFiles] = useState<FileItem[]>(draft?.files ?? []);
  useEffect(() => {
    onDraftChange?.({ body, files });
  }, [body, files, onDraftChange]);
  const [audience, setAudience] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [replyMode, setReplyMode] = useState<"sender" | "all">(
    !recipientMode && conversation.can_reply_all ? "all" : "sender",
  );
  useEffect(() => {
    function selected(event: Event) {
      const detail = (
        event as CustomEvent<{
          conversationId: string;
          messageId: string;
          mode: "sender" | "all";
        }>
      ).detail;
      if (detail.conversationId !== conversation.id) return;
      setExpanded(true);
      setReplyTo(detail.messageId);
      setReplyMode(detail.mode);
      setAudience("");
    }
    window.addEventListener("select-secure-reply", selected);
    return () => window.removeEventListener("select-secure-reply", selected);
  }, [conversation.id]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const submission = useRef({ signature: "", key: crypto.randomUUID() });
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!serviceReady) {
      setError(
        serviceReady === null
          ? "Checking service availability. Please wait."
          : "Service is disabled.",
      );
      return;
    }
    setBusy(true);
    setError("");
    setSuccess("");
    const data = {
      body,
      reply_mode: replyMode,
      ...(replyTo ? { reply_to: replyTo } : {}),
      attachments: files.map((f) => f.id),
      ...(audience ? { audience } : {}),
    };
    const signature = JSON.stringify(data);
    if (submission.current.signature !== signature)
      submission.current = { signature, key: crypto.randomUUID() };
    try {
      await post(
        recipientMode
          ? "/recipient/conversation"
          : `/conversations/${conversation.id}/messages`,
        data,
        submission.current.key,
      );
      setBody("");
      setFiles([]);
      submission.current = { signature: "", key: crypto.randomUUID() };
      setSuccess("Reply saved. Notification queued.");
      window.dispatchEvent(
        new CustomEvent("secure-reply-saved", {
          detail: { conversationId: conversation.id },
        }),
      );
      onSent();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function closeComposer() {
    setExpanded(false);
    requestAnimationFrame(() => {
      const button = headerLauncher
        ? document.querySelector<HTMLButtonElement>(".conversation-new-message")
        : document
            .getElementById(`reply-${conversation.id}`)
            ?.querySelector<HTMLButtonElement>(".new-message-action button");
      button?.focus({ preventScroll: true });
    });
  }
  return (
    <div id={`reply-${conversation.id}`} className="reply-slot">
      {!expanded && !headerLauncher && (
        <div className="new-message-action">
          <button
            type="button"
            className="primary"
            aria-expanded={false}
            onClick={() => setExpanded(true)}
          >
            <Icon name="plus" size={18} /> New message
          </button>
        </div>
      )}
      <div hidden={!expanded}>
        <form
          ref={composerRef}
          className="card stack reply-composer"
          onSubmit={submit}
        >
          <div>
            <div className="reply-title-row">
              <button
                type="button"
                className="icon-button"
                title="Back to conversation"
                aria-label="Back to conversation"
                disabled={busy}
                onClick={closeComposer}
              >
                <Icon name="back" size={18} />
              </button>
              <h2>
                {recipientMode ? "Your response" : "Reply in this conversation"}
              </h2>
            </div>
            <p>
              {recipientMode
                ? replyMode === "all"
                  ? "Your response will be visible to the sender and the To/Cc participants. Bcc copies are excluded."
                  : "Your response goes only to the selected sender (or the assigned staff if no message is selected)."
                : "This reply will stay in the protected portal."}
            </p>
          </div>
          <ErrorNotice message={error} />
          {success && (
            <div className="notice success" role="status">
              {success}
            </div>
          )}
          {conversation.can_reply_all && (
            <label className="reply-mode-control">
              Reply mode
              <select
                value={replyMode}
                onChange={(e) => {
                  setReplyMode(e.target.value as "sender" | "all");
                  setAudience("");
                }}
              >
                <option value="sender">Reply to sender only</option>
                <option value="all">Reply all — sender and To/Cc</option>
              </select>
            </label>
          )}
          {replyTo && (
            <p className="muted">
              Replying to{" "}
              {conversation.messages?.find((m) => m.id === replyTo)?.headers
                ?.from_email || "the selected message"}
              .
            </p>
          )}
          {!recipientMode &&
            replyMode === "sender" &&
            conversation.recipients?.length > 1 && (
              <label>
                Reply visibility
                <select
                  value={audience}
                  onChange={(e) => {
                    setAudience(e.target.value);
                    setReplyTo("");
                  }}
                >
                  <option value="">
                    Choose a recipient or select a message above
                  </option>
                  {conversation.recipients
                    .filter((g) => !g.revoked)
                    .map((g) => (
                      <option key={g.id} value={g.id}>
                        Only {g.email}
                      </option>
                    ))}
                </select>
              </label>
            )}
          <label>
            Message
            <textarea
              aria-label="Message"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              maxLength={100000}
              placeholder="Write your response…"
            />
          </label>
          {serviceReady === false && (
            <div className="notice warning" role="status">
              Service is disabled.
            </div>
          )}
          <fieldset
            disabled={!serviceReady}
            style={{ border: 0, padding: 0, margin: 0 }}
          >
            <Uploads
              files={files}
              onChange={(next) => {
                setFiles(next);
                onDraftChange?.({ body, files: next });
              }}
              recipient={recipientMode}
              onBusy={setUploading}
            />
          </fieldset>
          <div className="form-footer">
            <small>
              <Icon name="lock" size={14} />
              Submitted through the portal
            </small>
            <div className="reply-footer-actions">
              <button type="button" disabled={busy} onClick={closeComposer}>
                Cancel
              </button>
              <button
                className="primary"
                disabled={
                  !serviceReady ||
                  busy ||
                  uploading ||
                  (!body.trim() && !files.length)
                }
              >
                {busy ? "Saving…" : "Submit reply"}
                <Icon name="arrow" size={18} />
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

export function MailDetail({ id }: { id: string }) {
  const [refresh, setRefresh] = useState(0);
  const [composerOpen, setComposerOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const resource = useResource<Conversation>(
    "/conversations/" + id,
    refresh,
    true,
  );
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const revokeKey = useRef({ target: "", key: crypto.randomUUID() });
  async function revokeAccess() {
    if (revokeKey.current.target !== revokeTarget)
      revokeKey.current = {
        target: revokeTarget || "",
        key: crypto.randomUUID(),
      };
    setBusy(true);
    setError("");
    try {
      await post(
        `/conversations/${id}/revoke`,
        revokeTarget === "all" ? {} : { grant_id: revokeTarget },
        revokeKey.current.key,
      );
      setRevokeTarget(null);
      setRefresh((v) => v + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (resource.loading && !resource.data) return <Loading />;
  if (!resource.data)
    return (
      <ErrorNotice message={resource.error || "Conversation unavailable."} />
    );
  const c = resource.data;
  const closed = c.revoked || new Date(c.expires_at) <= new Date();
  const deliveries = c.delivery ?? [];
  const attention = deliveries.filter((d) =>
    ["failed", "uncertain"].includes(d.state),
  );
  const history = deliveries.filter(
    (d) => !["failed", "uncertain"].includes(d.state),
  );
  const accepted = deliveries.filter(
    (d) => d.state === "provider_accepted",
  ).length;
  const pendingDelivery = deliveries.filter((d) =>
    ["queued", "retry", "sending"].includes(d.state),
  ).length;

  return (
    <>
      <header className="conversation-header">
        <a
          className="conversation-back"
          href="#/messages"
          aria-label="All conversations"
          title="All conversations"
        >
          <Icon name="back" size={18} />
        </a>
        <div className="conversation-heading">
          <h1>{c.subject}</h1>
          <p>
            <Icon name="clock" size={13} />
            <time dateTime={c.created_at}>
              Created {formatDate(c.created_at)}
            </time>
          </p>
        </div>
        <Badge tone={c.protected ? "success" : "neutral"}>
          <Icon name={c.protected ? "shield" : "mail"} size={14} />
          {c.protected ? "Protected portal" : "Normal email"}
        </Badge>
        {c.protected && !closed && !composerOpen && (
          <button
            type="button"
            className="primary conversation-new-message"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("open-secure-composer", {
                  detail: { conversationId: c.id },
                }),
              )
            }
          >
            <Icon name="plus" size={18} /> New message
          </button>
        )}
        <button
          type="button"
          className="icon-button conversation-actions-button"
          aria-label="Conversation actions"
          title="Conversation actions"
          aria-haspopup="dialog"
          onClick={() => setActionsOpen(true)}
        >
          <Icon name="more" size={20} />
        </button>
      </header>
      <ErrorNotice message={resource.error} />
      <div className="thread-layout conversation-main">
        <div
          className="conversation-stream"
          role="region"
          aria-label="Conversation messages and reply"
          tabIndex={0}
        >
          {c.protected && !closed ? (
            <ReplyForm
              conversation={c}
              headerLauncher
              onExpandedChange={setComposerOpen}
              onSent={() => setRefresh((v) => v + 1)}
            />
          ) : (
            <div className="notice">
              {closed
                ? "Recipient access has ended. Retained records remain subject to the retention policy."
                : "Normal email was queued through the email provider. Portal expiry and recall do not apply."}
            </div>
          )}
          <ThreadContent conversation={c} />
        </div>
      </div>
      {actionsOpen && (
        <Modal
          title="Conversation actions"
          onClose={() => setActionsOpen(false)}
        >
          <aside
            className="conversation-details conversation-actions-grid"
            aria-label="Conversation details"
            tabIndex={0}
          >
            <section className="card">
              <h2>Access details</h2>
              <Badge tone={closed ? "danger" : "success"}>
                {closed ? "Access ended" : "Active"}
              </Badge>
              <dl>
                <dt>Expires</dt>
                <dd>{formatDate(c.expires_at)}</dd>
                <dt>Delivery</dt>
                <dd>{c.protected ? "Secure portal" : "Normal email"}</dd>
              </dl>
              {c.protected && !closed && (
                <button
                  className="danger-button full"
                  onClick={() => setRevokeTarget("all")}
                >
                  Revoke all recipient access
                </button>
              )}
            </section>
            <section className="card">
              <h2>Recipients</h2>
              {c.recipients.map((g) => (
                <div className="grant-row" key={g.id}>
                  <strong>{g.email}</strong>
                  <small>
                    {g.kind.toUpperCase()} ·{" "}
                    {g.revoked
                      ? "Revoked"
                      : g.last_opened
                        ? `Opened ${formatDate(g.last_opened)}`
                        : "Not yet opened"}
                  </small>
                  {c.protected && !closed && !g.revoked && (
                    <button
                      className="text-button"
                      onClick={() => setRevokeTarget(g.id)}
                    >
                      Revoke access
                    </button>
                  )}
                </div>
              ))}
            </section>
            <section className="card">
              <h2>Notification delivery</h2>
              <div
                className="delivery-summary"
                aria-label="Notification summary"
              >
                <span>
                  <strong>{accepted}</strong> Provider accepted
                </span>
                {pendingDelivery > 0 && (
                  <span>
                    <strong>{pendingDelivery}</strong> Pending
                  </span>
                )}
                {attention.length > 0 && (
                  <span className="error-text">
                    <strong>{attention.length}</strong> Need attention
                  </span>
                )}
              </div>
              {!deliveries.length && (
                <p className="muted">No notifications yet.</p>
              )}
              <div className="delivery-attention">
                {attention.map((d) => (
                  <div className="delivery-row" key={d.id}>
                    <Badge
                      tone={
                        ["failed", "uncertain"].includes(d.state)
                          ? "warning"
                          : "neutral"
                      }
                    >
                      {d.state === "development_delivered"
                        ? "Not emailed — local capture only"
                        : d.state.replaceAll("_", " ")}
                    </Badge>
                    <small>
                      {d.attempts} attempt{d.attempts !== 1 ? "s" : ""}
                      {d.error_code
                        ? ` · ${d.error_code.replaceAll("_", " ")}`
                        : ""}
                    </small>
                    {["failed", "uncertain"].includes(d.state) && (
                      <DeliveryRetry
                        id={d.id}
                        onRetried={() => setRefresh((v) => v + 1)}
                      />
                    )}
                  </div>
                ))}
              </div>
              {history.length > 0 && (
                <details className="delivery-history">
                  <summary>Notification history ({history.length})</summary>
                  <ol>
                    {history.map((d) => (
                      <li key={d.id}>
                        <span>
                          {d.state === "development_delivered"
                            ? "Not emailed — local capture only"
                            : d.state.replaceAll("_", " ")}
                        </span>
                        <small>
                          {d.attempts} attempt{d.attempts !== 1 ? "s" : ""}
                        </small>
                      </li>
                    ))}
                  </ol>
                </details>
              )}
              <small>
                Provider acceptance does not prove delivery or reading.
              </small>
              <button
                className="text-button"
                disabled={resource.loading}
                onClick={() => setRefresh((v) => v + 1)}
              >
                {resource.loading ? "Refreshing status…" : "Refresh status"}
              </button>
            </section>
          </aside>
        </Modal>
      )}
      {revokeTarget && (
        <Modal
          title="Revoke recipient access?"
          onClose={() => setRevokeTarget(null)}
        >
          <p>
            Future views, replies and downloads will be denied. Previously
            downloaded copies cannot be recalled.
          </p>
          <ErrorNotice message={error} />
          <div className="form-footer">
            <button onClick={() => setRevokeTarget(null)}>Cancel</button>
            <button
              className="danger-button"
              onClick={() => void revokeAccess()}
              disabled={busy}
            >
              Revoke access
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
