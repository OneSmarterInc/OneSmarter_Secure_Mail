import { useEffect, useState } from "react";

export const recipientPortal =
  window.location.pathname.startsWith("/recipient");
export const apiBase = recipientPortal ? "/recipient-api" : "/api";
let csrf = "";

export function useDocumentService() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function refresh() {
      try {
        const result = await api<{ ready: boolean }>("/document-service", {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(5000),
          ]),
        });
        if (live) setReady(result.ready === true);
      } catch {
        if (live) setReady(false);
      } finally {
        if (live) timer = setTimeout(() => void refresh(), 5000);
      }
    }
    void refresh();
    return () => {
      live = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, []);
  return ready;
}
export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
  }
}
function errorText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(errorText).join(" ");
  if (value && typeof value === "object")
    return Object.values(value).map(errorText).join(" ");
  return "The request could not be completed.";
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData) && options.body)
    headers.set("Content-Type", "application/json");
  // Concurrent session responses can carry different masked tokens. Match the
  // current cookie sent with this request, including login/session rotation.
  const csrfCookie = document.cookie
    .split("; ")
    .find((part) => part.startsWith("csrftoken="))
    ?.slice("csrftoken=".length);
  const token = csrfCookie ? decodeURIComponent(csrfCookie) : csrf;
  if (token) headers.set("X-CSRFToken", token);
  const response = await fetch(apiBase + path, {
    ...options,
    headers,
    credentials: "same-origin",
    cache: "no-store",
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error =
      body && typeof body === "object" && "error" in body ? body.error : body;
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "request_failed";
    const message =
      error && typeof error === "object" && "message" in error
        ? error.message
        : error;
    if (response.status === 401)
      window.dispatchEvent(new CustomEvent("session-expired"));
    throw new ApiError(errorText(message), code, response.status);
  }
  if (
    body &&
    typeof body === "object" &&
    "csrf" in body &&
    typeof body.csrf === "string"
  )
    csrf = body.csrf;
  return body as T;
}
export function post<T>(
  path: string,
  data: unknown = {},
  key?: string,
): Promise<T> {
  return api<T>(path, {
    method: "POST",
    body: JSON.stringify(data),
    headers: key ? { "Idempotency-Key": key } : undefined,
  });
}
export function useResource<T>(path: string | null, refresh = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setData(null);
    api<T>(path, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(
            errorText(reason instanceof Error ? reason.message : reason),
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, refresh]);
  return { data, error, loading };
}
export function useDebounced(value: string, delay = 300) {
  const [result, setResult] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setResult(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return result;
}
export const query = (
  values: Record<string, string | number | boolean | undefined>,
) =>
  "?" +
  new URLSearchParams(
    Object.entries(values)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => [k, String(v)]),
  ).toString();
export const formatDate = (value: string | null | undefined) =>
  value
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "Never";
export const bytes = (value: number) =>
  value < 1024
    ? `${value} B`
    : value < 1048576
      ? `${(value / 1024).toFixed(1)} KB`
      : `${(value / 1048576).toFixed(1)} MB`;

export function uploadFile<T>(
  path: string,
  file: File,
  progress: (percent: number) => void,
  signal: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    if (signal.aborted) {
      reject(new DOMException("Cancelled", "AbortError"));
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    xhr.open("POST", apiBase + path);
    xhr.withCredentials = true;
    xhr.timeout = 120000;
    const cookie = document.cookie
      .split("; ")
      .find((part) => part.startsWith("csrftoken="))
      ?.slice(10);
    const token = cookie ? decodeURIComponent(cookie) : csrf;
    if (token) xhr.setRequestHeader("X-CSRFToken", token);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        progress(Math.floor((event.loaded / event.total) * 100));
    };
    xhr.onloadend = () => signal.removeEventListener("abort", abort);
    xhr.onerror = () =>
      reject(
        new ApiError(
          "Upload connection failed. Try again.",
          "upload_failed",
          0,
        ),
      );
    xhr.ontimeout = () =>
      reject(
        new ApiError(
          "Upload timed out. Check before retrying.",
          "upload_timeout",
          0,
        ),
      );
    xhr.onabort = () => reject(new DOMException("Cancelled", "AbortError"));
    xhr.onload = () => {
      let body;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        reject(
          new ApiError("Invalid upload response.", "upload_failed", xhr.status),
        );
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        if (xhr.status === 401)
          window.dispatchEvent(new CustomEvent("session-expired"));
        reject(
          new ApiError(
            errorText(body?.error?.message || body?.error),
            String(body?.error?.code || "upload_failed"),
            xhr.status,
          ),
        );
      } else resolve(body as T);
    };
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}
