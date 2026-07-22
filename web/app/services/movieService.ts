import * as tmdb from "../lib/tmdb";

export class MovieService {
  static async getTrending() {
    return tmdb.getTrendingMovies();
  }

  static async getPopular() {
    return tmdb.getPopularMovies();
  }

  static async getTopRated() {
    return tmdb.getTopRatedMovies();
  }

  static async getUpcoming() {
    return tmdb.getUpcomingMovies();
  }

  static async getNowPlaying() {
    return tmdb.getNowPlayingMovies();
  }

  static async getFeatured() {
    return tmdb.getFeaturedMovie();
  }
}