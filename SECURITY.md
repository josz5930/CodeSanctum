# Security Policy
## Reporting a Vulnerability

Report vulnerabilities **privately** using
[GitHub Security Advisories](https://github.com/josz5930/CodeSanctum/security/advisories/new)
("Security" tab → "Report a vulnerability"). Do not open a public issue or
pull request for a suspected vulnerability.

### What a report must include

We only triage reports that include all three of the following. Reports
missing any of them will be closed without action:

1. **A detailed description of the impact** — what an attacker can achieve,
   what trust boundary or guarantee it breaks (e.g. confidentiality of
   uploaded source, integrity of an attestation, isolation between jobs),
   and any preconditions required.
2. **A full proof-of-concept script** that reliably demonstrates the issue
   end-to-end. Descriptions of a hypothetical bug without a working
   reproduction will be rejected automatically.
3. **A proposed fix** — a concrete, specific code change (e.g. a diff or
   patch) that addresses the root cause, not just the symptom. We may not
   merge it as-is, but it must be specific enough to show you understand
   the fix, not just the break.

### What happens next

- Once a fix is released, we will **publicly acknowledge** your report and
  credit you (by name, handle, or anonymously — your choice) in the
  advisory and/or release notes, unless you ask us not to.
- If the report has been rejected or closed, no action or receipt will be provided.
- No monetary reward (or similar) will be provided for any report under any circumstances.

## Scope

In scope: exploitable vulnerabilities (excluding design issues) that breaks the confidentiality, integrity, or verifiability aims of the system.

Out of scope: vulnerabilities in third-party dependencies with no CodeSanctum-specific exploitation path (report those upstream), older versions and variants of CodeSanctum and the withheld proprietary Semgrep ruleset.

## Good-Faith Testing
We welcome security research conducted in good faith: testing limited to
your own accounts/data, no service disruption, no access to or
exfiltration of other users' data, and private reporting.

We do not offer a safe-harbor pledge or any waiver of legal rights for
testing — including but not limited to data destruction, privacy violations, service disruption, social engineering,
extortion, or public disclosure ahead of a coordinated release. Bad-faith activity may be referred to law enforcement and/or pursued through legal
action at our discretion.
