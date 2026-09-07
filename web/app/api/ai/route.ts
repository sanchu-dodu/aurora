import { NextResponse } from "next/server";
import {
  clientKey,
  rateLimit,
} from "@/app/lib/rateLimit";

/*
 * AEGIS-005: bound the accepted prompt length. This endpoint returns a static
 * list, but an unbounded string still forces needless parsing work.
 */
const MAX_PROMPT_LENGTH = 2_000;

export async function POST(request: Request) {
  /*
   * AEGIS-003: throttle anonymous callers.
   */
  const limit = rateLimit(
    `ai:${clientKey(request)}`,
    30,
    60_000
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

  /*
   * AEGIS-005: the request body is attacker-controlled. Parsing it outside a
   * try/catch turned malformed JSON into an unhandled 500, and calling
   * .toLowerCase() on a non-string body value threw a TypeError.
   */
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  const prompt =
    typeof body === "object" &&
    body !== null &&
    "prompt" in body
      ? (body as { prompt: unknown }).prompt
      : undefined;

  if (typeof prompt !== "string") {
    return NextResponse.json(
      { error: "A 'prompt' string is required." },
      { status: 400 }
    );
  }

  if (prompt.length > MAX_PROMPT_LENGTH) {
    return NextResponse.json(
      { error: "Prompt is too long." },
      { status: 413 }
    );
  }

  const text = prompt.toLowerCase();

  let recommendations: string[] = [];

  if (text.includes("batman")) {
    recommendations = [
      "The Batman",
      "Batman Begins",
      "The Dark Knight",
      "Batman Returns",
      "Batman v Superman: Dawn of Justice",
    ];
  } else if (
    text.includes("space") ||
    text.includes("sci") ||
    text.includes("future")
  ) {
    recommendations = [
      "Interstellar",
      "Dune",
      "Arrival",
      "Blade Runner 2049",
      "The Martian",
    ];
  } else if (
    text.includes("horror") ||
    text.includes("scary")
  ) {
    recommendations = [
      "The Conjuring",
      "Smile",
      "Hereditary",
      "It",
      "Insidious",
    ];
  } else if (
    text.includes("action")
  ) {
    recommendations = [
      "John Wick",
      "Mad Max: Fury Road",
      "Nobody",
      "Extraction",
      "Mission: Impossible - Fallout",
    ];
  } else if (
    text.includes("comedy")
  ) {
    recommendations = [
      "Free Guy",
      "The Hangover",
      "21 Jump Street",
      "We're the Millers",
      "Game Night",
    ];
  } else {
    recommendations = [
      "Inception",
      "Interstellar",
      "The Dark Knight",
      "Dune",
      "Oppenheimer",
    ];
  }

  return NextResponse.json({
    recommendations: recommendations.join("\n"),
  });
}
