export interface Playback {
  movieId: number;

  profileId: number;

  currentTime: number;

  duration: number;

  percentage: number;

  completed: boolean;

  lastWatched: number;

  updatedAt: string;
}