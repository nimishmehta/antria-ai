# Security

## What Antria does on your machine

Antria is a desktop application that runs locally and drives a coding agent CLI
(Claude Code or Codex) on your behalf. Understanding that shape matters for
assessing risk:

- **It reads and writes real files** in whatever folder you point it at.
- **It runs commands** on your machine as part of completing a task.
- **It uses your existing AI subscription.** Antria does not proxy your work
  through any server operated by us.
- **Your files and prompts stay local.** They go to your AI provider the same way
  they would if you used that provider's own CLI, and nowhere else.

There is no Antria-operated backend that stores your content, and no telemetry
that carries your file contents.

## Supported versions

Only the latest release receives security fixes. Antria updates itself, so the
best thing you can do is let it.

| Version | Supported |
| --- | --- |
| Latest release | Yes |
| Anything older | No |

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Report it privately through GitHub Security Advisories:

https://github.com/nimishmehta/antria-ai/security/advisories/new

Or by email to **nmehta@bookr.inc** with `SECURITY` in the subject line.

Please include what you found, how to reproduce it, and what an attacker could
achieve. You will get an acknowledgement within a week and an honest estimate of
when a fix will ship. If you would like credit in the release notes, say so.

Please give a reasonable window to ship a fix before disclosing publicly.

## Things that are not vulnerabilities

Antria is *designed* to act autonomously on your files when you ask it to. The
following are expected behaviour, not security flaws:

- The app modifying or deleting files inside a folder you selected.
- The app running commands you did not individually approve, in a mode where you
  asked it to work autonomously.
- A task producing a wrong or low-quality result.

A genuine vulnerability would be something like: the app acting outside the
folder you granted, leaking credentials or file contents to a third party, or
allowing content in a file to take control of the agent and perform actions you
never asked for.
