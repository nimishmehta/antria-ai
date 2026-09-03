---
name: mcp-builder
description: Design and build a Model Context Protocol (MCP) connector so the office gets real "hands" into an outside system (CRM, billing, support, internal API). Use when a role needs live read/write access to a tool that isn't yet connected, and a connector must be built rather than an existing one enabled.
---

# MCP Builder

Build a clean MCP server that gives an agent live tools into an external system. Prefer enabling an existing official connector over building one; build only when none exists.

## Before building
- Check whether an official/community MCP already covers it (Slack, Gmail, Calendar, Stripe, HubSpot, Zendesk, Linear, GitHub, Atlassian, Mixpanel, etc.). Enabling beats building.
- Respect the tool-count ceiling: a live agent should see ~5–9 MCP servers max. More servers = worse tool selection. Scope the new server to the few tools that matter.

## How to build
Use the official MCP SDK (`@modelcontextprotocol/sdk` for TypeScript, or the Python SDK). A server exposes **tools** (actions), **resources** (readable data), and optionally **prompts**.

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
const server = new McpServer({ name: "acme", version: "1.0.0" });
server.tool("get_customer", { id: z.string() }, async ({ id }) => {
  const r = await acme.customers.get(id);
  return { content: [{ type: "text", text: JSON.stringify(r) }] };
});
```

## Quality bar
- **Few, well-named tools** that map to real jobs ("get_open_invoices", not "query"). Each with a crisp description and a typed schema — descriptions are how the agent picks.
- **Read-only by default.** Any write/delete/send tool is outward-facing → gate it, and surface to the founder before it fires.
- **Secrets** via environment/config, never hardcoded. Handle auth failures with a clear message, not a crash.
- Register it, document the env vars the founder must set, and note that outward-facing connectors need the founder's login/authorization.

## When NOT to use
If a connector already exists → just enable it (that's an Ops/founder auth step, not a build). This skill is for building a new one.
