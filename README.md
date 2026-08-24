# Switchback MCP

> MCP server for [Switchback](https://github.com/VibeKit-Bot/vibekit-switchback) — classify AI agent turns by complexity and pick the cheapest model that can handle them. Drop-in for Claude Desktop, Cursor, Cline, and any MCP client.

[![npm](https://img.shields.io/npm/v/vibekit-switchback-mcp?color=8b5cf6)](https://www.npmjs.com/package/vibekit-switchback-mcp)
[![Powers VibeKit](https://img.shields.io/badge/powers-VibeKit-8b5cf6)](https://vibekit.bot/switchback)

> Built by [VibeKit](https://vibekit.bot/?ref=github_switchback_mcp) — same cascade router that powers every "Auto" turn in our hosted product. [Learn more →](https://vibekit.bot/switchback?ref=github_switchback_mcp)

## What it does

Exposes two tools over the Model Context Protocol:

- **`classify_turn`** — given a user message, returns `{tier: 0|1|2, why, fallback, durationMs}`. Use it when you're deciding whether to spend on a flagship model or stay on a cheap one for the next agent step.
- **`recommend_model`** — given a user message + a ladder of models (cheap → flagship), returns the cheapest model on the ladder that can plausibly handle it. Convenience wrapper around `classify_turn`.

Both tools fire a single small-model call via OpenRouter (default: `openai/gpt-5.4-mini`, ~$0.0001/call). Fail-soft: any error returns tier 1 with `fallback: true` rather than blocking your agent.

## Install

```bash
npm install -g vibekit-switchback-mcp
```

## Configure

Set your OpenRouter key (get one at https://openrouter.ai/keys):

```bash
export OPENROUTER_API_KEY=sk-or-...
```

Optional: override the classifier model:

```bash
export SWITCHBACK_CLASSIFIER_MODEL=anthropic/claude-haiku-4.5
```

### Claude Desktop

Add to your `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "switchback": {
      "command": "npx",
      "args": ["-y", "vibekit-switchback-mcp"],
      "env": {
        "OPENROUTER_API_KEY": "sk-or-..."
      }
    }
  }
}
```

### Cursor / Cline / others

Any MCP client that supports stdio servers. Same `npx` invocation.

## Example calls

**classify_turn:**
```json
{
  "userMessage": "rebuild the auth flow with passkeys"
}
```
returns:
```json
{
  "tier": 2,
  "why": "architectural rework + new auth method",
  "fallback": false,
  "durationMs": 412
}
```

**recommend_model:**
```json
{
  "userMessage": "fix typo in README",
  "ladder": [
    "openai/gpt-5.4-mini",
    "openai/gpt-5.4",
    "openai/gpt-5.5"
  ]
}
```
returns:
```json
{
  "recommended_model": "openai/gpt-5.4-mini",
  "tier": 0,
  "ladder_size": 3,
  "classifier": { "tier": 0, "why": "trivial copy edit", "fallback": false, "durationMs": 318 }
}
```

## When to use it

- **Multi-step agents** where you can swap models between rounds.
- **BYOK-style products** where you want to keep all routing inside the user's chosen brand — pass a brand-locked ladder per user.
- **Cost-conscious orchestrators** that want to avoid spending flagship rates on trivial turns.

## When NOT to use it

- **One-shot chat completions** where you can't change models after the first call — use OpenRouter's `auto` or NotDiamond/Martian instead.
- **Latency-critical sub-200ms-first-token UX** — the classifier adds 200-500ms.

## License

MIT. See [LICENSE](./LICENSE).

Built by [VibeKit](https://vibekit.bot/?ref=github_switchback_mcp). The core library is [`vibekit-switchback`](https://www.npmjs.com/package/vibekit-switchback) — this package is the MCP wrapper.
