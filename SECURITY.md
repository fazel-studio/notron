# Security Policy

## Supported Versions

Only the latest release of Notron receives security updates.

| Version | Supported          |
| ------- | ------------------ |
| latest  | ✅                 |
| < latest | ❌                |

## Reporting a Vulnerability

We take security seriously. Please **do not** open a public issue for security
vulnerabilities.

To report a vulnerability, please email **zulfazlilsm@gmail.com** with:

- A description of the vulnerability.
- The affected version(s).
- Steps to reproduce (if possible).
- Any proof-of-concept or exploit details.

### What happens next

1. We will acknowledge receipt of your report within **72 hours**.
2. We will investigate and determine the impact and scope of the issue.
3. We will work on a fix and coordinate a disclosure timeline with you.
4. We will credit you (if you wish) once the fix is published.

We ask that you keep the vulnerability confidential until it has been
disclosed in a coordinated manner.

## Scope

The following are considered in scope for security reports:

- The Rust/Tauri backend under `src-tauri/`.
- The Svelte frontend under `src/`.
- Any IPC command exposed to the frontend.
- File system, terminal, or debug operations handled by the application.

Out of scope: issues in third-party dependencies that are already tracked by
their upstream maintainers.
