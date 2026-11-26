# Subira International deployment

Create a dedicated Vercel project and import this repository with the root directory set to `sites/subira` and the framework preset set to Other. Deploy this branch as a restricted preview. This directory serves static files and requires zero runtime environment variables.

Use the preview to approve Subira's branding, page content, and contact destination. Before launch, implement the agreed pages and verify mobile navigation and contact delivery. Review whether search engines should index the finished site before changing the robots directives.

For production, add `subirainternational.kitabuyetu.co.ke` to the dedicated project and compare Vercel's required DNS record with the record already in place. Verify domain assignment and HTTPS before sharing the URL.

## Enterprise workspace

Use Kitabu Yetu's existing organization setup and invitation flows to create Subira's workspace, approve the plan, and enroll its designated administrator. Keep authentication on the central Kitabu Yetu portal and link to it from the website after workspace acceptance. Keep database credentials on the central backend. Verify invitations and roles in staging with two test organizations. Confirm that authorized users can view their own records and that application routes, data queries, exports, and storage used by the agreed workflows enforce tenant boundaries.

## Enterprise API

Confirm the first Subira workflow and eligible plan before selecting endpoints. Add approved operations to Kitabu Yetu's versioned API, keeping tenant membership, integration scopes, plan entitlements, rate limits, and audit logging on the platform. Store integration credentials in the consuming Vercel project's server environment. Use test credentials in previews.
