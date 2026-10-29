import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  api,
  apiBase,
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
          <>
            <a className="button secondary" href="#/compose">
              <Icon name="plus" size={18} />
              New message
            </a>
            <a className="button primary" href="#/request">
              <Icon name="shield" size={18} />
              Request information
            </a>
          </>
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
            <small>In your assigned workspace</small>
          </div>
        ))}
      </div>
      {!!stats.data?.delivery_attention && (
        <div className="notice warning">
          {stats.data.delivery_attention} delivery jobs need attention. Open the
          relevant conversation to review.
        </div>
      )}
      <section className="card flush">
        <div className="list-toolbar">
          <div className="segmented">
            <button
              className={!state ? "selected" : ""}
              onClick={() => {
                setState("");
                setPage(1);
              }}
            >
              All conversations
            </button>
            <button
              className={state === "replied" ? "selected" : ""}
              onClick={() => {
                setState("replied");
                setPage(1);
              }}
            >
              Replied
            </button>
            <button
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
                aria-label="Search recipient or status"
                placeholder="Search recipient or status"
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
                      <span className="unread-dot" aria-label="Unread" />
                    )}
                  </div>
                  <p>{c.recipients.map((r) => r.email).join(", ")}</p>
                  <small>
                    {c.mode === "secure_request"
                      ? "Information request"
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
              q ? "No matching conversations" : "Your conversations start here"
            }
          >
            {q
              ? "Try another recipient or clear your filters."
              : "Send a message or request documents. Your protected exchanges will appear here."}
          </Empty>
        )}
        {resource.data && (
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
    <div>
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
          onChange={(e) => setDraft(e.target.value)}
          onBlur={add}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "," || e.key === ";") {
              e.preventDefault();
              add();
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

export function Compose({
  user,
  requestMode,
}: {
  user: User;
  requestMode: boolean;
}) {
  const serviceReady = useDocumentService();
  const [to, setTo] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [bcc, setBcc] = useState<string[]>([]);
  const [extras, setExtras] = useState(false);
  const [sender, setSender] = useState(user.sender_addresses[0] ?? "");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
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
    mode: requestMode ? "secure_request" : "ordinary",
  };
  const signature = JSON.stringify(payload);
  const debounced = useDebounced(signature);
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
        if (!controller.signal.aborted) setRoute(value);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setRoute(null);
          setRouteError((err as Error).message);
        }
      });
    return () => controller.abort();
  }, [debounced, requestMode, to.length]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!serviceReady) {
      setError("Service is disabled.");
      return;
    }
    setBusy(true);
    setError("");
    if (submission.current.signature !== signature)
      submission.current = { signature, key: crypto.randomUUID() };
    try {
      const result = await post<{ id: string }>(
        "/conversations",
        payload,
        submission.current.key,
      );
      window.location.hash = "/messages/" + result.id;
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="START A CONVERSATION"
        title={requestMode ? "Request secure information" : "New message"}
        description={
          requestMode
            ? "Give your recipient a private place to send the documents you need."
            : "Compose your message. We’ll show the delivery route before you send."
        }
      />
      <div className="compose-layout">
        <form onSubmit={submit} className="card stack">
          <ErrorNotice message={error} />
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
          {!requestMode && (
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
          )}
          <label>
            {requestMode ? "Request title (optional)" : "Subject"}
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
          <label>
            {requestMode ? "Instructions (optional)" : "Message"}
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              maxLength={100000}
              placeholder={
                requestMode
                  ? "Let your recipient know what to provide. You can also leave this blank."
                  : "Write your message…"
              }
            />
          </label>
          {!serviceReady && (
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
                !serviceReady || busy || uploading || !to.length || !!routeError
              }
            >
              {busy
                ? "Saving…"
                : requestMode
                  ? "Send secure request"
                  : route?.protected === false
                    ? "Send normal email"
                    : "Send protected"}
              <Icon name="arrow" size={18} />
            </button>
          </div>
        </form>
        <aside className="compose-aside">
          <div className="card">
            <span className="icon-tile">
              <Icon name="shield" size={26} />
            </span>
            <h2>
              {requestMode
                ? "A simple, protected exchange"
                : "Delivery details"}
            </h2>
            <p>
              {requestMode
                ? "Your recipient receives a notification, verifies their email, and replies in the portal. No account needed."
                : "Routing is checked again by the server when you send."}
            </p>
            <div className="route-preview">
              <small>DELIVERY ROUTE</small>
              <strong>
                {route?.protected === false
                  ? "Normal email"
                  : route?.protected
                    ? "Protected portal"
                    : "Complete message details"}
              </strong>
              <small>
                {route?.reason === "explicit_nophi_override"
                  ? "Nophi override — the actual content will be emailed."
                  : route?.reason === "internal_only"
                    ? "All recipients are internal."
                    : "Content stays in the portal; notifications contain a link."}
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
  return (
    <div className="thread">
      {conversation.messages?.map((message) => (
        <article
          className={`message-card ${message.author_type === "recipient" ? "received" : ""}`}
          key={message.id}
        >
          <div className="message-heading">
            <span className="avatar small">
              {message.author.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <strong>{message.author}</strong>
              <small>
                {formatDate(message.created_at)}
                {message.audience ? " · Private recipient reply" : ""}
              </small>
            </div>
            <Badge
              tone={message.author_type === "recipient" ? "success" : "neutral"}
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
            <a
              className="attachment"
              key={a.id}
              href={`${apiBase}/attachments/${a.id}`}
            >
              <Icon name="file" />
              <span>
                <strong>{a.name}</strong>
                <small>
                  {a.scan_method === "synthetic-validation-only"
                    ? "Antivirus scan not performed"
                    : a.state}
                </small>
              </span>
              <Icon name="download" size={18} />
            </a>
          ))}
        </article>
      ))}
    </div>
  );
}

