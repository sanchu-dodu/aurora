import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const { prompt } = await request.json();

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