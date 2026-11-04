import { useEffect, useRef, useState } from "react";
import {
  downloadAttachment,
  formatDate,
  query,
  useDebounced,
  useResource,
} from "../api";
import { ErrorNotice, Icon, SortHeader } from "../components/ui";
import type { Conversation, Page } from "../types";

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
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);
  const resource = useResource<
    Page<{
      id: string;
      name: string;
      state: string;
      sender: string;
      date: string;
    }>
  >("/recipient/documents" + query({ q: debounced, sort, page }), 0, true);
  useEffect(() => setPage(1), [debounced, sort, conversation.id]);
  const rows = resource.data?.results ?? [];
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
      <ErrorNotice message={error || resource.error} />
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
              <th scope="col">Document name</th>
              {[
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
                  {resource.loading
                    ? "Loading documents..."
                    : search
                      ? "No documents match your search."
                      : "No documents have been shared in this conversation yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="pagination">
          <button
            disabled={page === 1 || resource.loading}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </button>
          <span>Page {page}</span>
          <button
            disabled={
              !resource.data ||
              resource.loading ||
              page * resource.data.page_size >= resource.data.count
            }
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </section>
  );
}
