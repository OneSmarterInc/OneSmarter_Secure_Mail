import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ApiError,
  api,
  bytes,
  formatDate,
  post,
  query,
  useDebounced,
  useResource,
} from "../api";
import type { Account, AuditEvent, AuditPage, Page, User } from "../types";
import {
  Badge,
  Empty,
  ErrorNotice,
  Icon,
  Loading,
  Modal,
  PageHeader,
  Pagination,
  SortHeader,
  StepUp,
} from "../components/ui";

export function AccessTabs({ current }: { current: string }) {
  return (
    <nav className="tabs" aria-label="Access pages">
      <a
        className={current === "accounts" ? "active" : ""}
        href="#/access/accounts"
      >
        Accounts
      </a>
      <a className={current === "audit" ? "active" : ""} href="#/access/audit">
        Audit logs
      </a>
    </nav>
  );
}

export function Accounts({ user }: { user: User }) {
  const [q, setQ] = useState("");
  const search = useDebounced(q);
  const [status, setStatus] = useState("");
  const [role, setRole] = useState("");
  const [mfa, setMfa] = useState("");
  const [nophi, setNophi] = useState("");
  const [days, setDays] = useState(30);
  const [sort, setSort] = useState("-created_at");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [refresh, setRefresh] = useState(0);
  const [create, setCreate] = useState(false);
  const [selected, setSelected] = useState<Account | null>(null);
  const resource = useResource<Page<Account> & { updated_at: string }>(
    "/admin/accounts" +
      query({
        q: search,
        status,
        role,
        mfa_confirmed: mfa,
        can_nophi: nophi,
        days,
        sort,
        page,
        page_size: size,
      }),
    refresh,
  );
  const reset = () => {
    setQ("");
    setStatus("");
    setRole("");
    setMfa("");
    setNophi("");
    setPage(1);
  };
  return (
    <>
      <PageHeader
        eyebrow="ACCESS MANAGEMENT"
        title="Staff accounts"
        description="Manage who can access your workspace and what they can do."
        actions={
          <button className="primary" onClick={() => setCreate(true)}>
            <Icon name="plus" size={18} />
            Create account
          </button>
        }
      />
      <AccessTabs current="accounts" />
      <section className="card flush">
        <div className="list-toolbar">
          <label className="search wide">
            <Icon name="search" size={18} />
            <input
              aria-label="Search accounts"
              value={q}
              placeholder="Search by name, email or account ID"
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <div className="toolbar-end">
            <label className="inline-label">
              Usage period
              <select
                value={days}
                onChange={(e) => {
                  setDays(Number(e.target.value));
                  setPage(1);
                }}
              >
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
                <option value={90}>Last 90 days</option>
              </select>
            </label>
            <button onClick={() => setRefresh((v) => v + 1)}>Refresh</button>
          </div>
        </div>
        <div className="filter-bar">
          <select
            aria-label="Account status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {["invited", "active", "suspended", "deactivated"].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <select
            aria-label="Account role"
            value={role}
            onChange={(e) => {
              setRole(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All roles</option>
            <option value="admin">Administrator</option>
            <option value="staff">Staff</option>
          </select>
          <select
            aria-label="MFA enrollment"
            value={mfa}
            onChange={(e) => {
              setMfa(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All MFA states</option>
            <option value="true">MFA enrolled</option>
            <option value="false">Enrollment pending</option>
          </select>
          <select
            aria-label="Nophi permission"
            value={nophi}
            onChange={(e) => {
              setNophi(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All Nophi permissions</option>
            <option value="true">Nophi permitted</option>
            <option value="false">Nophi not permitted</option>
          </select>
          <button className="text-button" onClick={reset}>
            Clear filters
          </button>
        </div>
        <ErrorNotice message={resource.error} />
        {resource.loading ? (
          <Loading />
        ) : resource.data?.results.length ? (
          <div className="table-container">
            <table className="data-table accounts-table">
              <caption className="sr-only">
                Staff accounts in your organization
              </caption>
              <thead>
                <tr>
                  <SortHeader
                    label="Name / email"
                    field="name"
                    sort={sort}
                    onSort={(v) => {
                      setSort(v);
                      setPage(1);
                    }}
                  />
                  <SortHeader
                    label="Role"
                    field="role"
                    sort={sort}
                    onSort={(v) => {
                      setSort(v);
                      setPage(1);
                    }}
                  />
                  <SortHeader
                    label="Status"
                    field="status"
                    sort={sort}
                    onSort={(v) => {
                      setSort(v);
                      setPage(1);
                    }}
                  />
                  <th scope="col">MFA</th>
                  <SortHeader
                    label="Last login"
                    field="last_login"
                    sort={sort}
                    onSort={(v) => {
                      setSort(v);
                      setPage(1);
                    }}
                  />
                  <th scope="col">Usage · {days}d</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {resource.data.results.map((a) => (
                  <tr key={a.id}>
                    <td data-label="Account">
                      <button
                        className="account-name text-button"
                        onClick={() => setSelected(a)}
                      >
                        <span className="avatar small">
                          {a.name.slice(0, 2).toUpperCase()}
                        </span>
                        <span>
                          <strong>{a.name}</strong>
                          <small>{a.email}</small>
                        </span>
                      </button>
                    </td>
                    <td data-label="Role">
                      {a.role === "admin" ? "Administrator" : "Staff"}
                    </td>
                    <td data-label="Status">
                      <Badge
                        tone={
                          a.status === "active"
                            ? "success"
                            : a.status === "invited"
                              ? "warning"
                              : "neutral"
                        }
                      >
                        {a.status}
                      </Badge>
                    </td>
                    <td data-label="MFA">
                      <span
                        className={a.mfa_confirmed ? "success-text" : "muted"}
                      >
                        {a.mfa_confirmed ? "✓ Enrolled" : "Pending"}
                      </span>
                    </td>
                    <td data-label="Last login">
                      <span className="nowrap">{formatDate(a.last_login)}</span>
                    </td>
                    <td data-label="Usage">
                      <strong>
                        {(a.usage.secure_requests ?? 0) +
                          (a.usage.protected_messages ?? 0) +
                          (a.usage.normal_messages ?? 0)}{" "}
                        sends
                      </strong>
                      <small>
                        {bytes(a.usage.retained_bytes ?? 0)} retained
                      </small>
                    </td>
                    <td data-label="Actions">
                      <button
                        className="small-button"
                        onClick={() => setSelected(a)}
                        aria-label={`Manage ${a.name}`}
                      >
                        Manage →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No matching accounts">
            Change your filters or create a staff account.
          </Empty>
        )}
        {resource.data && (
          <Pagination
            count={resource.data.count}
            page={page}
            size={size}
            onPage={setPage}
            onSize={(v) => {
              setSize(v);
              setPage(1);
            }}
          />
        )}
      </section>
      <div className="quiet-note">
        <Icon name="clock" size={16} />
        Last login includes completed MFA. Usage counts unique actions, not
        delivery retries. Updated {formatDate(resource.data?.updated_at)}.
      </div>
      {create && (
        <Modal title="Create staff account" onClose={() => setCreate(false)}>
          <CreateAccount
            user={user}
            onDone={() => {
              setCreate(false);
              setRefresh((v) => v + 1);
            }}
          />
        </Modal>
      )}
      {selected && (
        <Modal title="Account details" onClose={() => setSelected(null)}>
          <AccountDetails
            account={selected}
            user={user}
            onDone={() => {
              setSelected(null);
              setRefresh((v) => v + 1);
            }}
          />
        </Modal>
      )}
    </>
  );
}

function CreateAccount({ user, onDone }: { user: User; onDone: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("staff");
  const [nophi, setNophi] = useState(false);
  const [manage, setManage] = useState(false);
  const [exportAudit, setExportAudit] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [stepUp, setStepUp] = useState(false);
  const submission = useRef({ key: crypto.randomUUID(), signature: "" });
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const data = {
      name,
      email,
      role,
      can_nophi: nophi,
      can_manage_privileges: manage,
      can_export_audit: exportAudit,
    };
    const signature = JSON.stringify(data);
    if (submission.current.signature !== signature)
      submission.current = { signature, key: crypto.randomUUID() };
    try {
      await post("/admin/accounts", data, submission.current.key);
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.code === "step_up_required")
        setStepUp(true);
      else setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (stepUp) return <StepUp onDone={() => setStepUp(false)} />;
  return (
    <form className="stack" onSubmit={submit}>
      <p>
        The employee receives a single-use invitation to choose a password and
        enroll MFA. No password is shared with administrators.
      </p>
      <label>
        Full name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={160}
          required
        />
      </label>
      <label>
        Company email
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </label>
      {user.can_manage_privileges && (
        <>
          <label>
            Role
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="staff">Staff</option>
              <option value="admin">Administrator</option>
            </select>
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={nophi}
              onChange={(e) => setNophi(e.target.checked)}
            />
            Allow Nophi normal-email override
          </label>
          {role === "admin" && (
            <>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={manage}
                  onChange={(e) => setManage(e.target.checked)}
                />
                Allow privilege management
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={exportAudit}
                  onChange={(e) => setExportAudit(e.target.checked)}
                />
                Allow audit exports
              </label>
            </>
          )}
        </>
      )}
      <ErrorNotice message={error} />
      <button className="primary full" disabled={busy}>
        {busy ? "Creating…" : "Create account & queue invitation"}
      </button>
    </form>
  );
}

function AccountDetails({
  account,
  user,
  onDone,
}: {
  account: Account;
  user: User;
  onDone: () => void;
}) {
  const [action, setAction] = useState("");
  const [reason, setReason] = useState("");
  const [name, setName] = useState(account.name);
  const [role, setRole] = useState(account.role);
  const [nophi, setNophi] = useState(account.can_nophi);
  const [privileges, setPrivileges] = useState(account.can_manage_privileges);
  const [exportAudit, setExportAudit] = useState(account.can_export_audit);
  const [senders, setSenders] = useState(account.sender_addresses.join(", "));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stepUp, setStepUp] = useState(false);
  const actions = [
    { value: "edit", label: "Edit display name" },
    ...(user.can_manage_privileges
      ? [{ value: "permissions", label: "Manage roles and permissions" }]
      : []),
    ...(account.status === "invited"
      ? [
          { value: "resend", label: "Resend invitation" },
          { value: "cancel_invitation", label: "Cancel invitation" },
        ]
      : []),
    ...(account.status === "active"
      ? [
          { value: "suspend", label: "Suspend account" },
          { value: "recovery", label: "Send password recovery invitation" },
          ...(user.can_manage_privileges && user.id !== account.id
            ? [
                {
                  value: "reset_mfa",
                  label: "Reset MFA (identity verification required)",
                },
              ]
            : []),
          { value: "revoke_sessions", label: "Revoke sessions" },
        ]
      : []),
    ...(["suspended", "deactivated"].includes(account.status)
      ? [{ value: "reactivate", label: "Reactivate account" }]
      : []),
    ...(account.status !== "deactivated"
      ? [{ value: "deactivate", label: "Deactivate account" }]
      : []),
  ];
  const actionKey = useRef({ signature: "", key: crypto.randomUUID() });
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = {
        action,
        reason,
        ...(action === "edit" ? { name } : {}),
        ...(action === "permissions"
          ? {
              role,
              can_nophi: nophi,
              can_manage_privileges: privileges,
              can_export_audit: exportAudit,
              sender_addresses: senders
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean),
            }
          : {}),
      };
      const signature = JSON.stringify(data);
      if (actionKey.current.signature !== signature)
        actionKey.current = { signature, key: crypto.randomUUID() };
      await post(`/admin/accounts/${account.id}`, data, actionKey.current.key);
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.code === "step_up_required")
        setStepUp(true);
      else setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (stepUp) return <StepUp onDone={() => setStepUp(false)} />;
  return (
    <div className="stack">
      <div className="account-identity">
        <span className="avatar">{account.name.slice(0, 2).toUpperCase()}</span>
        <div>
          <h3>{account.name}</h3>
          <p>{account.email}</p>
        </div>
        <Badge tone={account.status === "active" ? "success" : "neutral"}>
          {account.status}
        </Badge>
      </div>
      <dl className="detail-grid">
        <div>
          <dt>Created</dt>
          <dd>{formatDate(account.created_at)}</dd>
        </div>
        <div>
          <dt>Last successful login</dt>
          <dd>{formatDate(account.last_login)}</dd>
        </div>
        <div>
          <dt>Last activity</dt>
          <dd>{formatDate(account.last_activity)}</dd>
        </div>
        <div>
          <dt>MFA</dt>
          <dd>{account.mfa_confirmed ? "Enrolled" : "Enrollment pending"}</dd>
        </div>
      </dl>
      <details>
        <summary>Usage details</summary>
        <dl className="detail-grid">
          {Object.entries(account.usage).map(([key, value]) => (
            <div key={key}>
              <dt>{key.replaceAll("_", " ")}</dt>
              <dd>{key.includes("bytes") ? bytes(value) : value}</dd>
            </div>
          ))}
        </dl>
      </details>
      <a
        className="text-button"
        href={`#/access/audit?actor=${account.id}`}
        onClick={onDone}
      >
        View this account’s audit history →
      </a>
      <hr />
      <form className="stack" onSubmit={submit}>
        <label>
          Account action
          <select
            value={action}
            onChange={(e) => setAction(e.target.value)}
            required
          >
            <option value="">Choose an action</option>
            {actions.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        {action === "edit" && (
          <label>
            Display name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>
        )}
        {action === "permissions" && (
          <>
            <label>
              Role
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="staff">Staff</option>
                <option value="admin">Administrator</option>
              </select>
            </label>
            <label>
              Approved sender addresses
              <input
                value={senders}
                onChange={(e) => setSenders(e.target.value)}
              />
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={nophi}
                onChange={(e) => setNophi(e.target.checked)}
              />
              Allow Nophi
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={privileges}
                onChange={(e) => setPrivileges(e.target.checked)}
              />
              Allow privilege management
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={exportAudit}
                onChange={(e) => setExportAudit(e.target.checked)}
              />
              Allow audit export
            </label>
          </>
        )}
        {action && (
          <>
            <div className="notice">
              This change is recorded in the audit history. Suspending or
              deactivating stops access and preserves retained records. Recovery
              does not bypass MFA.
            </div>
            <label>
              Reason
              <textarea
                rows={2}
                maxLength={300}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Use non-confidential administrative context."
                required
              />
            </label>
            <ErrorNotice message={error} />
            <button
              className={
                ["suspend", "deactivate", "cancel_invitation"].includes(action)
                  ? "danger-button"
                  : "primary"
              }
              disabled={busy}
            >
              {busy ? "Saving…" : "Confirm action"}
            </button>
          </>
        )}
      </form>
    </div>
  );
}

export function AuditLogs({
  user,
  actorId = "",
}: {
  user: User;
  actorId?: string;
}) {
  const [q, setQ] = useState("");
  const search = useDebounced(q);
  const [outcome, setOutcome] = useState("");
  const [action, setAction] = useState("");
  const [actor, setActor] = useState(actorId);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState("-occurred_at");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [snapshot, setSnapshot] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<AuditEvent | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [stepUp, setStepUp] = useState(false);
  const filters = {
    q: search,
    outcome,
    action,
    actor_id: actor,
    from: from ? new Date(from).toISOString() : "",
    to: to ? new Date(to).toISOString() : "",
  };
  const resource = useResource<AuditPage>(
    "/admin/audit-events" +
      query({ ...filters, sort, page, page_size: size, snapshot }),
    refresh,
  );
  // Keep a response snapshot for later pages without causing an initial double request.
  const snapshotRef = useRef("");
  useEffect(() => {
    if (resource.data) snapshotRef.current = resource.data.snapshot;
  }, [resource.data]);
  function criteria(change: () => void) {
    change();
    setPage(1);
    setSnapshot("");
    snapshotRef.current = "";
  }
  function reset() {
    criteria(() => {
      setQ("");
      setOutcome("");
      setAction("");
      setActor("");
      setFrom("");
      setTo("");
    });
  }
  async function details(event: AuditEvent) {
    setError("");
    try {
      setSelected(await api<AuditEvent>(`/admin/audit-events/${event.id}`));
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function exportNow() {
    setBusy(true);
    setError("");
    try {
      const result = await post<{ download_url: string }>(
        "/admin/audit-exports",
        { ...filters, snapshot: snapshotRef.current },
      );
      window.location.assign(result.download_url);
      setExporting(false);
    } catch (err) {
      if (err instanceof ApiError && err.code === "step_up_required")
        setStepUp(true);
      else setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="ACCESS MANAGEMENT"
        title="Audit logs"
        description="A traceable record of account, access, and security activity."
        actions={
          user.can_export_audit && (
            <button onClick={() => setExporting(true)}>
              <Icon name="download" size={18} />
              Export filtered results
            </button>
          )
        }
      />
      <AccessTabs current="audit" />
      <div
        className={`notice ${resource.data?.archive_enabled ? "" : "warning"}`}
      >
        <Icon name="shield" size={19} />
        <div>
          <strong>
            Historical events cannot be edited or deleted in this portal.
          </strong>
          <span>
            {resource.data?.archive_enabled
              ? `${resource.data.pending_archive} events awaiting protected archival.`
              : "Storage-backed immutable retention is not configured for this workspace. Events are database append-only; archive protection is pending."}
          </span>
        </div>
      </div>
      <ErrorNotice message={error} />
      <section className="card flush">
        <div className="list-toolbar">
          <label className="search wide">
            <Icon name="search" size={18} />
            <input
              aria-label="Search audit events"
              value={q}
              placeholder="Search actor, action or resource ID"
              onChange={(e) => criteria(() => setQ(e.target.value))}
            />
          </label>
          <button
            onClick={() => {
              setSnapshot("");
              snapshotRef.current = "";
              setPage(1);
              setRefresh((v) => v + 1);
            }}
          >
            Refresh snapshot
          </button>
        </div>
        <div className="filter-bar audit-filters">
          <label>
            Outcome
            <select
              value={outcome}
              onChange={(e) => criteria(() => setOutcome(e.target.value))}
            >
              <option value="">All outcomes</option>
              {["success", "failure", "denied"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            Action
            <input
              placeholder="e.g. account.created"
              value={action}
              onChange={(e) => criteria(() => setAction(e.target.value))}
            />
          </label>
          <label>
            Actor ID
            <input
              value={actor}
              onChange={(e) => criteria(() => setActor(e.target.value))}
              placeholder="Any actor"
            />
          </label>
          <label>
            From
            <input
              type="datetime-local"
              value={from}
              onChange={(e) => criteria(() => setFrom(e.target.value))}
            />
          </label>
          <label>
            To
            <input
              type="datetime-local"
              value={to}
              onChange={(e) => criteria(() => setTo(e.target.value))}
            />
          </label>
          <button className="text-button" onClick={reset}>
            Clear filters
          </button>
        </div>
        <ErrorNotice message={resource.error} />
        {resource.loading ? (
          <Loading />
        ) : resource.data?.results.length ? (
          <div className="table-container">
            <table className="data-table audit-table">
              <caption className="sr-only">
                Read-only organizational audit history
              </caption>
              <thead>
                <tr>
                  {[
                    ["Recorded at", "occurred_at"],
                    ["Actor", "actor"],
                    ["Action", "action"],
                  ].map(([label, field]) => (
                    <SortHeader
                      key={field}
                      label={label}
                      field={field}
                      sort={sort}
                      onSort={(v) => criteria(() => setSort(v))}
                    />
                  ))}
                  <th scope="col">Target</th>
                  <SortHeader
                    label="Outcome"
                    field="outcome"
                    sort={sort}
                    onSort={(v) => criteria(() => setSort(v))}
                  />
                  <th scope="col">Archive</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {resource.data.results.map((event) => (
                  <tr key={event.id}>
                    <td data-label="Recorded at">
                      {formatDate(event.occurred_at)}
                    </td>
                    <td data-label="Actor">
                      <strong>{event.actor}</strong>
                      <small>{event.role}</small>
                    </td>
                    <td data-label="Action">
                      <code className="event-action">{event.action}</code>
                    </td>
                    <td data-label="Target">
                      <span>{event.target_type.replaceAll("_", " ")}</span>
                      <small className="mono">
                        {event.target_id.slice(0, 12) || "—"}
                      </small>
                    </td>
                    <td data-label="Outcome">
                      <Badge
                        tone={
                          event.outcome === "success" ? "success" : "danger"
                        }
                      >
                        {event.outcome}
                      </Badge>
                    </td>
                    <td data-label="Archive">
                      <small>
                        {event.archive_state === "archived"
                          ? "Archived"
                          : "Pending archive"}
                      </small>
                    </td>
                    <td data-label="Actions">
                      <button
                        className="small-button"
                        onClick={() => void details(event)}
                      >
                        Details →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No events match these filters">
            Clear a filter or choose another date range.
          </Empty>
        )}
        {resource.data && (
          <Pagination
            count={resource.data.count}
            page={page}
            size={size}
            onPage={(p) => {
              setSnapshot(snapshotRef.current);
              setPage(p);
            }}
            onSize={(s) => {
              setSize(s);
              setPage(1);
              setSnapshot(snapshotRef.current);
            }}
          />
        )}
      </section>
      <div className="quiet-note">
        Snapshot: {formatDate(resource.data?.snapshot_at)} · Times shown in{" "}
        {Intl.DateTimeFormat().resolvedOptions().timeZone}. Viewing and
        exporting history is also audited.
      </div>
      {selected && (
        <Modal title="Audit event details" onClose={() => setSelected(null)}>
          <dl className="detail-grid">
            <div>
              <dt>Event ID</dt>
              <dd className="mono wrap">{selected.id}</dd>
            </div>
            <div>
              <dt>Recorded at</dt>
              <dd>{formatDate(selected.occurred_at)}</dd>
            </div>
            <div>
              <dt>Actor</dt>
              <dd>
                {selected.actor} · {selected.role}
              </dd>
            </div>
            <div>
              <dt>Action</dt>
              <dd>{selected.action}</dd>
            </div>
            <div>
              <dt>Target</dt>
              <dd className="wrap">
                {selected.target_type} · {selected.target_id}
              </dd>
            </div>
            <div>
              <dt>Outcome</dt>
              <dd>{selected.outcome}</dd>
            </div>
          </dl>
          <h3>Recorded metadata</h3>
          <pre className="metadata">
            {JSON.stringify(selected.metadata, null, 2)}
          </pre>
          <p className="muted">
            {selected.archive
              ? `Archived until ${formatDate(selected.archive.retain_until)}`
              : "Pending protected archival"}
          </p>
          <div className="button-row">
            <button
              onClick={() =>
                void navigator.clipboard
                  .writeText(selected.id)
                  .catch(() =>
                    setError("Copy unavailable. Select the event ID manually."),
                  )
              }
            >
              Copy event ID
            </button>
            <button
              onClick={() => {
                criteria(() => {
                  setQ(selected.target_id);
                  setAction("");
                });
                setSelected(null);
              }}
            >
              View related events
            </button>
          </div>
        </Modal>
      )}
      {exporting && (
        <Modal
          title="Export audit history"
          onClose={() => {
            setExporting(false);
            setStepUp(false);
          }}
        >
          {stepUp ? (
            <StepUp onDone={() => setStepUp(false)} />
          ) : (
            <>
              <p>
                Export all matching events from this snapshot, up to 10,000
                rows. Content and secrets are excluded. The download permission
                expires after 10 minutes and is checked again on access.
              </p>
              <p>
                <strong>{resource.data?.count ?? 0} matching events</strong> ·
                CSV format
              </p>
              <ErrorNotice message={error} />
              <div className="form-footer">
                <button onClick={() => setExporting(false)}>Cancel</button>
                <button
                  className="primary"
                  disabled={busy || !resource.data}
                  onClick={() => void exportNow()}
                >
                  {busy ? "Preparing…" : "Create & download export"}
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
