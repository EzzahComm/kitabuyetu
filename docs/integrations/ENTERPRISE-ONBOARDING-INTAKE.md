# Enterprise onboarding intake

Copy this checklist into the team's access-controlled integration record for each client and environment. Record the source and verification date for each completed item. Store secret values in the relevant backend's secret settings and record only the secret reference here.

| Item | Record | Authoritative source |
| --- | --- | --- |
| Organization | Name, UUID and backoffice record URL | Kitabu Yetu Organizations detail page. The last path segment is the UUID. |
| Plan and coverage | Active plan, trial or paid coverage, and trial end date where applicable | Enterprise billing or the organization subscription and coverage records |
| Owners | Client administrator and Kitabu Yetu integration owner | Approved onboarding request and existing staff membership |
| Deployment | Environment, project, website domain and server-side calling service | Hosting dashboard and verified HTTPS URL |
| Machine client | Issuer, JWKS URL, audience, client ID, subject and approved scopes | Approved OAuth application and issuer metadata |
| Product access | Approved linked group IDs and eligible products | Kitabu Yetu group links and client approval |
| Billing webhook | Approved HTTPS receiver, endpoint ID, owner and signing secret reference | Receiver owner and central integration configuration |

## Verification

1. Use the existing organization record. Verify its status and coverage before enabling any integration.
2. Start with a server-side client scoped to `billing.read`. Verify unauthenticated rejection and a successful `GET /api/partner/v1/plan` response for the expected organization.
3. If the pilot includes `products.read`, verify the products for an approved linked group and confirm denial for an unlinked group.
4. If the pilot includes billing events, verify signed `subscription.updated` delivery, retries and duplicate handling with test data. Refresh the plan after the event.
5. Record the verification result, deployment reference and owner. See the [managed integration configuration](https://github.com/EzzahComm/kitabuyetu/blob/main/docs/integrations/ENTERPRISE-IDENTITY-AND-BILLING.md#configure-the-first-release).
