// Core domain types used across UI, services, and infrastructure layers.

export type TierGroup =
  | "all"
  | "unrated"
  | "bronze"
  | "silver"
  | "gold"
  | "platinum"
  | "diamond"
  | "ruby"
  | "master";
export type ProblemSortKey = "id" | "level" | "solved";
export type SortDirection = "asc" | "desc" | "rankAsc" | "rankDesc";

export interface ProblemSummary {
  problemId: number;
  title: string;
  level: number;
  tierText: string;
  tags: string[];
  acceptedUserCount?: number;
  averageTries?: number;
  votedUserCount?: number;
  isPartial?: boolean;
  official?: boolean;
  sprout?: boolean;
}

export interface SearchResult {
  items: ProblemSummary[];
  total: number;
  page: number;
}

export interface ProblemTestCase {
  index: number;
  input: string;
  output: string;
}

export interface ProblemDetail {
  problemId: number;
  title: string;
  url: string;
  problem: string;
  problemHtml: string;
  input: string;
  inputHtml: string;
  output: string;
  outputHtml: string;
  testCases: ProblemTestCase[];
}
