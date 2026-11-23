# Connect a client website hosted on cPanel

## Subira International

- The client website runs on cPanel at `https://subira.kitabuyetu.co.ke/`. Its DNS record points to the cPanel host, which serves the site and renews its HTTPS certificate.
- Kitabu Yetu serves `/subira` on its Vercel deployment. The route returns a temporary redirect to the fixed cPanel address. It drops inbound query parameters. Publish the redirect once the cPanel address serves the intended Subira site over HTTPS.
- An externally hosted site can link to [Enterprise sign-in](https://www.kitabuyetu.co.ke/enterprise/login) and [Enterprise signup](https://www.kitabuyetu.co.ke/register-organization) today. Staff complete sign-in and MFA on Kitabu Yetu and use its Enterprise portal for billing and administration.

## API integration

Keep the cPanel website's backend as the API client. A public site can use links alone. If the website needs protected account or billing information, enable that after registering Subira's actual Kitabu Yetu organization and verifying its domain.

1. Register an organization-scoped application with an exact HTTPS callback URL. Use authorization code with PKCE and state for delegated staff sign-in. Check current organization membership and permissions when issuing or using scoped access. Store the website's session and tokens server-side.
2. For background processes, issue a separate revocable credential scoped to the minimum organization operations. Keep credentials in the cPanel backend. Add versioned endpoints for the agreed onboarding and billing actions. The portal's admin routes are scoped to authenticated staff sessions.
3. Start with read access to the current plan, invoices and payment status where those records are supported. Scope write operations separately, such as creating a programme invite. All API calls must use the same product, billing and membership rules as the Kitabu Yetu portal.
4. Keep invoicing, checkout and payment confirmation on Kitabu Yetu. If the client needs status updates, send signed webhooks with stable event IDs so its backend can safely handle retries. Test tenant isolation and duplicate events before activation.

Enterprise delegated authentication, partner API credentials and billing webhooks require implementation. The prepared redirect does not provision an organization, issue credentials or grant access to any account.
