# Subira International deployment

Create a dedicated Vercel project and import this repository with the root directory set to `sites/subira` and the framework preset set to Other. Deploy this branch as a restricted preview. This directory serves static files and requires zero runtime environment variables.

Use the preview to approve Subira's branding, page content, and contact destination. Before launch, implement the agreed pages and verify mobile navigation and contact delivery. Review whether search engines should index the finished site before changing the robots directives.

For production, add `subirainternational.kitabuyetu.co.ke` to the dedicated project and compare Vercel's required DNS record with the record already in place. Verify domain assignment and HTTPS before sharing the URL.

## Enterprise workspace

Use Subira's existing Kitabu Yetu workspace and verify the assigned plan and designated administrator. Open the [enterprise onboarding intake template](../../docs/integrations/ENTERPRISE-ONBOARDING-INTAKE.md) when onboarding a client. Trial staff sign in through the central Kitabu Yetu portal linked from the website. Keep database credentials on the central backend. Verify invitations and roles in staging with two test organizations. Confirm that authorized users can view their own records and that application routes, data queries, exports, and storage used by the agreed workflows enforce tenant boundaries.

## Enterprise API

Use the managed partner API documented in [Enterprise identity, APIs and billing events](https://github.com/EzzahComm/kitabuyetu/blob/main/docs/integrations/ENTERPRISE-IDENTITY-AND-BILLING.md).

1. Confirm Subira’s existing organization UUID and verify how its trial is represented. The partner plan read currently requires an active organization and an active organization subscription.
2. Register one server-side client for the pilot environment with the approved issuer. Start with `billing.read` and verify that `GET /api/partner/v1/plan` returns Subira’s expected plan. Preserve its trial terms.
3. Confirm which linked group and products Subira approved before granting `products.read`. Verify the products response for the approved group and denial for an unlinked group.
4. Once Subira approves an HTTPS receiver, configure the signed `subscription.updated` event and verify delivery and retries using test data. Treat the event as a signal to refresh the current plan. Avoid polling for plan changes and respect the API's rate-limit responses.

### Look up an existing workspace

In Kitabu Yetu backoffice, open **Organizations**, search by name or registration number, and open the exact match. The UUID is the last segment of `/admin/organizations/{id}`. Confirm the organization is active and review its assigned plan. If the backoffice is unavailable, an operator with read access can run this query in the Kitabu Yetu database:

```sql
SELECT o.id AS organization_id, o.name, o.is_active,
       s.id AS active_subscription_id, s.plan_type, s.started_at
FROM public.organizations AS o
LEFT JOIN public.organization_subscriptions AS s
  ON s.organization_id = o.id AND s.status = 'active'
WHERE lower(btrim(o.name)) = lower(btrim('Subira International'));
```

Confirm the record with the organization administrator if the search is ambiguous. An active plan alone does not establish trial status. Where the Enterprise coverage migration is applied, verify the trial expiry in `enterprise_coverage.trial_ends_at` for the confirmed UUID. Preserve the existing workspace and its coverage.

### Store and verify a pilot connection

- Record the verified organization UUID, environment, owner, approved issuer, JWKS URL, audience, client ID, subject and scopes in the access-controlled integration record. Keep organization-specific details out of this public repository.
- Add the client entry to `ENTERPRISE_INTEGRATIONS` in the **central Kitabu Yetu** project under the target environment, preserving existing entries. Keep the OAuth client secret in the calling backend's server-side secret settings. Subira's static website needs no secret.
- Deploy the central configuration, verify that the plan API rejects a request without a token, then verify that an approved `billing.read` token returns the expected organization and plan. If the API returns 503 before authentication, check for an empty integration client list. If an authenticated request returns 503, check the shared rate limiter.
- Add an approved product grant and webhook receiver only after the plan check. Record the endpoint ID and receiver owner in the integration record, keep the signing secret in server-side settings, and confirm that revoking the client or disabling its endpoint takes effect after deployment.
