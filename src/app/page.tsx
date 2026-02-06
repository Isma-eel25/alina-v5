"use client";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-slate-950 text-white p-6">
      <h1 className="text-4xl font-bold mb-4">Welcome to Alina</h1>
      <p className="text-slate-300 mb-6">
        The companion that closes the Execution–Emotion Gap.
      </p>

      {/* WAITLIST FORM */}
      <section className="mt-10">
        <h2 className="text-2xl font-semibold mb-4">Join the Waitlist</h2>

        <form
          className="space-y-4 max-w-md"
          onSubmit={async (e) => {
            e.preventDefault();

            const form = e.currentTarget;
            const formData = new FormData(form);

            const res = await fetch("/api/waitlist", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                name: formData.get("name"),
                email: formData.get("email"),
                source: "landing_page",
              }),
            });

            if (res.ok) {
              alert("You're on the waitlist 🚀");
              form.reset();
            } else {
              alert("Something went wrong. Please try again.");
            }
          }}
        >
          <input
            type="text"
            name="name"
            placeholder="Your name (optional)"
            className="w-full px-3 py-2 rounded bg-slate-900 text-white placeholder-slate-500 border border-slate-700"
          />

          <input
            type="email"
            name="email"
            placeholder="Your email"
            required
            className="w-full px-3 py-2 rounded bg-slate-900 text-white placeholder-slate-500 border border-slate-700"
          />

          <button
            type="submit"
            className="bg-purple-600 px-4 py-2 rounded font-semibold hover:bg-purple-700"
          >
            Join Waitlist
          </button>
        </form>
      </section>
    </main>
  );
}
