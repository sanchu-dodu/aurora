import { Profile } from "../components/ProfileProvider";

export type ContinueMovie = {
  id: number;
  title: string;
  poster: string;
  progress: number;
  duration: number;
};

function key(profile: Profile | null) {
  if (!profile) return "aurora-progress-guest";

  return `aurora-progress-${profile.id}`;
}

export function getContinueWatching(
  profile: Profile | null
): ContinueMovie[] {
  if (typeof window === "undefined") return [];

  return JSON.parse(
    localStorage.getItem(key(profile)) || "[]"
  );
}

export function saveContinueWatching(
  profile: Profile | null,
  movies: ContinueMovie[]
) {
  if (typeof window === "undefined") return;

  localStorage.setItem(
    key(profile),
    JSON.stringify(movies)
  );
}

export function updateMovieProgress(
  profile: Profile | null,
  movie: ContinueMovie
) {
  const current = getContinueWatching(profile);

  const index = current.findIndex(
    (m) => m.id === movie.id
  );

  if (index >= 0) {
    current[index] = movie;
  } else {
    current.unshift(movie);
  }

  saveContinueWatching(profile, current.slice(0, 20));
}