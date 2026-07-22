import { chatWithOllama } from "./ollama";
import { AIProvider, ChatRequest, ChatResponse } from "./types";

export async function chat(
  provider: AIProvider,
  request: ChatRequest
): Promise<ChatResponse> {
  switch (provider) {
    case "ollama":
      return chatWithOllama(request);

    case "openai":
      throw new Error("OpenAI provider not implemented yet");

    case "gemini":
      throw new Error("Gemini provider not implemented yet");

    default:
      throw new Error("Unsupported AI provider");
  }
}