# Connect an externally hosted group website

The group keeps its website, DNS provider and hosting account. Kitabu Yetu authenticates its active chairperson, treasurer or secretary against the group's existing records. A domain connection does not create a group, membership, payment account or subscription. A Subira International Enterprise organization and a participating community group have separate identities. Connect a domain to its actual Kitabu Yetu group.

## Open the Kitabu Yetu workspace

1. Sign in to the group as its chairperson. In **Settings → Group website sign-in**, (or **Website sign-in** in Chama Reminder), enter the exact hostname serving the external website. The apex and a www hostname are distinct.
2. Publish the displayed TXT value at the displayed record name. DNS dashboards that append the zone name expect only the relative record name. Keep your current A, AAAA, CNAME and hosting configuration.
3. Choose **Verify DNS**. Keep the TXT record. Sign-in visits automatically renew verification during the final seven days of a 30-day lease. If DNS stops proving ownership, access ends when the lease expires. **Verify DNS** also retries immediately after a DNS correction. One group can have one connected hostname, and a verified hostname belongs to one group.
4. Copy the sign-in URL shown in Settings to a button on the external website. A static website only needs that link. It opens the verified group's sign-in page on Kitabu Yetu. Once an active officer confirms the group, their normal Kitabu Yetu workspace opens with its existing product access. Members with multiple groups can switch on the confirmation page.

## Sign in to the external application

A site with a backend can receive a short-lived delegated session. Implement these two routes on the external site. Use HTTPS and store credentials on the server.

1. At sign-in start, generate two independent random 32-byte values encoded as unpadded base64url for the verifier and state. Store them and the exact hostname in the visitor's server-side session, with a short expiry. Use a Secure, HttpOnly, SameSite=Lax session cookie. Compute the challenge as unpadded base64url of the SHA-256 digest of the verifier.
2. Redirect the visitor to the Kitabu Yetu origin at `/connect/{hostname}` with query parameters `state`, `code_challenge`, `code_challenge_method=S256` and `scope`. The officer authenticates on Kitabu Yetu, selects the connected group and reviews the requested access.
3. Implement the exact callback `https://{hostname}/kitabuyetu/callback`. Compare the returned state with the stored value, check expiry, and consume the pending sign-in once. Reject missing or mismatched state before exchanging the code. Never accept a callback destination supplied by a visitor.
4. From the website backend, POST JSON to `/api/connect/token` on the Kitabu Yetu origin with `hostname`, `code` and `code_verifier`. The single-use code expires after two minutes. A successful response has `access_token`, `token_type`, `scope` and `expires_in` (900 seconds). Keep the token in the server-side session. Redirect the browser to a clean application URL and omit authorization query strings from callback logs.
5. Call `GET /api/v1/auth/domain-identity` with `Authorization: Bearer <access_token>`. Bind the website session to the returned `data.groupId` and `data.memberId`. Role, group status, verified domain, session version and membership are checked against the database on each delegated API request. Recheck identity when authorizing local actions, end the local session on a 401, and start a new sign-in when access expires. Handle 402 for missing product access and 403 for insufficient permissions. Clearing the website's server session ends that local sign-in.

| Requested scope      | Available operations on the Kitabu Yetu origin                                                                                                                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `identity` (default) | Read the signed-in leader's member ID, group ID and role.                                                                                                                                                                                     |
| `group.read`         | Identity plus GET requests to `/api/v1/billing/entitlements`, `/api/v1/meetings`, `/api/v1/contributions`, `/api/v1/reports`, `/api/v1/campaigns` and `/api/v1/sms/credits`. Each endpoint enforces its normal group and product permissions. |
| `meetings.write`     | All of the above plus `POST /api/v1/meetings` with the normal meeting creation payload and role permissions.                                                                                                                                  |

Other group actions, including financial approvals and payments, run in the full Kitabu Yetu workspace via the sign-in link. A connected site receives no database credentials, tenant refresh token or backoffice session. Disconnecting the domain invalidates all of its codes and access tokens.

## Backend example

These Node.js functions accept a server-side session object. Set `KITABU_ORIGIN` to the HTTPS Kitabu Yetu origin and `GROUP_HOSTNAME` to the verified hostname in your application configuration. Persist the session before redirecting. The callback handler should redeem a pending state once, regenerate the website session ID on sign-in, and store the returned identity and token on the server.

```js
import { createHash, randomBytes } from 'node:crypto';

const origin = new URL(process.env.KITABU_ORIGIN).origin;
const hostname = process.env.GROUP_HOSTNAME;
const random = () => randomBytes(32).toString('base64url');

export function startSignIn(session) {
  const state = random();
  const verifier = random();
  session.pending = { state, verifier, expires: Date.now() + 10 * 60_000 };
  const url = new URL('/connect/' + hostname, origin);
  url.search = new URLSearchParams({
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    scope: 'identity',
  }).toString();
  return url.href;
}

export async function finishSignIn(pending, { state, code }) {
  if (!pending || !state || !code || state !== pending.state || Date.now() >= pending.expires)
    throw new Error('Start a new sign-in.');
  const exchange = await fetch(new URL('/api/connect/token', origin), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hostname, code, code_verifier: pending.verifier }),
  });
  if (!exchange.ok) throw new Error('Authorization expired. Start a new sign-in.');
  const token = await exchange.json();
  const identity = await fetch(new URL('/api/v1/auth/domain-identity', origin), {
    headers: { Authorization: 'Bearer ' + token.access_token },
  });
  if (!identity.ok) throw new Error('Could not verify the group leader.');
  return { identity: (await identity.json()).data, token: token.access_token };
}
```

## Release

Apply migration 222 after migrations 219–221 and deploy the matching application version. Migration 222 disables publication, removes the public snapshot function and retains previous drafts and enquiries privately. The website editor, public hosting routes and enquiry form have been removed. Reconnecting an old website requires verifying the actual group's domain. No custom domain is preassigned to Subira or the Rotary pilot.
