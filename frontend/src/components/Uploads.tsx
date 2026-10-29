import { useRef, useState } from "react";
import { bytes } from "../api";
import { api } from "../api";
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  async function upload(selected: FileList | null) {
    if (!selected?.length) return;
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
    setBusy(true);
    onBusy?.(true);
    try {
      for (const file of Array.from(selected)) {
        const form = new FormData();
        form.append("file", file);
        const uploaded = await api<FileItem>(
          recipient ? "/recipient/attachments" : "/attachments",
          { method: "POST", body: form },
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
      <label className="upload-area">
        <Icon name="file" size={26} />
        <strong>
          {busy
            ? "Uploading and checking files…"
            : "Choose documents to attach"}
        </strong>
        <span>PDF, PNG, JPEG or text · Up to 25 MB combined</span>
        <input
          ref={input}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.txt"
          multiple
          disabled={busy}
          onChange={(e) => void upload(e.target.files)}
          aria-label="Upload attachments"
        />
      </label>
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
                  : f.state}
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
