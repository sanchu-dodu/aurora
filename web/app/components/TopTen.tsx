import MovieImage from "./MovieImage";
import Link from "next/link";
import { getTrendingMovies } from "../lib/tmdb";

export default async function TopTen() {
  const movies: Movie[] = await getTrendingMovies();

  type Movie = {
  id: number;
  title: string;
  poster_path: string | null;
};
  return (
    <section className="my-12 px-6">
      <h2 className="mb-8 text-4xl font-black">
        🔥 Top 10 Today
      </h2>

      <div className="flex gap-6 overflow-x-auto pb-4">
        {movies.slice(0, 10).map((movie, index) => (
          <Link
            key={movie.id}
            href={`/movies/${movie.id}`}
            className="group relative min-w-[220px]"
          >
            <div className="relative">
              <span
                className="
                  absolute
                  -left-5
                  bottom-0
                  text-[120px]
                  font-black
                  text-white/20
                  transition
                  group-hover:text-blue-500/40
                "
              >
                {index + 1}
              </span>

              <MovieImage
                src={
                  movie.poster_path
                    ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
                    : "/placeholder.svg"
                }
                alt={movie.title}
                className="
                  relative
                  z-10
                  h-[320px]
                  w-[220px]
                  rounded-2xl
                  object-cover
                  transition
                  duration-300
                  group-hover:scale-105
                "
              />
            </div>

            <h3 className="mt-4 text-center font-bold">
              {movie.title}
            </h3>
          </Link>
        ))}
      </div>
    </section>
  );
}