import { useEffect, useRef, useState } from "react";
import { downloadAttachment, formatDate } from "../api";
import { ErrorNotice, Icon, SortHeader } from "../components/ui";
import type { Conversation } from "../types";

export function RecipientCatalog({
  conversation,
}: {
  conversation: Conversation;
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("-date");
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  // Only use the server-filtered messages from this verified conversation.
  const rows = (conversation.messages ?? [])
    .flatMap((message) =>
      message.attachments.map((file) => ({
        id: file.id,
        name: file.name,
        state: file.state,
        sender: message.headers?.from_email || message.author,
        date: message.created_at,
      })),
    )
    .filter((row) =>
      `${row.name} ${row.sender} ${row.date}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
    );
  const field = sort.replace(/^-/, "") as "name" | "sender" | "date";
  rows.sort(
    (a, b) =>
      (sort.startsWith("-") ? -1 : 1) *
      a[field].localeCompare(b[field], undefined, { numeric: true }),
  );
  async function download(id: string, name: string) {
    const controller = new AbortController();
    request.current = controller;
    setDownloading(id);
    setError("");
    try {
      await downloadAttachment(id, name, controller.signal);
    } catch (reason) {
      if (!controller.signal.aborted) setError((reason as Error).message);
    } finally {
      if (!controller.signal.aborted) setDownloading("");
    }
  }
  return (
    <section className="recipient-catalog" aria-label="Archive">
      <header className="page-heading">
        <h1>Archive</h1>
        <p className="muted">Documents shared with you in this conversation.</p>
      </header>
      <ErrorNotice message={error} />
      <div className="card document-catalog">
        <div className="document-toolbar">
          <label className="document-search">
            <span className="sr-only">Search documents</span>
            <input
              aria-label="Search documents"
              placeholder="Search documents, sender or date"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Icon name="search" size={18} />
          </label>
        </div>
        <table className="document-table" aria-label="Conversation documents">
          <thead>
            <tr>
              {[
                ["name", "Document name"],
                ["sender", "Sender"],
                ["date", "Date / time"],
              ].map(([key, label]) => (
                <SortHeader
                  key={key}
                  field={key}
                  label={label}
                  sort={sort}
                  onSort={setSort}
                />
              ))}
              <th scope="col">Download</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.name}</td>
                <td>{row.sender}</td>
                <td>
                  <time dateTime={row.date}>{formatDate(row.date)}</time>
                </td>
                <td>
                  <button
                    className="icon-button"
                    aria-label={`Download ${row.name}`}
                    title="Decrypt and download"
                    disabled={!!downloading || row.state !== "available"}
                    onClick={() => void download(row.id, row.name)}
                  >
                    <Icon name="download" size={18} />
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4}>
                  {search
                    ? "No documents match your search."
                    : "No documents have been shared in this conversation yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
