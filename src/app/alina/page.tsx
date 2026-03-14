import AlinaChat from "@/components/AlinaChat";
import LogoutButton from "@/components/LogoutButton";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";

export default async function AlinaPage() {
  // Create a Supabase server client using cookies (App Router pattern)
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {
          // intentionally empty (read-only in this component)
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <main className="h-screen w-screen bg-black text-white overflow-hidden">
      <header className="w-full flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="text-sm font-semibold tracking-wide">Alina</div>
        <LogoutButton />
      </header>

      <div className="h-[calc(100vh-56px)] w-full">
        <AlinaChat />
      </div>
    </main>
  );
}