# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Hipp0, please report it responsibly.

**Email:** hello@hipp0.ai

Please include:
- A description of the vulnerability
- Steps to reproduce the issue
- Any potential impact assessment
- Suggested fix (if you have one)

We will acknowledge your report within 48 hours and aim to provide a fix within 7 days for critical issues.

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | Yes                |

## Security Best Practices for Self-Hosting

When self-hosting Hipp0, follow these guidelines to keep your deployment secure:

### Authentication & Access

- Always set strong, unique values for `JWT_SECRET` and `API_KEY` environment variables
- Never commit `.env` files or secrets to version control
- Rotate API keys and secrets regularly
- Use environment variables or a secrets manager for all sensitive configuration

### Network Security

- Deploy behind a reverse proxy (nginx, Caddy) with TLS termination
- Restrict database access to the application server only — do not expose PostgreSQL publicly
- Use a firewall to limit inbound traffic to only necessary ports (443 for HTTPS)
- Enable rate limiting at the reverse proxy level

### Database

- Use strong, unique passwords for PostgreSQL
- Enable SSL connections between the application and database
- Run regular backups and test restore procedures
- Keep PostgreSQL updated with security patches

### Container Security

- Run containers as non-root users
- Keep base images updated
- Scan container images for vulnerabilities
- Use read-only filesystem mounts where possible

### Monitoring

- Monitor application logs for unusual activity
- Set up alerts for failed authentication attempts
- Review access logs regularly
- Use the built-in audit trail for tracking data access

## Disclosure Policy

We follow coordinated disclosure. Please allow us reasonable time to address vulnerabilities before public disclosure. We credit reporters in our release notes (unless you prefer anonymity).
