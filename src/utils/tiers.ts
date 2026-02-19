import { TierGroup } from "../types/problem";

export const RANK_GROUPS: Exclude<TierGroup, "all">[] = [
  "unrated",
  "bronze",
  "silver",
  "gold",
  "platinum",
  "diamond",
  "ruby",
  "master"
];

export const RANK_GROUP_LABELS: Record<Exclude<TierGroup, "all">, string> = {
  unrated: "Unrated",
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
  platinum: "Platinum",
  diamond: "Diamond",
  ruby: "Ruby",
  master: "Master"
};

const TIER_LABELS: Record<number, string> = {
  0: "Unrated",
  1: "Bronze V",
  2: "Bronze IV",
  3: "Bronze III",
  4: "Bronze II",
  5: "Bronze I",
  6: "Silver V",
  7: "Silver IV",
  8: "Silver III",
  9: "Silver II",
  10: "Silver I",
  11: "Gold V",
  12: "Gold IV",
  13: "Gold III",
  14: "Gold II",
  15: "Gold I",
  16: "Platinum V",
  17: "Platinum IV",
  18: "Platinum III",
  19: "Platinum II",
  20: "Platinum I",
  21: "Diamond V",
  22: "Diamond IV",
  23: "Diamond III",
  24: "Diamond II",
  25: "Diamond I",
  26: "Ruby V",
  27: "Ruby IV",
  28: "Ruby III",
  29: "Ruby II",
  30: "Ruby I",
  31: "Master"
};

// Convert solved.ac numeric level into a readable tier label.
export function tierLabelFromLevel(level: number): string {
  return TIER_LABELS[level] ?? `Level ${level}`;
}

// solved.ac advanced search clause for each rank group.
export function tierClauseForGroup(tierGroup: Exclude<TierGroup, "all">): string {
  if (tierGroup === "unrated") {
    return "*0";
  }

  if (tierGroup === "bronze") {
    return "*1..5";
  }

  if (tierGroup === "silver") {
    return "*6..10";
  }

  if (tierGroup === "gold") {
    return "*11..15";
  }

  if (tierGroup === "platinum") {
    return "*16..20";
  }

  if (tierGroup === "diamond") {
    return "*21..25";
  }

  if (tierGroup === "ruby") {
    return "*26..30";
  }

  return "*31";
}

// Apply UX-level tier filter groups on solved.ac numeric levels.
export function inTierGroup(level: number, tierGroup: TierGroup): boolean {
  if (tierGroup === "all") {
    return true;
  }

  if (tierGroup === "unrated") {
    return level === 0;
  }

  if (tierGroup === "bronze") {
    return level >= 1 && level <= 5;
  }

  if (tierGroup === "silver") {
    return level >= 6 && level <= 10;
  }

  if (tierGroup === "gold") {
    return level >= 11 && level <= 15;
  }

  if (tierGroup === "platinum") {
    return level >= 16 && level <= 20;
  }

  if (tierGroup === "diamond") {
    return level >= 21 && level <= 25;
  }

  if (tierGroup === "ruby") {
    return level >= 26 && level <= 30;
  }

  return level === 31;
}
