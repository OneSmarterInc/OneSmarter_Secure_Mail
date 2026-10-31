import { useEffect, useRef, useState } from "react";
import { api, downloadAttachment, formatDate, useDebounced } from "../api";
import { ErrorNotice, Icon, SortHeader } from "../components/ui";

interface DocumentRow {
  id: string;
  filename: string;
  conversation_id: string;
  conversation: string;
  sender: string;
  sender_email: string;
  uploaded_at: string;
}
interface Documents {
  results: DocumentRow[];
  count: number;
  page: number;
}

export function EvidenceCatalog() {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("-uploaded_at");
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const [search, setSearch] = useState("");
  const searchTerm = useDebounced(search.trim(), 250);
  const [result, setResult] = useState<{
    data: Documents | null;
    loading: boolean;
    error: string;
  }>({ data: null, loading: true, error: "" });
  useEffect(() => {
    const request = new AbortController();
    setResult((previous) => ({ ...previous, loading: true, error: "" }));
    api<Documents>(
      `/evidence?view=documents&page=${page}&sort=${encodeURIComponent(sort)}&q=${encodeURIComponent(searchTerm)}`,
      { signal: request.signal },
    )
      .then((data) => {
        if (request.signal.aborted) return;
        if (
          !Array.isArray(data.results) ||
          data.results.some(
            (row) => !row.id || !row.conversation_id || !row.uploaded_at,
          )
        )
          throw new Error(
            "Document details could not be loaded. Please refresh the page.",
          );
        setResult({ data, loading: false, error: "" });
      })
      .catch((reason: unknown) => {
        if (!request.signal.aborted)
          setResult({
            data: null,
            loading: false,
            error:
              reason instanceof Error
                ? reason.message
                : "Unable to load documents.",
          });
      });
    return () => request.abort();
  }, [page, sort, searchTerm]);
  function changeSort(next: string) {
    setSort(next);
    setPage(1);
  }
  async function download(row: DocumentRow) {
    if (controller.current) return;
    const current = new AbortController();
    controller.current = current;
    setError("");
    setDownloading(row.id);
    try {
      await downloadAttachment(row.id, row.filename, current.signal);
    } catch (err) {
      if (!current.signal.aborted) setError((err as Error).message);
    } finally {
      controller.current = null;
      if (!current.signal.aborted) setDownloading("");
    }
  }
  return (
    <>
      <ErrorNotice message={error || result.error} />
      <div className="card document-table-card">
        <div className="document-table-toolbar">
          <label className="document-search">
            <input
              type="search"
              aria-label="Search all documents"
              maxLength={200}
              placeholder="Search documents, conversations, senders or dates"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
            <Icon name="search" size={18} />
          </label>
          <span
            className="document-sort-status"
            role="status"
            aria-live="polite"
          >
            {result.loading && result.data ? "Updating�" : ""}
          </span>
        </div>
        <div className="table-scroll">
          <table
            className="document-table"
            aria-label="Conversation documents"
            aria-busy={result.loading}
          >
            <colgroup>
              <col style={{ width: "34%" }} />
              <col style={{ width: "23%" }} />
              <col style={{ width: "21%" }} />
              <col style={{ width: "15%" }} />
              <col style={{ width: "7%" }} />
            </colgroup>
            <thead>
              <tr>
                {[
                  ["filename", "Document name"],
                  ["conversation", "Conversation"],
                  ["sender", "Sender"],
                  ["uploaded_at", "Date / time"],
                  ["download", "Download"],
                ].map(([field, label]) => (
                  <SortHeader
                    key={field}
                    label={label}
                    field={field}
                    sort={sort}
                    onSort={changeSort}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {result.loading && !result.data && (
                <tr>
                  <td colSpan={5} role="status">
                    Loading documents�
                  </td>
                </tr>
              )}
              {!result.loading && !result.error && result.data?.count === 0 && (
                <tr>
                  <td colSpan={5}>
                    {searchTerm
                      ? "No documents match your search."
                      : "No documents yet. Files appear after they are sent in a conversation."}
                  </td>
                </tr>
              )}
              {result.data?.results.map((row) => (
                <tr key={row.id}>
                  <td>
                    <span className="document-name">
                      <Icon name="file" size={18} />
                      {row.filename}
                    </span>
                  </td>
                  <td>
                    <a href={`#/messages/${row.conversation_id}`}>
                      {row.conversation || "Untitled conversation"}
                    </a>
                  </td>
                  <td>
                    <strong>
                      {row.sender || row.sender_email || "Unknown sender"}
                    </strong>
                    {row.sender_email && row.sender_email !== row.sender && (
                      <small>{row.sender_email}</small>
                    )}
                  </td>
                  <td>
                    <time dateTime={row.uploaded_at}>
                      {formatDate(row.uploaded_at)}
                    </time>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="icon-button"
                      title="Decrypt and download document"
                      aria-label={`Download ${row.filename}`}
                      disabled={!!downloading}
                      onClick={() => void download(row)}
                    >
                      <Icon name="download" size={18} />
                      {downloading === row.id && <span>Downloading�</span>}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {result.data && (
          <div className="document-pagination">
            <small>{result.data.count} documents</small>
            <div>
              <button
                disabled={page === 1 || result.loading}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </button>
              <span>Page {page}</span>
              <button
                disabled={page * 25 >= result.data.count || result.loading}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
