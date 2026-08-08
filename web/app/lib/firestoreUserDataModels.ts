import type {
  ContinueWatchingMovie,
  TmdbGenre,
  TmdbMovie,
} from "../types/media";

export type FirestoreProfile = {
  id: number;
  name: string;
  color: string;
};

export type FirestoreProfilesData = {
  profile: FirestoreProfile | null;
  profiles: FirestoreProfile[];
};

type UnknownRecord = Record<string, unknown>;

function isRecord(
  value: unknown
): value is UnknownRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function hasOwn(
  value: UnknownRecord,
  key: string
): boolean {
  return Object.prototype.hasOwnProperty.call(
    value,
    key
  );
}

function isFiniteNumber(
  value: unknown
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value)
  );
}

function isInteger(
  value: unknown
): value is number {
  return (
    isFiniteNumber(value) &&
    Number.isInteger(value)
  );
}

function decodeArray<T>(
  value: unknown,
  decoder: (item: unknown) => T | null
): T[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const decodedItems: T[] = [];

  for (const item of value) {
    const decodedItem = decoder(item);

    if (decodedItem === null) {
      return null;
    }

    decodedItems.push(decodedItem);
  }

  return decodedItems;
}

function decodeTmdbGenre(
  value: unknown
): TmdbGenre | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    !isInteger(value.id) ||
    typeof value.name !== "string"
  ) {
    return null;
  }

  return {
    id: value.id,
    name: value.name,
  };
}

function decodeTmdbMovie(
  value: unknown
): TmdbMovie | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    !isInteger(value.id) ||
    typeof value.title !== "string" ||
    !(
      typeof value.poster_path === "string" ||
      value.poster_path === null
    ) ||
    !isFiniteNumber(value.vote_average) ||
    typeof value.release_date !== "string" ||
    typeof value.overview !== "string"
  ) {
    return null;
  }

  if (
    hasOwn(value, "backdrop_path") &&
    !(
      typeof value.backdrop_path === "string" ||
      value.backdrop_path === null
    )
  ) {
    return null;
  }

  if (
    hasOwn(value, "runtime") &&
    !isFiniteNumber(value.runtime)
  ) {
    return null;
  }

  let genres: TmdbGenre[] | undefined;

  if (hasOwn(value, "genres")) {
    const decodedGenres = decodeArray(
      value.genres,
      decodeTmdbGenre
    );

    if (decodedGenres === null) {
      return null;
    }

    genres = decodedGenres;
  }

  return {
    id: value.id,
    title: value.title,
    poster_path: value.poster_path,
    vote_average: value.vote_average,
    release_date: value.release_date,
    overview: value.overview,
    ...(hasOwn(value, "backdrop_path")
      ? {
          backdrop_path:
            value.backdrop_path as string | null,
        }
      : {}),
    ...(hasOwn(value, "runtime")
      ? {
          runtime: value.runtime as number,
        }
      : {}),
    ...(genres
      ? {
          genres,
        }
      : {}),
  };
}

function decodeContinueWatchingMovie(
  value: unknown
): ContinueWatchingMovie | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    !isInteger(value.id) ||
    typeof value.title !== "string" ||
    typeof value.poster !== "string" ||
    !isFiniteNumber(value.progress) ||
    !isFiniteNumber(value.duration) ||
    value.progress < 0 ||
    value.duration < 0
  ) {
    return null;
  }

  return {
    id: value.id,
    title: value.title,
    poster: value.poster,
    progress: value.progress,
    duration: value.duration,
  };
}

function decodeProfile(
  value: unknown
): FirestoreProfile | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    !isInteger(value.id) ||
    value.id < 0 ||
    typeof value.name !== "string" ||
    value.name.trim().length === 0 ||
    typeof value.color !== "string" ||
    value.color.trim().length === 0
  ) {
    return null;
  }

  return {
    id: value.id,
    name: value.name,
    color: value.color,
  };
}

export function decodeMyListData(
  value: unknown
): TmdbMovie[] | null {
  return decodeArray(
    value,
    decodeTmdbMovie
  );
}

export function decodeContinueWatchingData(
  value: unknown
): ContinueWatchingMovie[] | null {
  return decodeArray(
    value,
    decodeContinueWatchingMovie
  );
}

export function decodeProfilesData(
  value: unknown
): FirestoreProfilesData | null {
  if (!isRecord(value)) {
    return null;
  }

  const profiles = decodeArray(
    value.profiles,
    decodeProfile
  );

  if (profiles === null) {
    return null;
  }

  const profileIds = new Set(
    profiles.map((profile) => profile.id)
  );

  if (profileIds.size !== profiles.length) {
    return null;
  }

  let profile: FirestoreProfile | null = null;

  if (value.profile !== null) {
    profile = decodeProfile(value.profile);

    if (profile === null) {
      return null;
    }

    const matchingProfile = profiles.find(
      (candidate) =>
        candidate.id === profile?.id
    );

    if (
      !matchingProfile ||
      matchingProfile.name !== profile.name ||
      matchingProfile.color !== profile.color
    ) {
      return null;
    }
  }

  return {
    profile,
    profiles,
  };
}