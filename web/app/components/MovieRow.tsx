import MovieCard from "./MovieCard";
import MovieCardSkeleton from "./MovieCardSkeleton";

import {
  getTrendingMovies,
  getPopularMovies,
  getTopRatedMovies,
  getUpcomingMovies,
  getNowPlayingMovies,
} from "../lib/tmdb";

type MovieRowProps = {
  title: string;
  type:
    | "trending"
    | "popular"
    | "topRated"
    | "upcoming"
    | "nowPlaying";
};

export default async function MovieRow({
  title,
  type,
}: MovieRowProps) {
  let movies: any[] = [];

  switch (type) {
    case "trending":
      movies = await getTrendingMovies();
      break;

    case "popular":
      movies = await getPopularMovies();
      break;

    case "topRated":
      movies = await getTopRatedMovies();
      break;

    case "upcoming":
      movies = await getUpcomingMovies();
      break;

    case "nowPlaying":
      movies = await getNowPlayingMovies();
      break;
  }

  return (
    <section className="my-10 px-6">

      <h2 className="mb-6 text-3xl font-bold">
        {title}
      </h2>

      <div className="flex gap-5 overflow-x-auto pb-4">

        {movies.length === 0
          ? Array.from({ length: 8 }).map((_, index) => (
              <MovieCardSkeleton key={index} />
            ))
          : movies.map((movie) => (
              <MovieCard key={movie.id} movie={movie} />
            ))}

      </div>

    </section>
  );
}