# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Instead, use GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository ("Security" tab → "Report a vulnerability").

You can expect an acknowledgment within a few days. Please include reproduction steps and the
affected component (module path). Coordinated disclosure is appreciated — we'll credit reporters
in the release notes unless you'd rather stay anonymous.

## Supported versions

The latest release and `main` receive security fixes. Because instances self-host, fixes ship as
ordinary releases with clearly-marked security notes in the changelog — subscribe to releases.

## Hardening checklist for operators

- Set a long random `SESSION_SECRET` and `INBOUND_EMAIL_SECRET`; never keep the dev defaults.
- Run Postgres with a dedicated user and network isolation (the compose file keeps it un-exposed).
- Put the app behind TLS (reverse proxy such as Caddy/nginx/Traefik).
- Restrict `/api/inbound-email` at the proxy to your email provider's webhook IPs where possible.
- Back up Postgres (that is the entire state); test restores.
- Data-privacy note: this platform makes **no third-party model/API calls** — support data stays
  on your server. Outbound traffic is limited to SMTP and any webhooks you configure.
