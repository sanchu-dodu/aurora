import Link from "next/link";

export default function Sidebar() {
  return (
    <aside className="w-64 bg-[#0B1220] border-r border-gray-800 p-6 shrink-0">
      <h1 className="text-3xl font-black text-blue-500 mb-10">
        AURORA
      </h1>

      <nav className="flex flex-col gap-4">
        <Link href="/">🏠 Home</Link>
        <Link href="/movies">🎬 Movies</Link>
        <Link href="/tv-shows">📺 TV Shows</Link>
        <Link href="/search">🔍 Search</Link>
        <Link href="/my-list">❤️ My List</Link>
      </nav>
    </aside>
  );
}