import Anthropic from "@anthropic-ai/sdk";
import type { ToolHandler, ToolCtx } from "./tools";
import { log } from "@/lib/log";

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    });
  }
  return _client;
}

const MODEL = "claude-haiku-4-5";
const MAX_TOKENS = 2048;

const NO_TEXT_FALLBACK =
  "I've flagged this for our team — a teammate will follow up here shortly. In the meantime, you can browse our full catalog at https://performancecycle.com/ or ask me anything else about gear, parts, or services.";

const ERROR_FALLBACK =
  "I'm having trouble connecting right now. A human agent will be with you shortly, or please try sending your message again.";

const MAX_ATTEMPTS = 2;
const RETRY_BASE_DELAY_MS = 500;
const MAX_TOOL_ITERATIONS = 4;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ToolCallEvent {
  name: string;
  input: unknown;
  output: unknown;
  durationMs: number;
  isError: boolean;
}

export interface CallClaudeOptions {
  /** Anthropic-format tools. When omitted, the simple non-tool path is used. */
  tools?: Anthropic.Tool[];
  /** Handler map keyed by tool name. Required when `tools` is set. */
  toolHandlers?: Record<string, ToolHandler>;
  /** Per-request context handed to handlers (sessionId, requestId). */
  ctx?: ToolCtx;
  /** Fired after each handler runs so callers can persist chat_events rows. */
  onToolCall?: (e: ToolCallEvent) => void;
  /**
   * Streaming hooks. When set, the loop uses messages.stream() and forwards
   * text deltas + tool_use starts. The final concatenated text is still
   * returned from the function for persistence.
   */
  stream?: {
    onToken: (text: string) => void;
    onToolUse: (e: { name: string; input: unknown }) => void;
  };
}

type Msg = { role: "user" | "assistant"; content: string };

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/**
 * Original signature: simple text in / text out, no tools, no streaming.
 * Kept stable so the order-lookup, ai-fallback (non-tool mode), and any
 * callers from before Phase 3 work unchanged.
 *
 * Also accepts an `options` argument; when `options.tools` is present the
 * function switches to the tool-loop path. When `options.stream` is present,
 * tokens are forwarded as they arrive.
 */
export async function callClaude(
  system: string,
  messages: Msg[],
  options?: CallClaudeOptions
): Promise<string> {
  if (options?.tools && options.tools.length > 0) {
    return callClaudeWithTools(system, messages, options);
  }
  if (options?.stream) {
    return callClaudeStreaming(system, messages, options);
  }
  return callClaudeSimple(system, messages);
}

export const CALL_CLAUDE_ERROR_MESSAGE = ERROR_FALLBACK;

// ---------------------------------------------------------------------------
// Simple (non-tool) path — preserves existing 2-attempt retry behavior
// ---------------------------------------------------------------------------

async function callClaudeSimple(system: string, messages: Msg[]): Promise<string> {
  const client = getClient();

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system,
        messages,
      });
      const textBlock = response.content.find((b) => b.type === "text");
      return textBlock && textBlock.type === "text"
        ? textBlock.text || NO_TEXT_FALLBACK
        : NO_TEXT_FALLBACK;
    } catch (error) {
      lastError = error;
      console.error(
        `callClaude attempt ${attempt}/${MAX_ATTEMPTS} failed:`,
        error
      );
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_BASE_DELAY_MS * attempt);
      }
    }
  }

  console.error("callClaude exhausted all retries:", lastError);
  const err = new Error("callClaude exhausted retries") as Error & {
    isCallClaudeFailure: true;
  };
  err.isCallClaudeFailure = true;
  throw err;
}

// ---------------------------------------------------------------------------
// Streaming (no-tool) path — used when caller wants tokens but no tools
// ---------------------------------------------------------------------------

