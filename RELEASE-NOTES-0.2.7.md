# Antria 0.2.7

What's new since 0.2.6:

1. Login flow fixed — one-click login. No more popup storm; the sign-in window opens once, and the auth-code entry is durable (a single-flight guard prevents the overlapping login attempts that used to stall the first sign-in of a session).

2. Image generation unblocked — connected tools (Canva, Figma, Webflow, …) can generate images again. The earlier blanket block that over-restricted every connected tool is gone; the built-in ChatGPT/Codex image path stays removed.

Also in this line: crash-proof task completion (disk heartbeat + terminal record + PID liveness so a task can't be silently left unfinished) and the dual-engine groundwork underneath the office.
