import { getFeaturedMovies } from "../lib/tmdb";
import HeroCarousel from "./HeroCarousel";

export default async function Hero() {
  const movies = await getFeaturedMovies();

  return (
    <section className="relative h-[85vh] overflow-hidden">
      <HeroCarousel movies={movies} />
    </section>
  );
}