import { Profile } from "../components/ProfileProvider";

export interface ContinueWatchingItem {
  id: number;
  title: string;
  poster: string;
  progress: number;
  duration: number;
}

export class ProfileRepository {
  private static progressKey(profile: Profile | null) {
    return profile
      ? `aurora-profile-${profile.id}-continue`
      : "aurora-profile-guest-continue";
  }

  static getContinueWatching(
    profile: Profile | null
  ): ContinueWatchingItem[] {
    if (typeof window === "undefined") {
      return [];
    }

    return JSON.parse(
      localStorage.getItem(
        this.progressKey(profile)
      ) || "[]"
    );
  }

  static saveContinueWatching(
    profile: Profile | null,
    movies: ContinueWatchingItem[]
  ) {
    if (typeof window === "undefined") {
      return;
    }

    localStorage.setItem(
      this.progressKey(profile),
      JSON.stringify(movies)
    );
  }
}