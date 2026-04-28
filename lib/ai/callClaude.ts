import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    });
  }
  return _client;
}

const NO_TEXT_FALLBACK =
  "I apologize, I was unable to generate a response. Please try again.";

const ERROR_FALLBACK =
  "I'm having trouble connecting right now. A human agent will be with you shortly, or please try sending your message again.";

const MAX_ATTEMPTS = 2;
const RETRY_BASE_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function callClaude(
  system: string,
  messages: { role: "user" | "assistant"; content: string }[]
): Promise<string> {
  const client = getClient();

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await client.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 1024,
        system,
        messages,
      });

      const textBlock = response.content.find((block) => block.type === "text");
      return textBlock?.text || NO_TEXT_FALLBACK;
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
  return ERROR_FALLBACK;
}
