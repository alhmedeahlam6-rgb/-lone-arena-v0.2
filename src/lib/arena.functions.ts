import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const matchResultSchema = z.object({
  blue_score: z.number().int().min(0),
  red_score: z.number().int().min(0),
  winner: z.enum(["blue", "red"]),
  player_team: z.enum(["blue", "red"]),
  player_kills: z.number().int().min(0),
  player_deaths: z.number().int().min(0),
});

export const saveMatchResult = createServerFn({ method: "POST" })
  .validator((data) => matchResultSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("match_results").insert({
      blue_score: data.blue_score,
      red_score: data.red_score,
      winner: data.winner,
      player_team: data.player_team,
      player_kills: data.player_kills,
      player_deaths: data.player_deaths,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });


export const getLeaderboard = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("match_results")
    .select("winner, player_team, player_kills, player_deaths, blue_score, red_score")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const byTeam: Record<string, { wins: number; losses: number; kills: number; deaths: number }> = {
    blue: { wins: 0, losses: 0, kills: 0, deaths: 0 },
    red: { wins: 0, losses: 0, kills: 0, deaths: 0 },
  };
  for (const r of rows) {
    const team = r.player_team;
    if (!team || !byTeam[team]) continue;
    const won = r.winner === team;
    byTeam[team]!.wins += won ? 1 : 0;
    byTeam[team]!.losses += won ? 0 : 1;
    byTeam[team]!.kills += r.player_kills;
    byTeam[team]!.deaths += r.player_deaths;
  }
  return { recent: rows.slice(0, 10), totals: byTeam };
});
