import {
  getMovieDetails,
  getMovieVideos,
  getSimilarMovies,
} from "../../lib/tmdb";

import AuroraPlayer from "../../components/AuroraPlayer";
import SimilarMovies from "../../components/SimilarMovies";
import MyListButton from "../../components/MyListButton";


type MovieVideo = {
  site: string;
  type: string;
  key: string;
};

type MovieGenre = {
  id: number;
  name: string;
};

type MoviePageProps = {
  params: Promise<{
    id: string;
  }>;
};


export default async function MovieDetails({
  params,
}: MoviePageProps) {

  const { id } = await params;

  const movie = await getMovieDetails(id);
  const videos = await getMovieVideos(id);
  const similarMovies = await getSimilarMovies(id);


  const trailer = videos.find(
    (video: MovieVideo) =>
      video.site === "YouTube" &&
      video.type === "Trailer"
  );


  const backdrop = movie.backdrop_path
    ? `https://image.tmdb.org/t/p/original${movie.backdrop_path}`
    : "";


  const poster = movie.poster_path
    ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
    : "/placeholder.jpg";


  return (
    <main className="min-h-screen bg-[#070B14] text-white">


      {/* Hero */}

      <section className="relative h-[75vh] overflow-hidden">

        {trailer ? (

          <AuroraPlayer
  videoKey={trailer.key}
  title={movie.title}
  movieId={movie.id}
  poster={poster}
/>
        ) : (

          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{
              backgroundImage: `url(${backdrop})`,
            }}
          />

        )}

      </section>



      {/* Movie Content */}

      <section className="relative max-w-7xl mx-auto px-10 py-16">

        <div className="flex flex-col lg:flex-row gap-10">


          <img
            src={poster}
            alt={movie.title}
            className="w-72 rounded-2xl shadow-2xl"
          />



          <div className="flex-1">


            <h1 className="text-6xl font-black mb-6">
              {movie.title}
            </h1>



            <div className="flex flex-wrap gap-5 text-gray-300 mb-8">

              <span>
                ⭐ {movie.vote_average.toFixed(1)}
              </span>


              <span>
                📅 {movie.release_date?.slice(0, 4)}
              </span>


              <span>
                ⏱ {movie.runtime} min
              </span>

            </div>




            <div className="flex flex-wrap gap-3 mb-8">

              {movie.genres.map((genre: MovieGenre) => (

                <span
                  key={genre.id}
                  className="rounded-full bg-blue-600 px-4 py-2"
                >
                  {genre.name}
                </span>

              ))}

            </div>




            <p className="max-w-4xl text-lg leading-9 text-gray-300">
              {movie.overview}
            </p>




            <div className="mt-10 flex gap-5">

              <button className="rounded-xl bg-blue-600 px-8 py-4 hover:bg-blue-700 transition">
                ▶ Watch Trailer
              </button>


              <MyListButton movie={movie} />

            </div>



          </div>

        </div>


      </section>




      {/* Recommendations */}

      <section className="max-w-7xl mx-auto px-10 pb-16">

        <SimilarMovies movies={similarMovies} />

      </section>



    </main>
  );
}