import fs from "node:fs";

const seedPath = new URL("../supabase/seed/kitakana_elo_seed.json", import.meta.url);
const seed = JSON.parse(fs.readFileSync(seedPath, "utf8"));
const tolerance = 1e-8;
const calculatedCurrent = new Map(seed.teams.map(team => [team.name, team.starting_elo]));
const matches = [...seed.matches].sort((a, b) => a.match_order - b.match_order);
let checkedValues = 0;
const failures = [];

function near(actual, expected, label) {
  checkedValues++;
  if (expected == null || Math.abs(actual - expected) <= tolerance) return;
  failures.push({ label, expected, actual, difference: actual - expected });
}

for (const match of matches) {
  const preA = match.expected.team_a_pre_elo;
  const preB = match.expected.team_b_pre_elo;
  const resultValue = seed.result_types[match.result_type];
  const multiplier = seed.tiers[match.tier];
  const expectedA = 1 / (1 + (10 ** ((preB - preA) / seed.settings.rating_scale)));
  const expectedB = 1 - expectedA;
  const actualA = match.winner === "Tie"
    ? 0.5
    : match.winner === "Team A"
      ? (resultValue + seed.settings.maximum_result_value) / (2 * seed.settings.maximum_result_value)
      : (-resultValue + seed.settings.maximum_result_value) / (2 * seed.settings.maximum_result_value);
  const actualB = 1 - actualA;
  const deltaA = (2 * seed.settings.maximum_result_value) * multiplier * (actualA - expectedA);
  const deltaB = -deltaA;
  const postA = preA + deltaA;
  const postB = preB + deltaB;

  near(expectedA, match.expected.expected_a, `${match.match_code}.expected_a`);
  near(expectedB, match.expected.expected_b, `${match.match_code}.expected_b`);
  near(resultValue, match.expected.result_value, `${match.match_code}.result_value`);
  near(multiplier, match.expected.multiplier, `${match.match_code}.multiplier`);
  near(actualA, match.expected.actual_a, `${match.match_code}.actual_a`);
  near(actualB, match.expected.actual_b, `${match.match_code}.actual_b`);
  near(deltaA, match.expected.team_a_delta, `${match.match_code}.team_a_delta`);
  near(deltaB, match.expected.team_b_delta, `${match.match_code}.team_b_delta`);
  near(postA, match.expected.team_a_post_elo, `${match.match_code}.team_a_post_elo`);
  near(postB, match.expected.team_b_post_elo, `${match.match_code}.team_b_post_elo`);

  calculatedCurrent.set(match.team_a, (calculatedCurrent.get(match.team_a) ?? 0) + match.expected.team_a_delta);
  calculatedCurrent.set(match.team_b, (calculatedCurrent.get(match.team_b) ?? 0) + match.expected.team_b_delta);
}

for (const bonus of seed.bonuses) {
  calculatedCurrent.set(bonus.team, (calculatedCurrent.get(bonus.team) ?? 0) + bonus.points);
}
for (const team of seed.teams) near(calculatedCurrent.get(team.name), team.expected_current_elo, `team.${team.name}.current_elo`);

if (failures.length) {
  console.error(JSON.stringify({ ok: false, checkedValues, failures: failures.slice(0, 20) }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, teams: seed.teams.length, bonuses: seed.bonuses.length, matches: seed.matches.length, checkedValues }));
}
