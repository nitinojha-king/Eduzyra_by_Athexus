# Reporting security issues

**Do not open a public issue for vulnerabilities.**

Email the maintainers privately with:
1. A description of the issue and its impact.
2. Steps to reproduce (request/response samples, no real credentials).
3. The commit hash / version you tested against.

We will acknowledge within 72 hours and coordinate a fix + disclosure timeline.

## Secrets hygiene

- Never commit `.env` or any file containing `RAZORPAY_KEY_SECRET`, `JWT_SECRET`,
  `SMTP_PASS`, or Cloudinary secrets. Only `.env.example` (placeholders) is tracked.
- If a key leaks (git history, logs, screenshots), **rotate it immediately** at the
  provider — redacting the commit is not enough.
- The local `.env` in this repo previously contained Razorpay **test** keys.
  Treat them as compromised and regenerate them in the
  [Razorpay dashboard](https://dashboard.razorpay.com/app/keys) before going live.
