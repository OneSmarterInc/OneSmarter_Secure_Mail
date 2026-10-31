import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { post } from "../api";

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    more: (
      <>
        <circle cx="5" cy="12" r="1" />
        <circle cx="12" cy="12" r="1" />
        <circle cx="19" cy="12" r="1" />
      </>
    ),
    mail: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="3" />
        <path d="m3 6 9 7 9-7" />
      </>
    ),
    shield: (
      <>
        <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
    paperclip: (
      <path d="m21 11-8.5 8.5a6 6 0 0 1-8.5-8.5L13 2a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.8-2.8L15 6" />
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="2" />
        <rect x="14" y="3" width="7" height="7" rx="2" />
        <rect x="3" y="14" width="7" height="7" rx="2" />
        <rect x="14" y="14" width="7" height="7" rx="2" />
      </>
    ),
    users: (
      <>
        <circle cx="9" cy="7" r="3" />
        <path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M18 14c2 1 3 2 3 5v2" />
      </>
    ),
    settings: (
      <>
        <path d="M4 7h16M4 17h16" />
        <circle cx="8" cy="7" r="3" />
        <circle cx="16" cy="17" r="3" />
      </>
    ),
    reply: <path d="m10 5-7 6 7 6v-4h4c4 0 6 2 7 6v-5c0-5-3-7-7-7h-4z" />,
    "reply-all": (
      <>
        <path d="m7 5-6 6 6 6M14 5l-7 6 7 6v-4h2c3 0 5 2 6 6v-5c0-5-2-7-6-7h-2z" />
      </>
    ),
    back: <path d="M19 12H5m6-6-6 6 6 6" />,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    search: (
      <>
        <circle cx="10" cy="10" r="6" />
        <path d="m15 15 5 5" />
      </>
    ),
    file: (
      <>
        <path d="M14 3H5v18h14V8zM14 3v6h5M8 13h8M8 17h5" />
      </>
    ),
    logout: (
      <>
        <path d="M10 4H4v16h6M10 12h11m-4-4 4 4-4 4" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    download: (
      <>
        <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
      </>
    ),
    lock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.file}
    </svg>
  );
}
export function Brand() {
  return (
    <a className="brand" href="#/messages">
      <span className="brand-emblem" aria-hidden="true" />
      <span>
        OneSmarter<small>SECURE MAIL</small>
      </span>
    </a>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function ErrorNotice({ message }: { message: string }) {
  return message ? (
    <div className="notice danger" role="alert">
      {message}
    </div>
  ) : null;
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="icon-tile">
        <Icon name="mail" size={28} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <span className="spinner" />
      Loading workspace…
    </div>
  );
}
export function PageHeader({
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      <div className="header-actions">{actions}</div>
    </header>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useLayoutEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      aria-labelledby={titleId}
    >
      <div className="modal-heading">
        <h2 id={titleId}>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function SortHeader({
  label,
  field,
  sort,
  onSort,
}: {
  label: string;
  field: string;
  sort: string;
  onSort: (s: string) => void;
}) {
  const active = sort.replace("-", "") === field;
  const descending = sort.startsWith("-");
  return (
    <th
      scope="col"
      aria-sort={active ? (descending ? "descending" : "ascending") : "none"}
    >
      <button
        className="sort-button"
        onClick={() => onSort(active && !descending ? "-" + field : field)}
        aria-label={`Sort ${label} ${active && !descending ? "descending" : "ascending"}`}
      >
        {label}
        <span aria-hidden="true">
          {active ? (descending ? "↓" : "↑") : "↕"}
        </span>
      </button>
    </th>
  );
}
export function Pagination({
  count,
  page,
  size,
  onPage,
  onSize,
}: {
  count: number;
  page: number;
  size: number;
  onPage: (p: number) => void;
  onSize: (s: number) => void;
}) {
  return (
    <div className="pagination">
      <span>
        {count ? (page - 1) * size + 1 : 0}–{Math.min(page * size, count)} of{" "}
        {count}
      </span>
      <label>
        Rows{" "}
        <select
          aria-label="Rows per page"
          value={size}
          onChange={(e) => onSize(Number(e.target.value))}
        >
          {[25, 50, 100].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      <div className="button-row">
        <button disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </button>
        <button
          disabled={page * size >= count}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
export function StepUp({ onDone }: { onDone: () => void }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post("/auth/step-up", { token });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="stack">
      <p>
        Confirm a fresh authenticator code to authorize this sensitive change.
      </p>
      <label>
        Authenticator code
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          required
        />
      </label>
      <ErrorNotice message={error} />
      <button className="primary" disabled={busy}>
        Verify identity
      </button>
    </form>
  );
}
