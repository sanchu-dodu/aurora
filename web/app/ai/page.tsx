"use client";

import { useState } from "react";
import AIRecommendationCard from "../components/AIRecommendationCard";

type Movie = {
  id: number;
  title: string;
  poster_path: string | null;
  vote_average: number;
  release_date?: string;
};

export default function AIPage() {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [movies, setMovies] = useState<Movie[]>([]);

  async function askAurora() {
    if (!prompt.trim()) return;

    setLoading(true);

    try {
      // Call Aurora AI
      const aiRes = await fetch("/api/ai", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ prompt }),
});

console.log(await aiRes.text());
return;

      const aiData = await aiRes.json();

      let titles: string[] = [];

      if (aiData.recommendations) {
        titles = aiData.recommendations
          .split("\n")
          .map((title: string) => title.trim())
          .filter(Boolean);
      }

      // If AI isn't available, use demo movies
      if (titles.length === 0) {
        titles = [
          "Interstellar",
          "The Batman",
          "Dune",
          "Inception",
          "Blade Runner 2049",
        ];
      }

      // Fetch TMDB details
      const movieRes = await fetch("/api/ai/movies", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          titles,
        }),
      });

      const movieData = await movieRes.json();

      setMovies(movieData);
    } catch (error) {
      console.error(error);

      // Fallback demo recommendations if anything fails
      try {
        const movieRes = await fetch("/api/ai/movies", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            titles: [
              "Interstellar",
              "The Batman",
              "Dune",
              "Inception",
              "Blade Runner 2049",
            ],
          }),
        });

        const movieData = await movieRes.json();

        setMovies(movieData);
      } catch (err) {
        console.error(err);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#070B14] px-10 py-16 text-white">
      <h1 className="mb-4 text-5xl font-black">
        🤖 Aurora AI
      </h1>

      <p className="mb-10 text-gray-400">
        Describe what you&apos;d like to watch and Aurora will recommend movies.
      </p>

      <div className="mb-10 flex gap-4">
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              askAurora();
            }
          }}
          placeholder="Example: Dark detective movies with plot twists..."
          className="flex-1 rounded-xl bg-white/10 px-6 py-4 outline-none"
        />

        <button
          onClick={askAurora}
          disabled={loading}
          className="rounded-xl bg-blue-600 px-8 hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Aurora is thinking..." : "Ask Aurora"}
        </button>
      </div>

      {loading && (
        <div className="rounded-2xl bg-white/5 p-8">
          <p className="animate-pulse text-blue-400">
            Finding the perfect movies...
          </p>
        </div>
      )}

      {!loading && movies.length > 0 && (
        <>
          <h2 className="mb-8 text-3xl font-bold">
            Recommended For You
          </h2>

          <div className="grid grid-cols-2 gap-8 md:grid-cols-3 lg:grid-cols-5">
            {movies.map((movie) => (
              <AIRecommendationCard
                key={movie.id}
                movie={movie}
              />
            ))}
          </div>
        </>
      )}
    </main>
  );
}