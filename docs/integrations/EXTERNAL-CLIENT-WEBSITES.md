# Connect an externally hosted client website

## Subira International

- Subira International runs in a dedicated Vercel project at `https://subirainternational.kitabuyetu.co.ke/`.
- Kitabu Yetu serves `/subira` on its Vercel deployment. The route returns a temporary redirect to that fixed HTTPS address and drops inbound query parameters.
- An externally hosted site can link to [Enterprise sign-in](https://www.kitabuyetu.co.ke/enterprise/login) and [Enterprise signup](https://www.kitabuyetu.co.ke/register-organization) today. Staff complete sign-in and MFA on Kitabu Yetu and use its Enterprise portal for billing and administration.

## API integration

Use the client website's backend as the API client. A public site can use links alone. If the website needs protected account or billing information, enable that after registering Subira's actual Kitabu Yetu organization and verifying its domain.

1. Register an organization-scoped application with an exact HTTPS callback URL. Use authorization code with PKCE and state for delegated staff sign-in. Check current organization membership and permissions when issuing or using scoped access. Store the website's session and tokens server-side.
2. For background processes, issue a separate revocable credential scoped to the minimum organization operations. Keep credentials in the cPanel backend. Add versioned endpoints for the agreed onboarding and billing actions. The portal's admin routes are scoped to authenticated staff sessions.
3. Start with read access to the current plan, invoices and payment status where those records are supported. Scope write operations separately, such as creating a programme invite. All API calls must use the same product, billing and membership rules as the Kitabu Yetu portal.
4. Keep invoicing, checkout and payment confirmation on Kitabu Yetu. If the client needs status updates, send signed webhooks with stable event IDs so its backend can safely handle retries. Test tenant isolation and duplicate events before activation.

For pilot capabilities and configuration, see [Enterprise identity, APIs and billing events](./ENTERPRISE-IDENTITY-AND-BILLING.md).
