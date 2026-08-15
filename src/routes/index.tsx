import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";

const LoneWolfArena = lazy(() => import("@/components/arena/LoneWolfArena"));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Lone Wolf Arena — 2v2 3D Battle Map" },
      {
        name: "description",
        content:
          "Explore a closed 3D combat compound built for 2v2 duels: symmetric cover, a raised center platform and team spawn pads.",
      },
      { property: "og:title", content: "Lone Wolf Arena — 2v2 3D Battle Map" },
      {
        property: "og:description",
        content: "A closed, symmetric 3D arena for 2v2 duels. Orbit the map or drop in and walk it.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-background">
      <div className="absolute inset-0">
        {mounted && (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-xs uppercase tracking-[0.3em] text-muted-foreground">
                Loading arena…
              </div>
            }
          >
            <LoneWolfArena />
          </Suspense>
        )}
      </div>

    </main>
  );
}
