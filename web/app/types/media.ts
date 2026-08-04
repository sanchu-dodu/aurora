export type TmdbGenre = {
  id: number;
  name: string;
};

export type TmdbVideo = {
  key: string;
  site: string;
  type: string;
};

export type TmdbMovie = {
  id: number;
  title: string;
  poster_path: string | null;
  vote_average: number;
  release_date: string;
  backdrop_path?: string | null;
  overview: string;
  runtime?: number;
  genres?: TmdbGenre[];
};

export type ContinueWatchingMovie = {
  id: number;
  title: string;
  poster: string;
  progress: number;
  duration: number;
};