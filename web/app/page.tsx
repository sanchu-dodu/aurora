import Navbar from "./components/Navbar";
import Hero from "./components/Hero";
import FeaturedBanner from "./components/FeaturedBanner";
import MovieRow from "./components/MovieRow";
import Footer from "./components/Footer";
import ContinueWatching from "./components/ContinueWatching";
import TopTen from "./components/TopTen";
import AIAssistant from "./components/AIAssistant";

export default function Home() {
  return (
    <main className="min-h-screen bg-[#070B14] text-white">
      <Navbar />

      <Hero />

      <ContinueWatching />

      <TopTen />

      <FeaturedBanner />

      <MovieRow title="🔥 Trending Now" type="trending" />

      <MovieRow title="🎬 Now Playing" type="nowPlaying" />

      <MovieRow title="🍿 Popular Movies" type="popular" />

      <MovieRow title="⭐ Top Rated" type="topRated" />

      <MovieRow title="🆕 New Releases" type="upcoming" />

      
<AIAssistant />
      <Footer />
    </main>
  );
}