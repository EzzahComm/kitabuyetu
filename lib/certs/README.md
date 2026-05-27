# Safaricom Daraja Public Certificates

The B2C, Reversal, Account Balance, and Transaction Status APIs require the
initiator password to be encrypted (RSA / PKCS#1 v1.5) against Safaricom's
public certificate before transmission. The resulting blob is sent as the
`SecurityCredential` field.

`lib/utils/mpesa-credential.ts` performs this encryption at boot. It loads the
public cert from one of three sources, in priority order:

1. **`MPESA_PUBLIC_CERT_PEM` env var** — full PEM string, including the
   `-----BEGIN CERTIFICATE-----` headers. Preferred for Vercel / serverless
   deploys where filesystem reads are unreliable.
2. **`MPESA_PUBLIC_CERT_PATH` env var** — absolute or repo-relative path to a
   `.cer` file. Use this when you want to keep the cert outside `lib/certs/`.
3. **`lib/certs/sandbox.cer` or `lib/certs/production.cer`** — selected by
   `MPESA_ENV`. The fallback for self-hosted deployments.

## Where to get the certs

Both files are public artifacts published by Safaricom. They rotate
infrequently (last update 2021), but the credential util re-reads them on
every cold start so a redeploy is enough to pick up a new cert.

- **Sandbox** — `https://developer.safaricom.co.ke/docs#security-credentials`
  (sandbox tab). Download the `.cer` file and save as `sandbox.cer`.
- **Production** — same page, production tab. Save as `production.cer`.

If you prefer the env-var approach, copy-paste the PEM contents into
`MPESA_PUBLIC_CERT_PEM`. Multi-line env vars are supported by Vercel and
most CI systems; quote with backslash-newline or `$'...'` shell syntax if
needed.

## Pre-encrypted alternative

If your operator workflow already encrypts the password externally (e.g. via
the "Security Credentials" page of the Daraja portal which returns a base64
blob), set `MPESA_B2C_SECURITY_CREDENTIAL` to that blob and the credential
util will use it directly without performing any RSA work. This bypasses the
need for the cert file entirely.

## Rotation

When Safaricom rotates their cert (rare), replace the `.cer` file and
redeploy. The `daraja:credential` Redis key (if added later for caching the
encrypted blob) should also be flushed.
