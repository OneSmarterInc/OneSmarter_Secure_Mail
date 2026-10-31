import { useEffect, useRef, useState } from "react";
import { bytes } from "../api";
import { uploadFile } from "../api";
import type { FileItem } from "../types";
import { ErrorNotice, Icon } from "./ui";

export function Uploads({
  files,
  onChange,
  recipient = false,
  onBusy,
}: {
  files: FileItem[];
  onChange: (f: FileItem[]) => void;
  recipient?: boolean;
  onBusy?: (busy: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const [progress, setProgress] = useState<
    { name: string; percent: number; rejected: boolean }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  async function upload(selected: FileList | null) {
    if (!selected?.length || busy) return;
    setError("");
    const next = [...files];
    if (
      next.length + selected.length > 10 ||
      next.reduce((n, f) => n + f.size, 0) +
        Array.from(selected).reduce((n, f) => n + f.size, 0) >
        25 * 1048576
    ) {
      setError("Choose up to 10 files, 25 MB combined.");
      return;
    }

    controller.current = new AbortController();
    setProgress(
      Array.from(selected).map((file) => ({
        name: file.name,
        percent: 0,
        rejected: false,
      })),
    );
    setBusy(true);
    onBusy?.(true);
    try {
      for (const [index, file] of Array.from(selected).entries()) {
        let uploaded: FileItem;
        try {
          uploaded = await uploadFile<FileItem>(
            recipient ? "/recipient/attachments" : "/attachments",
            file,
            (percent) =>
              setProgress((items) =>
                items.map((item, i) =>
                  i === index ? { ...item, percent } : item,
                ),
              ),
            controller.current.signal,
          );
        } catch (err) {
          setProgress((items) =>
            items.map((item, i) =>
              i >= index ? { ...item, rejected: true } : item,
            ),
          );
          throw err;
        }
        setProgress((items) =>
          items.map((item, i) =>
            i === index ? { ...item, percent: 101 } : item,
          ),
        );
        next.push(uploaded);
        onChange([...next]);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      onBusy?.(false);
      if (input.current) input.current.value = "";
    }
  }
  return (
    <div className="uploads">
      <button
        type="button"
        className="attachment-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        disabled={busy}
      >
        <Icon name="paperclip" size={18} /> Attach files
      </button>
      {expanded && (
        <div className="attachment-controls">
          <label className="upload-area">
            <Icon name="file" size={18} />
            <strong>
              {busy ? "Uploading and checking files…" : "Attach files"}
            </strong>
            <span>PDF, PNG, JPEG or text · Up to 10 files, 25 MB combined</span>
            <input
              ref={input}
              type="file"
              multiple
              accept=".pdf,.png,.jpg,.jpeg,.txt"
              disabled={busy}
              onChange={(e) => void upload(e.target.files)}
              aria-label="Upload attachments"
            />
          </label>
        </div>
      )}
      {busy && (
        <button type="button" onClick={() => controller.current?.abort()}>
          Cancel upload
        </button>
      )}
      <p role="status" aria-live="polite">
        {busy
          ? "Upload in progress"
          : progress.length
            ? "Upload finished. Review file results below."
            : ""}
      </p>
      <div>
        {progress.map((item, index) => (
          <div key={index}>
            <span>
              {item.name}:{" "}
              {item.rejected
                ? "Not accepted"
                : item.percent > 100
                  ? "Available"
                  : item.percent === 100
                    ? "Checking"
                    : `Uploading ${item.percent}%`}
            </span>
            {!item.rejected && item.percent < 100 && (
              <progress
                aria-label={`Upload ${item.name}`}
                value={item.percent}
                max={100}
              />
            )}
          </div>
        ))}
      </div>
      <ErrorNotice message={error} />
      <div aria-live="polite">
        {files.map((f) => (
          <div className="attachment" key={f.id}>
            <Icon name="file" />
            <span>
              <strong>{f.name}</strong>
              <small>
                {bytes(f.size)} ·{" "}
                {f.scan_method === "synthetic-validation-only"
                  ? "Antivirus scan not performed"
                  : f.state === "available"
                    ? "Available"
                    : f.state === "rejected"
                      ? "Rejected"
                      : "Checking"}
              </small>
            </span>
            <button
              type="button"
              className="icon-button"
              aria-label={`Remove ${f.name}`}
              onClick={() => onChange(files.filter((item) => item.id !== f.id))}
              disabled={busy}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
