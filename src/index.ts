#!/usr/bin/env node
/**
 * Switchback MCP server.
 *
 * Exposes two tools to MCP clients (Claude Desktop, Cursor, Cline, etc.):
 *
 *   - `classify_turn` — given a user message + optional context, return
 *     a complexity tier (0/1/2) and a one-phrase explanation. The client
 *     can use this to decide which model to spend on for the next step.
 *
 *   - `recommend_model` — given a user message + a ladder (cheap →
 *     flagship), return the cheapest model that can plausibly handle it
 *     plus the reasoning. Convenience wrapper for clients that want a
 *     direct model pick.
 *
 * Both tools run a single classifier call via OpenRouter. Fail-soft —
 * any error returns tier 1 with a `fallback: true` flag rather than
 * blocking the agent.
 *
 * Requires env var `OPENROUTER_API_KEY`. Optional: `SWITCHBACK_CLASSIFIER_MODEL`
 * to override the default classifier model (`openai/gpt-5.4-mini`).
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { createOpenRouterClassifier, createCascade } from "vibekit-switchback";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const CLASSIFIER_MODEL = process.env.SWITCHBACK_CLASSIFIER_MODEL || "openai/gpt-5.4-mini";

if (!OPENROUTER_API_KEY) {
  console.error("Error: OPENROUTER_API_KEY environment variable is required");
  console.error("Get a key at https://openrouter.ai/keys");
  process.exit(1);
}

const classifier = createOpenRouterClassifier({
  apiKey: OPENROUTER_API_KEY,
  model: CLASSIFIER_MODEL,
});

const TOOLS: Tool[] = [
  {
    name: "classify_turn",
    description:
      "Classify how complex a user request is on a 0/1/2 scale. Use this when you're orchestrating an agent and want to decide whether to spend on a flagship model (tier 2), a mid-tier model (tier 1), or stay cheap (tier 0). Returns {tier, why, fallback, durationMs}.",
    inputSchema: {
      type: "object",
      properties: {
        userMessage: {
          type: "string",
          description: "The user's request to classify. Capped at 1500 chars internally.",
        },
        recentHistory: {
          type: "array",
          items: { type: "string" },
          description: "Optional. Last 1-2 assistant turns for context. Each capped at 200 chars internally.",
        },
      },
      required: ["userMessage"],
    },
  },
  {
    name: "recommend_model",
    description:
      "Given a ladder of models (cheap → flagship) and a user message, return the cheapest model on the ladder that can plausibly handle it, plus reasoning. The ladder should be brand-locked (all-Anthropic, all-OpenAI, etc.) to honor your user's BYOK provider.",
    inputSchema: {
      type: "object",
      properties: {
        userMessage: {
          type: "string",
          description: "The user's request.",
        },
        ladder: {
          type: "array",
          items: { type: "string" },
          description: "Ordered model ids, index 0 = cheapest. Example: ['openai/gpt-5.4-mini', 'openai/gpt-5.4', 'openai/gpt-5.5']",
          minItems: 1,
        },
        recentHistory: {
          type: "array",
          items: { type: "string" },
          description: "Optional context. Last 1-2 assistant turns.",
        },
      },
      required: ["userMessage", "ladder"],
    },
  },
];

const server = new Server(
  { name: "vibekit-switchback-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "classify_turn") {
    const userMessage = String((args as { userMessage?: string })?.userMessage ?? "");
    const recentHistory = ((args as { recentHistory?: string[] })?.recentHistory ?? []).map(String);

    if (!userMessage) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: "userMessage is required" }) }],
        isError: true,
      };
    }

    const result = await classifier(userMessage, recentHistory);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }

  if (name === "recommend_model") {
    const userMessage = String((args as { userMessage?: string })?.userMessage ?? "");
    const ladder = ((args as { ladder?: string[] })?.ladder ?? []).map(String);
    const recentHistory = ((args as { recentHistory?: string[] })?.recentHistory ?? []).map(String);

    if (!userMessage || ladder.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: "userMessage and non-empty ladder are required" }),
          },
        ],
        isError: true,
      };
    }

    const cascade = createCascade({ ladder, classify: classifier });
    const state = await cascade.init({ userMessage, recentHistory });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              recommended_model: state.initialModel,
              tier: state.initialTier,
              ladder_size: ladder.length,
              classifier: state.classifier,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  return {
    content: [{ type: "text", text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
    isError: true,
  };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[switchback-mcp] ready on stdio");
}

main().catch((err) => {
  console.error("[switchback-mcp] fatal:", err);
  process.exit(1);
});
