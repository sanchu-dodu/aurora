import { NextRequest, NextResponse } from "next/server";
import { chat } from "@/app/lib/ai/router";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const response = await chat("ollama", {
      messages: body.messages,
      model: body.model,
    });

    return NextResponse.json(response);
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        error: "Failed to communicate with Aurora AI",
      },
      {
        status: 500,
      }
    );
  }
}