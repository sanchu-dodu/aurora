import { NextRequest, NextResponse } from "next/server";
import { chat } from "@/app/lib/ai/router";
import { SYSTEM_PROMPTS } from "@/app/lib/prompts";
import {
  clientKey,
  rateLimit,
} from "@/app/lib/rateLimit";
import type { ChatMessage } from "@/app/lib/ai/types";

/*
 * AEGIS-002: this route proxies to an inference backend. Every value below is
 * attacker-controlled, so the request is constrained before it is forwarded.
 */

const MAX_MESSAGES = 30;

const MAX_MESSAGE_CHARS = 8_000;

const MAX_TOTAL_CHARS = 24_000;

const ALLOWED_ROLES = new Set([
  "system",
  "user",
  "assistant",
]);

/*
 * AEGIS-002: the model is pinned server-side. Previously `body.model` was
 * forwarded verbatim, letting a caller select or probe any model on the
 * host. Override deliberately via configuration, never via the request.
 */
const ALLOWED_MODELS = new Set(
  (
    process.env.AURORA_AI_ALLOWED_MODELS ??
    "qwen2.5-coder:3b"
  )
    .split(",")
    .map(entry => entry.trim())
    .filter(Boolean)
);

const DEFAULT_MODEL =
  process.env.AURORA_AI_DEFAULT_MODEL ??
  "qwen2.5-coder:3b";

const RATE_LIMIT_REQUESTS = 10;

const RATE_LIMIT_WINDOW_MS = 60_000;

interface ValidatedChatRequest {
  readonly messages: ChatMessage[];
  readonly model: string;
}

function validate(
  body: unknown
): ValidatedChatRequest | string {
  if (
    typeof body !== "object" ||
    body === null
  ) {
    return "Request body must be a JSON object.";
  }

  const { messages, model } = body as {
    messages?: unknown;
    model?: unknown;
  };

  if (!Array.isArray(messages)) {
    return "A 'messages' array is required.";
  }

  if (
    messages.length === 0 ||
    messages.length > MAX_MESSAGES
  ) {
    return `'messages' must contain between 1 and ${MAX_MESSAGES} entries.`;
  }

  let totalChars = 0;

  const validated: ChatMessage[] = [];

  for (const entry of messages) {
    if (
      typeof entry !== "object" ||
      entry === null
    ) {
      return "Each message must be an object.";
    }

    const { role, content } = entry as {
      role?: unknown;
      content?: unknown;
    };

    if (
      typeof role !== "string" ||
      !ALLOWED_ROLES.has(role)
    ) {
      return "Each message needs a role of 'system', 'user', or 'assistant'.";
    }

    if (typeof content !== "string") {
      return "Each message needs string content.";
    }

    if (content.length > MAX_MESSAGE_CHARS) {
      return "A message exceeds the maximum allowed length.";
    }

    totalChars += content.length;

    if (totalChars > MAX_TOTAL_CHARS) {
      return "The conversation exceeds the maximum allowed length.";
    }

    validated.push({
      role: role as ChatMessage["role"],
      content,
    });
  }

  if (
    model !== undefined &&
    (typeof model !== "string" ||
      !ALLOWED_MODELS.has(model))
  ) {
    return "The requested model is not available.";
  }

  return {
    messages: validated,
    model:
      typeof model === "string"
        ? model
        : DEFAULT_MODEL,
  };
}

export async function POST(request: NextRequest) {
  /*
   * AEGIS-003: throttle before any upstream work is performed.
   */
  const limit = rateLimit(
    `ai-chat:${clientKey(request)}`,
    RATE_LIMIT_REQUESTS,
    RATE_LIMIT_WINDOW_MS
  );

  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      {
        status: 429,
        headers: {
          "Retry-After": String(
            limit.retryAfterSeconds
          ),
        },
      }
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  const validated = validate(body);

  if (typeof validated === "string") {
    return NextResponse.json(
      { error: validated },
      { status: 400 }
    );
  }

  try {
    /*
     * AEGIS-002: ground the conversation with the Aurora system prompt.
     * Caller-supplied 'system' turns are kept after this one so they cannot
     * displace it.
     */
    const response = await chat("ollama", {
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPTS.assistant,
        },
        ...validated.messages,
      ],
      model: validated.model,
    });

    return NextResponse.json(response);
  } catch (error) {
    /*
     * AEGIS-002: log server-side, but never return upstream error detail to
     * the caller (it can disclose internal hosts, ports, and model names).
     */
    console.error(
      "[aurora] AI chat request failed:",
      error instanceof Error
        ? error.message
        : "unknown error"
    );

    return NextResponse.json(
      {
        error: "Failed to communicate with Aurora AI",
      },
      {
        status: 502,
      }
    );
  }
}
