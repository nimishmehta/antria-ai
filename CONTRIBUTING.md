# Contributing to Antria

Thanks for wanting to help. Here is the honest shape of this repository so you
don't waste your time.

## This repo has no source code

Antria is a closed-source desktop app. This repository holds the README, the
brand assets, and the released `.dmg` and `.exe` builds. There is nothing here
to send a pull request against, and pull requests that change the README wording
or assets will usually be closed with thanks.

**The one exception:** the office harness Antria is built on *is* open source and
does accept code. If you want to change how the AI team behaves — how work gets
staffed, when a specialist stops to ask you something, how results get reported —
that lives in
[**antria-office**](https://github.com/nimishmehta/antria-office), which is MIT
licensed and takes pull requests.

## What genuinely helps here

**Bug reports.** By far the most valuable thing. Antria runs on your own machine
against your own files, which means it hits situations no amount of testing here
will reproduce. Use the bug report template and include your OS, the Antria
version, and what you asked the team to do.

**Feature requests.** Especially ones that describe the *job* you were trying to
get done rather than the feature you imagined. "I needed to send a client a
weekly summary and had to do X by hand" is more useful than "add a summary
button".

**Telling us what was confusing.** If something in the app made no sense, that's
a bug in the product even if nothing crashed. Open an issue.

**Telling other people.** A free tool lives or dies on word of mouth.

## Before you open an issue

Search the existing issues first — including closed ones. If you find yours,
add a comment with your details rather than opening a duplicate.

Do not include anything confidential in an issue. Issues here are public, and
Antria works with your real business files. Redact before you paste.

## Security

Do not report a security vulnerability in a public issue. See
[SECURITY.md](SECURITY.md) for how to report one privately.
