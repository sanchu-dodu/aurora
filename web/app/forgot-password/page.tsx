export default function ForgotPasswordPage() {
  return (
    <main className="min-h-screen bg-[#070B14] flex items-center justify-center px-6">
      <div className="w-full max-w-md bg-[#0E1423] rounded-2xl p-8 shadow-2xl">

        <h1 className="text-4xl font-black text-center text-blue-500">
          Reset Password
        </h1>

        <p className="text-gray-400 text-center mt-3 mb-8">
          Enter your email and we&apos;ll send you a reset link.
        </p>

        <form className="space-y-5">

          <div>
            <label className="block mb-2 text-sm text-gray-300">
              Email Address
            </label>

            <input
              type="email"
              placeholder="Enter your email"
              className="w-full rounded-xl bg-[#161F33] border border-gray-700 px-4 py-3 text-white outline-none focus:border-blue-500"
            />
          </div>

          <button className="w-full bg-blue-600 hover:bg-blue-700 py-3 rounded-xl font-semibold transition">
            Send Reset Link
          </button>

        </form>

        <p className="text-center text-gray-400 mt-8">
          Remember your password?{" "}
          <a href="/signin" className="text-blue-400 hover:underline">
            Sign In
          </a>
        </p>

      </div>
    </main>
  );
}