import { Profile } from "../components/ProfileProvider";
import {
  ContinueWatchingItem,
  ProfileRepository,
} from "../repositories/profileRepository";

export class ProfileService {
  static getContinueWatching(
    profile: Profile | null
  ) {
    return ProfileRepository.getContinueWatching(profile);
  }

  static saveContinueWatching(
    profile: Profile | null,
    movies: ContinueWatchingItem[]
  ) {
    ProfileRepository.saveContinueWatching(
      profile,
      movies
    );
  }

  static updateMovieProgress(
    profile: Profile | null,
    movie: ContinueWatchingItem
  ) {
    const movies =
      this.getContinueWatching(profile);

    const index = movies.findIndex(
      (m) => m.id === movie.id
    );

    if (index >= 0) {
      movies[index] = movie;
    } else {
      movies.unshift(movie);
    }

    this.saveContinueWatching(
      profile,
      movies.slice(0, 20)
    );
  }
}