async function callClaudeStreaming(
  system: string,
  messages: Msg[],
  options: CallClaudeOptions
): Promise<string> {
  const client = getClient();
  const onToken = options.stream!.onToken;

  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages,
    });
    stream.on("text", (delta: string) => {
      if (delta) onToken(delta);
    });
    const final = await stream.finalMessage();
    const text = final.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return text || NO_TEXT_FALLBACK;
  } catch (error) {
    console.error("callClaude streaming failed:", error);
    const err = new Error("callClaude exhausted retries") as Error & {
      isCallClaudeFailure: true;
    };
    err.isCallClaudeFailure = true;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Tool loop
// ---------------------------------------------------------------------------

type ContentBlock =
  | Anthropic.TextBlock
  | Anthropic.ToolUseBlock
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

type AssistantMsg = { role: "assistant"; content: Anthropic.ContentBlock[] };
type ToolResultMsg = {
  role: "user";
  content: Array<{
    type: "tool_result";
    tool_use_id: string;
    content: string;
    is_error?: boolean;
  }>;
};
type AnyMsg = Msg | AssistantMsg | ToolResultMsg;

async function callClaudeWithTools(
  system: string,
  initialMessages: Msg[],
  options: CallClaudeOptions
): Promise<string> {
  const client = getClient();
  const handlers = options.toolHandlers || {};
  const ctx: ToolCtx = options.ctx || { sessionId: "" };
  const stream = options.stream;

  const history: AnyMsg[] = [...initialMessages];
  let collectedText = "";
  // Tracks whether any text has actually been pushed to the SSE client. If a
  // return point is reached without having emitted, we emit the exact return
  // value so streamed output always equals the persisted output.
  let tokensEmittedToClient = false;

  const finalize = (value: string): string => {
    if (value === NO_TEXT_FALLBACK) {
      log.warn("ai.empty_final_text", {
        sessionId: ctx.sessionId || undefined,
        requestId: ctx.requestId,
      });
    }
    if (stream && !tokensEmittedToClient) {
      stream.onToken(value);
      tokensEmittedToClient = true;
    }
    return value;
  };

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    let assistantBlocks: Anthropic.ContentBlock[];
    let stopReason: string | null;

    try {
      if (stream) {
        const s = client.messages.stream({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system,
          tools: options.tools,
          messages: history as unknown as Anthropic.MessageParam[],
        });
        // Buffer deltas for this iteration; only flush to the client when the
        // iteration ends without a tool call. Pre-tool-use deltas are internal
        // narration ("I'll search for X") and must not reach the customer.
        const pendingDeltas: string[] = [];
        s.on("text", (delta: string) => {
          if (delta) pendingDeltas.push(delta);
        });
        s.on("contentBlock", (block: Anthropic.ContentBlock) => {
          if (block.type === "tool_use") {
            stream.onToolUse({ name: block.name, input: block.input });
          }
        });
        const final = await s.finalMessage();
        assistantBlocks = final.content;
        stopReason = final.stop_reason;
        // Pre-tool-use text is internal narration; only flush to the client when
        // this iteration is the final turn (not a mid-loop tool call).
        if (stopReason !== "tool_use" && pendingDeltas.length > 0) {
          stream.onToken(pendingDeltas.join(""));
          tokensEmittedToClient = true;
        }
      } else {
        const response = await client.messages.create({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system,
          tools: options.tools,
          messages: history as unknown as Anthropic.MessageParam[],
        });
        assistantBlocks = response.content;
        stopReason = response.stop_reason;
      }
    } catch (error) {
      console.error(`callClaude tool iteration ${iter + 1} failed:`, error);
      const err = new Error("callClaude exhausted retries") as Error & {
        isCallClaudeFailure: true;
      };
      err.isCallClaudeFailure = true;
      throw err;
    }

    const textChunk = assistantBlocks
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    // Pre-tool-use text is internal narration ("I'll search for X").
    // The customer-facing reply is the FINAL iteration's text only.
    // Concatenating pre-tool narration with the final answer caused the "I'll search.Got it" jam bug.
    if (textChunk && stopReason !== "tool_use") collectedText += textChunk;

    history.push({ role: "assistant", content: assistantBlocks });

    if (stopReason !== "tool_use") {
      return finalize(collectedText || NO_TEXT_FALLBACK);
    }

    const toolUses = assistantBlocks.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    if (toolUses.length === 0) {
      return finalize(collectedText || NO_TEXT_FALLBACK);
    }

    const toolResults: ToolResultMsg["content"] = [];
    for (const use of toolUses) {
      const handler = handlers[use.name];
      const startedAt = Date.now();
      let output: unknown;
      let isError = false;
      if (!handler) {
        output = { error: `unknown tool: ${use.name}` };
        isError = true;
      } else {
        try {
          output = await handler(use.input as Record<string, unknown>, ctx);
        } catch (err) {
          output = {
            error: err instanceof Error ? err.message : "tool handler error",
          };
          isError = true;
        }
      }
      const durationMs = Date.now() - startedAt;
      options.onToolCall?.({
        name: use.name,
        input: use.input,
        output,
        durationMs,
        isError,
      });
      toolResults.push({
        type: "tool_result",
        tool_use_id: use.id,
        content: typeof output === "string" ? output : JSON.stringify(output),
        ...(isError ? { is_error: true } : {}),
      });
    }
    history.push({ role: "user", content: toolResults });
  }

  // Iteration cap reached — force a non-tool final answer.
  try {
    const finalResp = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages: history as unknown as Anthropic.MessageParam[],
      tools: options.tools,
      tool_choice: { type: "none" },
    });
    const finalText = finalResp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (stream && finalText) {
      stream.onToken(finalText);
      tokensEmittedToClient = true;
    }
    return finalize(finalText || collectedText || NO_TEXT_FALLBACK);
  } catch (error) {
    console.error("callClaude final tool-cap call failed:", error);
    return finalize(collectedText || NO_TEXT_FALLBACK);
  }
}

// Re-exported for convenience by callers.
export type { ToolHandler, ToolCtx } from "./tools";
// Helper for typed content blocks when callers need them.
export type CallClaudeContentBlock = ContentBlock;
