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

export async function callClaude(
  system: string,
  messages: { role: "user" | "assistant"; content: string }[]
): Promise<string> {
  const client = getClient();

  const response = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 1024,
    system,
    messages,
  });

  const textBlock = response.content.find((block) => block.type === "text");
  return textBlock?.text || "I apologize, I was unable to generate a response. Please try again.";
}
