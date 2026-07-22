import { ChatRequest, ChatResponse } from "./types";

const OLLAMA_URL = "http://localhost:11434/api/chat";

export async function chatWithOllama(
  request: ChatRequest
): Promise<ChatResponse> {
  const response = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: request.model ?? "qwen2.5-coder:3b",
      messages: request.messages,
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to communicate with Ollama");
  }

  const data = await response.json();

  return {
    message: data.message.content,
  };
}