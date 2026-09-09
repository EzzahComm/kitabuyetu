# CHATGPT OPTIMIZATION REQUEST

You are reviewing an existing production application.

This package was generated entirely by PowerShell.
There is NO Claude Code subscription or Claude CLI dependency.

## PROJECT ROOT

D:\Claude\Projects\KITABU YETU\kitabuyetu

## RUN

D:\Claude\Projects\KITABU YETU\kitabuyetu\.optimization\20260909-133206

## EVIDENCE

### Existing audits

D:\Claude\Projects\KITABU YETU\kitabuyetu\.optimization\20260909-133206\audits

### Claude/project context

D:\Claude\Projects\KITABU YETU\kitabuyetu\.optimization\20260909-133206\context

### Dependency evidence

D:\Claude\Projects\KITABU YETU\kitabuyetu\.optimization\20260909-133206\dependencies

### Framework evidence

D:\Claude\Projects\KITABU YETU\kitabuyetu\.optimization\20260909-133206\framework

### Git evidence

D:\Claude\Projects\KITABU YETU\kitabuyetu\.optimization\20260909-133206\git

### Reports

D:\Claude\Projects\KITABU YETU\kitabuyetu\.optimization\20260909-133206\reports

---

# BASELINE SUMMARY

Project files: 1337
Audit files: 43
Context files: 8
Next.js detected: True
Supabase detected: True
Vercel detected: True
Package manager: npm
Node: v24.11.1
TypeScript baseline: True
Lint baseline: False
Build baseline: True
Git branch: main
Git commit: f5ff6b5e1a9271d6a2eda5d1d0bafecfcc50b1d1

---

# YOUR TASK

Review the evidence and produce a controlled optimization plan.

DO NOT invent findings.

DO NOT assume old audit findings are still valid.

Validate historical findings against the current project evidence.

Prioritize:

1. Critical security issues
2. Reliability issues
3. Database issues
4. Authentication/authorization issues
5. Performance issues
6. Deployment issues
7. Cost/scalability issues
8. Maintainability

Pay particular attention to:

- Next.js architecture
- React server/client boundaries
- unnecessary client JavaScript
- caching
- database queries
- Supabase RLS
- Supabase service-role usage
- M-Pesa callbacks
- Resend/email
- SMS integrations
- Vercel deployment
- Vercel cron
- environment variables
- dependency vulnerabilities
- database connection pooling
- API validation
- authentication
- authorization
- logging
- error handling

## SECURITY RULE

Never request or expose actual secret values.

Environment files are intentionally excluded from content collection.

---

# REQUIRED OUTPUT

Produce:

## 1. OPTIMIZATION-PLAN.md

Include a table:

| ID | Finding | Evidence | Severity | Impact | Effort | Risk | Recommendation |
|----|---------|----------|----------|--------|--------|------|----------------|

Then classify:

- Critical
- High
- Medium
- Low
- Already Fixed
- False Positive / Obsolete

## 2. POWERSHELL COMMAND FILE

Return a complete file named:

OPTIMIZATION-COMMAND.ps1

It MUST begin with exactly:

# OPTIMIZATION-COMMAND-V1

The command file must contain ONLY changes that you recommend implementing.

Every modification must be explicit.

Preferred operations:

- Set-Content
- Add-Content
- Copy-Item
- Move-Item
- Rename-Item
- New-Item
- package-manager commands where appropriate

Avoid destructive commands.

Do not modify:

- .env
- production credentials
- secrets
- certificates
- SSH keys

unless the change only updates an example/template file.

Before modifying an existing file, create a backup if the command file itself is being run outside the main workflow.

## 3. VALIDATION COMMANDS

Also return:

VALIDATION-COMMANDS.ps1

with commands that should be run after optimization.

Use:

- npm run lint
- npx tsc --noEmit
- npm run build
- npm audit
- relevant tests
- Supabase checks where available

## 4. FINAL EXPECTED RESULT

Explain:

BEFORE
→
CHANGE
→
EXPECTED AFTER

Do not claim a performance improvement without measurement.

---

# IMPORTANT

PowerShell will execute your returned command file only after human review.

Do not return a command file that performs broad rewrites.

Prefer small, reversible, testable changes.
