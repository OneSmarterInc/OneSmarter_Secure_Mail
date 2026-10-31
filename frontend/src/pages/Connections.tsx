import { SmtpSettings } from "./SmtpSettings";
import { useState } from "react";
import { formatDate, post, useResource } from "../api";
import {
  Badge,
  ErrorNotice,
  Icon,
  Loading,
  PageHeader,
} from "../components/ui";

interface Settings {
  mail: string;
  smtp_configured: boolean;
  storage_configured: boolean;
  document_encryption: string | null;
  key_service_ready: boolean;
  antivirus_enabled: boolean;
  storage: string;
  scanner: string;
  crypto: string;
  key_protector: string;
  sender_addresses: string[];
  can_manage_accounts: boolean;
  can_manage_senders: boolean;
  checked_at: string;
  delivery_counts: Record<string, number>;
  max_upload_bytes: number;
  signature_max_age_hours: number;
}
interface Check {
  checked_at: string;
  scanner: { status: string; engine?: string; signature_age_seconds?: number };
}

export function Connections() {
  const [refresh, setRefresh] = useState(0);
  const result = useResource<Settings>("/settings", refresh);
  const [check, setCheck] = useState<Check | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  async function checkScanner() {
    setChecking(true);
    setError("");
    setCheck(null);
    try {
      setCheck(await post<Check>("/settings/checks"));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setChecking(false);
    }
  }
  const data = result.data;
  const smtp = data?.mail === "smtp" && data.smtp_configured;
  const pending = data
    ? ["queued", "retry", "sending"].reduce(
        (sum, state) => sum + (data.delivery_counts[state] || 0),
        0,
      )
    : 0;
  return (
    <>
      <PageHeader
        eyebrow="WORKSPACE SETTINGS"
        title="Connections"
        description="Email delivery, document protection and your approved sender addresses."
      />
      <SmtpSettings onChanged={() => setRefresh((v) => v + 1)} />
      <h2 className="section-heading">Service status</h2>
      <div className="connections-toolbar">
        <p className="muted">
          {data
            ? `Updated ${formatDate(data.checked_at)}`
            : "Loading connection settings…"}
        </p>
        <button
          onClick={() => {
            setCheck(null);
            setRefresh((v) => v + 1);
          }}
          disabled={result.loading}
        >
          Refresh status
        </button>
      </div>
      <ErrorNotice message={result.error || error} />
      {result.loading ? (
        <Loading />
      ) : (
        data && (
          <>
            {!smtp && (
              <div className="notice warning" role="status">
                <Icon name="mail" />
                <div>
                  <strong>Outgoing email needs attention</strong>
                  <p>
                    {data.mail === "development"
                      ? "Notifications are captured locally and are not sent to recipients. Previously captured notifications will not be sent automatically when email is enabled."
                      : "An approved company sender and its SMTP credentials are not configured. Ask your service administrator to configure email delivery."}
                  </p>
                </div>
              </div>
            )}
            <div className="settings-grid connection-cards">
              <section className="card">
                <div className="connection-heading">
                  <span className="icon-tile">
                    <Icon name="mail" />
                  </span>
                  <Badge tone={smtp ? "neutral" : "warning"}>
                    {smtp ? "SMTP configured" : "Not sending email"}
                  </Badge>
                </div>
                <h2>Email delivery</h2>
                <p>
                  Invitations and verification codes go to the recipient's
                  mailbox. Confidential messages and documents stay in the
                  portal.
                </p>
                <details className="connection-details">
                  <summary>View details</summary>
                  <dl className="connection-facts">
                    <div>
                      <dt>Delivery method</dt>
                      <dd>
                        {data.mail === "smtp"
                          ? "SMTP with TLS"
                          : "Local capture"}
                      </dd>
                    </div>
                    <div>
                      <dt>Connection verification</dt>
                      <dd>
                        Configuration only; inbox receipt is not confirmed
                      </dd>
                    </div>
                  </dl>
                </details>
                <p className="connection-help">
                  Manage your own encrypted credentials in SMTP setup above.
                  Saved passwords are never displayed.
                </p>
              </section>
              <section className="card">
                <div className="connection-heading">
                  <span className="icon-tile">
                    <Icon name="file" />
                  </span>
                  <Badge tone={data.storage_configured ? "neutral" : "warning"}>
                    {data.storage_configured
                      ? "Configuration present"
                      : "Not configured"}
                  </Badge>
                </div>
                <h2>Document storage</h2>
                <p>
                  Accepted documents are encrypted before storage and downloaded
                  through permission-checked endpoints.
                </p>
                <details className="connection-details">
                  <summary>View details</summary>
                  <dl className="connection-facts">
                    <div>
                      <dt>Storage location</dt>
                      <dd>
                        {data.storage === "s3"
                          ? "Private object storage"
                          : "Application server disk"}
                      </dd>
                    </div>
                    <div>
                      <dt>Retention</dt>
                      <dd>No automatic deletion of submitted documents</dd>
                    </div>
                    <div>
                      <dt>Visitor access expiry</dt>
                      <dd>Ends visitor access; retains the conversation</dd>
                    </div>
                  </dl>
                </details>
                <p className="connection-help">
                  This page does not verify backups or storage durability.
                </p>
              </section>
              <section className="card">
                <div className="connection-heading">
                  <span className="icon-tile">
                    <Icon name="shield" />
                  </span>
                  <Badge
                    tone={
                      check?.scanner.status === "unavailable"
                        ? "warning"
                        : "neutral"
                    }
                  >
                    {!data.antivirus_enabled
                      ? "Antivirus disabled"
                      : check
                        ? check.scanner.status === "healthy"
                          ? "Health check passed"
                          : "Unavailable or signatures stale"
                        : "Not checked"}
                  </Badge>
                </div>
                <h2>Upload protection</h2>
                <p>
                  {data.antivirus_enabled
                    ? "Uploads require ClamAV scanning. Files are rejected if the scanner is unavailable or its signatures are stale."
                    : "Antivirus scanning is not enabled. Synthetic validation is not a malware scan."}
                </p>
                <details className="connection-details">
                  <summary>View details</summary>
                  <dl className="connection-facts">
                    <div>
                      <dt>Scanner</dt>
                      <dd>
                        {data.scanner === "clamav"
                          ? "ClamAV"
                          : "Antivirus not enabled"}
                      </dd>
                    </div>
                    <div>
                      <dt>Maximum file size</dt>
                      <dd>
                        {Math.floor(data.max_upload_bytes / 1024 / 1024)} MiB
                      </dd>
                    </div>
                    <div>
                      <dt>Signature freshness limit</dt>
                      <dd>{data.signature_max_age_hours} hours</dd>
                    </div>
                  </dl>
                </details>
                <button
                  onClick={() => void checkScanner()}
                  disabled={checking || !data.antivirus_enabled}
                >
                  {checking ? "Checking scanner…" : "Check scanner health"}
                </button>
                {check && (
                  <p className="connection-help" role="status">
                    Checked {formatDate(check.checked_at)}
                    {check.scanner.engine ? ` · ${check.scanner.engine}` : ""}
                    {check.scanner.signature_age_seconds !== undefined
                      ? ` · Signatures ${Math.max(0, Math.floor(check.scanner.signature_age_seconds / 3600))} hours old`
                      : ""}
                  </p>
                )}
              </section>
              <section className="card">
                <div className="connection-heading">
                  <span className="icon-tile">
                    <Icon name="lock" />
                  </span>
                  <Badge tone={data.key_service_ready ? "neutral" : "warning"}>
                    {data.key_service_ready
                      ? "Key service ready"
                      : "Key service unavailable"}
                  </Badge>
                </div>
                <h2>Encryption & access</h2>
                <p>
                  Each document has a separate encryption key. Only authorized
                  workflows can request decryption.
                </p>
                <details className="connection-details">
                  <summary>View details</summary>
                  <dl className="connection-facts">
                    <div>
                      <dt>Document encryption</dt>
                      <dd>
                        {data.document_encryption ||
                          "Unsupported encryption configuration"}
                      </dd>
                    </div>
                    <div>
                      <dt>Key protection</dt>
                      <dd>
                        {data.key_protector === "key-service"
                          ? "Isolated OneSmarter key service"
                          : "Local key custody"}
                      </dd>
                    </div>
                    <div>
                      <dt>Staff authentication</dt>
                      <dd>Password and multi-factor verification</dd>
                    </div>
                    <div>
                      <dt>Recipient authentication</dt>
                      <dd>Invitation and email verification code</dd>
                    </div>
                  </dl>
                </details>
                <p className="connection-help">
                  Configuration is not an independent security certification.
                </p>
              </section>
              <section className="card">
                <h2>Approved sender addresses</h2>
                <p>
                  These addresses are authorized for your account. They do not
                  grant access to other staff conversations.
                </p>
                {data.sender_addresses.length ? (
                  data.sender_addresses.map((address) => (
                    <div className="sender-row" key={address}>
                      <Icon name="mail" />
                      {address}
                      <Badge>Approved</Badge>
                    </div>
                  ))
                ) : (
                  <p>
                    No sender addresses assigned. Contact your administrator
                    before composing a message.
                  </p>
                )}
                {data.can_manage_senders ? (
                  <a className="button" href="#/access/accounts">
                    Manage staff sender permissions
                  </a>
                ) : (
                  <p className="connection-help">
                    Contact an administrator with privilege-management
                    permission to change sender addresses.
                  </p>
                )}
              </section>
              <section className="card">
                <h2>Your notification activity</h2>
                <p>
                  Delivery activity for messages you initiated. Provider
                  acceptance does not guarantee inbox delivery or reading.
                </p>
                <details className="connection-details">
                  <summary>View details</summary>
                  <dl className="connection-facts">
                    <div>
                      <dt>Waiting or sending</dt>
                      <dd>{pending}</dd>
                    </div>
                    <div>
                      <dt>Accepted by mail provider</dt>
                      <dd>{data.delivery_counts.provider_accepted || 0}</dd>
                    </div>
                    <div>
                      <dt>Failed or uncertain</dt>
                      <dd>
                        {(data.delivery_counts.failed || 0) +
                          (data.delivery_counts.uncertain || 0)}
                      </dd>
                    </div>
                    <div>
                      <dt>Captured, not emailed</dt>
                      <dd>{data.delivery_counts.development_delivered || 0}</dd>
                    </div>
                  </dl>
                </details>
                <a className="button" href="#/messages">
                  View conversations & delivery details
                </a>
              </section>
            </div>
          </>
        )
      )}
    </>
  );
}
