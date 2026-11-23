# Enterprise identity, APIs and billing events

A client can host its public website on cPanel under its own domain. A link can open the Kitabu Yetu workspace for staff or a Kitabu Yetu invitation for participants. The website backend calls authenticated integration APIs only if it needs a private portal or automated workflows. Kitabu Yetu keeps the organization membership, product entitlements, invoices and confirmed payment records.

The first release supports managed OIDC connections, read-only partner APIs and a signed Enterprise plan-change event. Enterprise password sign-in and MFA remain available. Subira's web redirect is a separate change.

## Staff sign-in with OpenID Connect

Use a managed identity provider and a maintained OpenID Connect client. Start with Kitabu Yetu acting as a relying party for one Enterprise organization. If the client also needs a private portal, register the cPanel backend as a separate relying party with the same provider. This lets the two applications use the same staff identity with independent sessions and audiences. A client without a compatible identity provider can continue to use Kitabu Yetu sign-in and MFA.

- Approve one issuer per pilot organization. Register exact HTTPS callbacks and use authorization code with PKCE, state and nonce.
- Validate the issuer, audience, signature and expiry. Use an approved discovery endpoint and signing keys. Bind a staff account by issuer and subject under the organization connection. An email match alone cannot link an identity or grant an organization role.
- Require an existing or explicitly invited staff membership. Check its organization, role and status when creating a Kitabu Yetu session and on protected operations. Preserve the MFA requirement for sensitive actions and keep a tested recovery path.
- The cPanel backend stores its own session in a secure, HTTP-only cookie. Machine credentials and tokens remain on the server.

If the client site specifically needs to accept existing Kitabu Yetu accounts without a shared identity provider, Kitabu Yetu would need to offer an identity-provider service. Evaluate a managed provider for that use case as a separate decision.

## Server-to-server API

Register a separate application per organization and environment. Use OAuth client credentials to issue short-lived, audience-bound access tokens. Grant explicit scopes, such as `billing.read` and `invitations.write`. Use an approved machine principal in the tenant authorization layer and derive organization scope from that principal. Add revocation, rotation, per-client rate limits and an audit trail. Public browser code carries no client credential.

The first version should expose current plan and entitlements. Enable invoice and payment status for records that have an explicit verified billing owner. Existing platform invoices are group-scoped. An organization invoice or sponsored subscription workflow needs an explicit payer and entitlement model before it can accept money or produce an organization receipt.

Add invitation creation after the read path passes tenant-isolation tests. Require idempotency keys for writes and validate retries against the original operation and parameters. A group or member linked through the API follows the same consent, plan, role and billing rules as in the portal. Kitabu Yetu handles checkout. A provider-confirmed and reconciled payment drives the billing record and entitlement.

## Signed webhooks

Publish events after the corresponding state has been committed. Start with `payment.confirmed`, `payment.reversed`, `invoice.issued` and `subscription.updated` where those states are supported. Store events in a transactional outbox and deliver them outside the billing transaction. Each payload includes a stable event ID, event type, organization ID, resource ID, occurrence time and schema version. Send only the data the subscriber needs.

Use an approved HTTPS endpoint and a separate signing secret per endpoint. Sign the event ID, delivery timestamp and raw body. The recipient verifies the signature and timestamp before parsing, deduplicates by event ID and acknowledges after recording the event durably. Use bounded retries with backoff, replay failed deliveries from an audit screen, and support a short overlap when rotating signing secrets. For late or out-of-order events, the recipient can fetch the current resource state through the API.

## Subira pilot and release gates

1. Confirm Subira's Enterprise organization, verify the public domain and confirm the staff identity provider and exact callback URLs.
2. Test staff sign-in in staging, including revoked membership, cross-organization access, MFA and recovery. Start with the existing links from the client's website.
3. Enable one machine client with `billing.read`. Obtain agreement on who pays before enabling organization invoices or sponsored subscriptions. Reconcile a sandbox invoice and payment against the Enterprise billing view and administrator dashboard using the same durable record IDs.
4. Verify signed delivery, replay, failed delivery and out-of-order handling on one HTTPS webhook. Extend to invitations and other approved writes after these checks pass.

## Configure the first release

An operator sets `ENTERPRISE_INTEGRATIONS` in the deployment environment. With no entries, partner routes are unavailable and plan assignments enqueue no partner deliveries. The cPanel site stays on its own host. No schema migration is required.

```json
{
  "clients": [
    {
      "organizationId": "00000000-0000-4000-8000-000000000001",
      "issuer": "https://identity.example.com/",
      "audience": "https://www.kitabuyetu.co.ke/api/partner/v1",
      "jwksUrl": "https://identity.example.com/.well-known/jwks.json",
      "clientId": "enterprise-backend",
      "subject": "enterprise-backend",
      "scopes": ["billing.read", "products.read"],
      "products": ["kitabu_yetu", "chama_reminder"]
    }
  ],
  "webhooks": []
}
```

- Obtain access tokens via the approved issuer's client-credentials flow. Use JWT access tokens of type `at+jwt` with exact issuer, audience, subject and client ID and a maximum token age of 15 minutes. Include the requested API scope.
- Call `GET /api/partner/v1/plan` or `GET /api/partner/v1/groups/{groupId}/products` with the bearer token. Limits are 30 requests per client and 120 per organization in a 60-second window, per scope. Senders should honor `Retry-After`.
- To enable one webhook, add its `organizationId`, unique UUID `endpointId`, approved HTTPS `url` and 32-byte secret as 64 hexadecimal characters. Verify the endpoint and owner before entering it in deployment settings. Adding, changing or disabling a destination takes effect on deployment.
- The worker sends `subscription.updated` from the existing database-backed queue. The headers are `Webhook-Id`, `Webhook-Timestamp` and `Webhook-Signature`. Compute Base64 HMAC-SHA256 over `id.timestamp.rawBody` using the decoded secret bytes and compare against the value after `v1,`. Reject stale timestamps and duplicate event IDs. Kitabu Yetu retries failed delivery, with up to six attempts. A revoked or replaced destination is skipped.
- The plan event reports the new subscription ID and time. Use the plan API to fetch the current amount and tier. Payment events, organization invoices and write APIs are outside this release.

### Enable staff OIDC

Set `ENTERPRISE_OIDC_CONNECTIONS` to an array of managed connection records containing `name`, `organizationId`, `issuer`, `authorizationUrl`, `tokenUrl`, `jwksUrl`, `clientId`, `clientSecret` and `members`. The members object maps exact provider subjects to verified Kitabu Yetu member UUIDs. Support must verify each link and existing MFA enrollment before enabling it. Use the provider's authorization code flow with S256 PKCE and `client_secret_post` for token exchange.

Register `/api/partner/v1/oidc/callback` on the canonical HTTPS origin configured by `NEXT_PUBLIC_APP_URL`. Link approved staff to `/api/partner/v1/oidc/start?connection=<name>` on that origin. The browser returns to Enterprise login to finish Kitabu Yetu MFA. The resulting session is locked to the configured organization. Use a different login session to access another organization.
