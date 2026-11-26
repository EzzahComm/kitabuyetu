# Kitabu Yetu email strategy

Use the configured sender for platform mail. Route replies to the team responsible for the message through the department directory.

| Email                     | When to send                                                         | What to include                                                                                  | Replies           |
| ------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------- |
| Group signup verification | After a registration or a requested resend                           | Group name, verification link and expiry                                                         | Support           |
| Verification code         | After a user requests a code                                         | Code in the message body, expiry and the page where it belongs                                   | Support           |
| Account welcome           | Once the account is ready for sign-in                                | Group name, sign-in link and any first sign-in instructions required by the current account flow | Support           |
| Invoice                   | After an invoice is issued, including a recurring invoice            | Invoice number, amount due, due date, and the matching M-Pesa Paybill account reference          | Billing           |
| Overdue reminder          | When an outstanding balance reaches the configured reminder stage    | Invoice number, outstanding balance and payment instructions                                     | Billing           |
| Payment receipt           | After a payment is recorded                                          | Receipt and invoice numbers, payment date, amount and method                                     | Billing           |
| Quotation                 | After billing approves a proposal and is ready to send it            | Quotation number, service summary, quoted KES total and validity date                            | Billing           |
| Newsletter                | After an admin previews and approves a digest for active subscribers | One clear topic, one main link and a per-recipient unsubscribe link                              | Configured sender |

The invoice and receipt bodies contain the essential details even when a PDF cannot be generated. Quote acceptance and payment are separate steps. The `quotation` template is available to the templated email service for a future billing workflow. Supply `quotationNumber`, `recipientName`, `serviceSummary`, `quotedTotal` and `validUntil` when using it.

Keep newsletter subscriptions separate from account and billing notifications. Preview each draft, verify its links and current product claims, and send only to active subscribers. The digest sender checks the subscription again when claiming each queued delivery. A recipient who opted out after launch is skipped and counted in the existing failed-delivery total with an explanatory reason.

Before releasing template changes, preview each message with representative data. For a live smoke test, use addresses you control, confirm sender and reply routing, open invoice and receipt attachments when present, and verify newsletter unsubscribe before approving a real audience send.
