# Security policy

`waveapps-mcp` stores Wave session cookies on disk and (optionally) your Wave password and TOTP secret. A vulnerability that exposes either could let an attacker act as you inside Wave. Please treat security bugs in this project seriously.

## Reporting a vulnerability

**Do not open a public GitHub issue for security bugs.**

Email **luna@lunaparker.dev** with:

- A description of the bug and what it lets an attacker do.
- Steps to reproduce, or proof-of-concept code.
- The affected version (`npm ls waveapps-mcp` or commit SHA).
- Your name / handle for credit (optional).

You can expect:

- An acknowledgement within **3 business days**.
- A fix or mitigation plan within **14 days** for high-severity issues (credential leak, RCE, auth bypass).
- A coordinated disclosure window before any public write-up.

## Out of scope

- Bugs in Wave Accounting itself — please report those to Wave directly. This project only consumes Wave's API; it does not host or modify Wave's services.
- Issues that require an attacker to already have read access to your local user account (e.g. "if someone reads `~/.config/waveapps-mcp/credentials.json` they can act as you" — yes, that's the documented trade-off; see the README).
- Bugs in third-party dependencies — please report those upstream. If a dependency-level CVE materially affects this project, we'll bump the version once a patched release is available.

## Scope worth reporting

- Credentials written to a world-readable path, or with weaker file permissions than `0600`.
- Credentials leaking into logs, error messages, or transport over the wire to anywhere other than Wave's own domains (`*.waveapps.com`).
- Anywhere the MCP server can be tricked by tool arguments into making a request that wasn't intended (SSRF, prompt-injection-driven exfiltration, etc.).
- Authentication-refresh logic accepting forged session responses.
- Pre-commit / CI hook bypasses that would let real secrets land in the public repo.

Thanks for helping keep `waveapps-mcp` users safe.
