import { ChatRequest, ChatResponse } from "./types";

/*
 * AEGIS-002: the upstream endpoint is configuration, not a hardcoded
 * localhost literal, so deployments can point at a properly isolated
 * inference host instead of silently failing (or reaching an unintended
 * service) in environments where nothing listens on 11434.
 */
const OLLAMA_URL =
  process.env.OLLAMA_URL ??
  "http://localhost:11434/api/chat";

/*
 * AEGIS-002: bound the upstream call so a hung backend cannot pin a server
 * request handler open indefinitely.
 */
const REQUEST_TIMEOUT_MS = Number(
  process.env.OLLAMA_TIMEOUT_MS ?? 30_000
);

export async function chatWithOllama(
  request: ChatRequest
): Promise<ChatResponse> {
  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS
  );

  let response: Response;

  try {
    response = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: request.model ?? "qwen2.5-coder:3b",
        messages: request.messages,
        stream: false,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error("Failed to communicate with Ollama");
  }

  const data = await response.json();

  /*
   * AEGIS-002: the upstream response is untrusted input. Previously
   * `data.message.content` was read directly, which threw a TypeError on any
   * unexpected shape and surfaced as an opaque 500.
   */
  const content =
    typeof data === "object" &&
    data !== null &&
    typeof data.message === "object" &&
    data.message !== null
      ? (data.message as { content?: unknown }).content
      : undefined;

  if (typeof content !== "string") {
    throw new Error(
      "Received an unexpected response from Ollama."
    );
  }

  return {
    message: content,
  };
}
