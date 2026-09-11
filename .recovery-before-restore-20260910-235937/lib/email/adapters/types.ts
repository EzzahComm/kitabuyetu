export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType: string;
}

export interface EmailPayload {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
  attachments?: EmailAttachment[];
  tags?: Record<string, string>;
  // Internal metadata written to email_logs
  groupId?: string;
  userId?: string;
  templateKey?: string;
  category?: string;
  referenceId?: string;
  referenceType?: string;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  provider: string;
  error?: string;
  dryRun?: boolean;
}

export interface IEmailAdapter {
  send(payload: EmailPayload): Promise<EmailResult>;
  readonly name: string;
}