export function ReplyForm({
  conversation,
  recipientMode = false,
  onSent,
}: {
  conversation: Conversation;
  recipientMode?: boolean;
  onSent: () => void;
}) {
  const serviceReady = useDocumentService();
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [audience, setAudience] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const submission = useRef({ signature: "", key: crypto.randomUUID() });
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!serviceReady) {
      setError("Service is disabled.");
      return;
    }
    setBusy(true);
    setError("");
    setSuccess("");
    const data = {
      body,
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
      setSuccess("Reply saved. Notification queued.");
      onSent();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="card stack" onSubmit={submit}>
      <div>
        <h2>
          {recipientMode ? "Your response" : "Reply in this conversation"}
        </h2>
        <p>
          {recipientMode
            ? "Add a message, upload documents, or both. Your response is private to the assigned staff."
            : "This reply will stay in the protected portal."}
        </p>
      </div>
      <ErrorNotice message={error} />
      {success && (
        <div className="notice success" role="status">
          {success}
        </div>
      )}
      {!recipientMode && conversation.recipients?.length > 1 && (
        <label>
          Reply visibility
          <select
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
          >
            <option value="">All permitted recipients</option>
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
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          maxLength={100000}
          placeholder="Write your response…"
        />
      </label>
      {!serviceReady && (
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
          onChange={setFiles}
          recipient={recipientMode}
          onBusy={setUploading}
        />
      </fieldset>
      <div className="form-footer">
        <small>
          <Icon name="lock" size={14} />
          Submitted through the portal
        </small>
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
    </form>
  );
}

export function MailDetail({ id }: { id: string }) {
  const [refresh, setRefresh] = useState(0);
  const resource = useResource<Conversation>("/conversations/" + id, refresh);
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function revokeAccess() {
    setBusy(true);
    setError("");
    try {
      await post(
        `/conversations/${id}/revoke`,
        revokeTarget === "all" ? {} : { grant_id: revokeTarget },
      );
      setRevokeTarget(null);
      setRefresh((v) => v + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (resource.loading) return <Loading />;
  if (!resource.data)
    return (
      <ErrorNotice message={resource.error || "Conversation unavailable."} />
    );
  const c = resource.data;
  const closed = c.revoked || new Date(c.expires_at) <= new Date();
  return (
    <>
      <a className="back-link" href="#/messages">
        ← All conversations
      </a>
      <PageHeader
        eyebrow={
          c.mode === "secure_request" ? "INFORMATION REQUEST" : "CONVERSATION"
        }
        title={c.subject}
        description={`Created ${formatDate(c.created_at)}`}
        actions={
          <Badge tone={c.protected ? "success" : "neutral"}>
            {c.protected ? "Protected portal" : "Normal email"}
          </Badge>
        }
      />
      <div className="thread-layout">
        <div>
          <ThreadContent conversation={c} />
          {c.protected && !closed ? (
            <ReplyForm
              conversation={c}
              onSent={() => setRefresh((v) => v + 1)}
            />
          ) : (
            <div className="notice">
              {closed
                ? "Recipient access has ended. Retained records remain subject to the retention policy."
                : "Normal email was queued through the email provider. Portal expiry and recall do not apply."}
            </div>
          )}
        </div>
        <aside className="stack">
          <section className="card">
            <h2>Access details</h2>
            <Badge tone={closed ? "danger" : "success"}>
              {closed ? "Access ended" : "Active"}
            </Badge>
            <dl>
              <dt>Expires</dt>
              <dd>{formatDate(c.expires_at)}</dd>
              <dt>Routing reason</dt>
              <dd>{c.routing_reason.replaceAll("_", " ")}</dd>
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
            {c.delivery?.map((d) => (
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
            <small>
              Provider acceptance does not prove delivery or reading.
            </small>
            <button
              className="text-button"
              onClick={() => setRefresh((v) => v + 1)}
            >
              Refresh status
            </button>
          </section>
        </aside>
      </div>
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
