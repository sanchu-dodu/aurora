export default function MovieCardSkeleton() {
  return (
    <div className="min-w-[220px] animate-pulse">
      <div className="h-[330px] rounded-2xl bg-gray-800" />

      <div className="mt-4 h-5 w-3/4 rounded bg-gray-800" />

      <div className="mt-3 h-4 w-1/2 rounded bg-gray-700" />
    </div>
  );
}