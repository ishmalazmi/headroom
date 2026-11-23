# Security

Headroom reads local usage logs and, when the Claude limits option is on, a saved sign-in token. Problems in that area matter, so please report them privately.

## Reporting a vulnerability

Use **Security → Report a vulnerability** on the GitHub repository (private vulnerability reporting). Please do not open a public issue.

Include what you found, how to reproduce it, and which platform and version you used. You can expect a first reply within a week.

## In scope

- Headroom leaking, logging or storing a credential or the contents of session logs.
- Headroom sending data anywhere other than the documented, opt-in Anthropic usage request.
- Headroom writing to or modifying another tool's files.
- Code execution through a crafted log or config file.

## Supported versions

Only the latest release receives fixes.
