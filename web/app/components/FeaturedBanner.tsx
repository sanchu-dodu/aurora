export default function FeaturedBanner() {
  return (
    <section className="px-12 mt-24">

      <h2 className="text-3xl font-bold mb-8">
        Featured Today
      </h2>

      <div className="bg-gradient-to-r from-blue-900 to-black rounded-3xl p-10 flex justify-between items-center">

        <div>

          <p className="text-blue-400 mb-2">
            AI Recommendation
          </p>

          <h3 className="text-5xl font-black mb-4">
            INTERSTELLAR
          </h3>

          <p className="text-gray-300 max-w-xl mb-8">
            A team of explorers travel through a wormhole in space
            to ensure humanity&apos;s survival.
          </p>

          <button className="bg-blue-600 px-8 py-3 rounded-xl hover:bg-blue-700 transition">
            ▶ Watch Now
          </button>

        </div>

        <div className="text-8xl">
          🚀
        </div>

      </div>

    </section>
  );
}