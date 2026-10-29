export interface User {
  id: number;
  name: string;
  email: string;
  role: "staff" | "admin";
  organization: string;
  can_nophi: boolean;
  can_manage_privileges: boolean;
  can_export_audit: boolean;
  sender_addresses: string[];
  mfa_confirmed: boolean;
}
export interface Session {
  user: User | null;
  csrf: string;
  synthetic_mode: boolean;
  dev_tools: boolean;
  setup_required: boolean;
}
export interface FileItem {
  id: string;
  name: string;
  size: number;
  state: string;
  scan_method: string;
}
export interface Grant {
  id: string;
  email: string;
  kind: string;
  revoked: boolean;
  last_opened: string | null;
}
export interface Message {
  id: string;
  author: string;
  author_type: string;
  audience: string | null;
  body: string;
  created_at: string;
  attachments: FileItem[];
}
export interface Delivery {
  id: string;
  state: string;
  attempts: number;
  error_code: string;
}
export interface Conversation {
  id: string;
  subject: string;
  mode: string;
  protected: boolean;
  routing_reason: string;
  state: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
  revoked: boolean;
  unread: boolean;
  recipients: Grant[];
  messages?: Message[];
  delivery?: Delivery[];
}
export interface Page<T> {
  results: T[];
  count: number;
  page: number;
  page_size: number;
}
export interface Account {
  id: number;
  name: string;
  email: string;
  role: string;
  status: string;
  mfa_confirmed: boolean;
  can_nophi: boolean;
  can_manage_privileges: boolean;
  can_export_audit: boolean;
  sender_addresses: string[];
  last_login: string | null;
  last_activity: string | null;
  created_at: string;
  updated_at: string;
  created_by: number | null;
  usage: Record<string, number>;
  invitation?: { expires_at: string; consumed: boolean } | null;
}
export interface AuditEvent {
  id: string;
  occurred_at: string;
  actor_id: string;
  actor: string;
  role: string;
  action: string;
  target_type: string;
  target_id: string;
  outcome: string;
  metadata: Record<string, unknown>;
  archive_state: string;
  archive: { version: string; retain_until: string; digest: string } | null;
}
export interface AuditPage extends Page<AuditEvent> {
  snapshot: string;
  snapshot_at: string;
  archive_enabled: boolean;
  pending_archive: number;
}
export interface InboxItem {
  id: string;
  to: string;
  subject: string;
  body: string;
  link?: string;
  created_at: string;
}
