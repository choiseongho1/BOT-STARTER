import { SolvedAcClient } from "../clients/solvedAcClient";
import {
  ProblemSortKey,
  ProblemSummary,
  SearchResult,
  SortDirection,
  TierGroup
} from "../types/problem";
import { inTierGroup, RANK_GROUPS, tierClauseForGroup } from "../utils/tiers";

interface SearchPagedOptions {
  tierGroup: TierGroup;
  page: number;
  sort: ProblemSortKey;
  direction: SortDirection;
}

export interface TierCountResult {
  total: number;
  sum: number;
  counts: Record<Exclude<TierGroup, "all">, number>;
}

export class ProblemSearchService {
  constructor(private readonly solvedAcClient: SolvedAcClient) {}

  // Convert user-friendly input into solved.ac query-compatible text.
  async search(input: string, tierGroup: TierGroup): Promise<ProblemSummary[]> {
    const result = await this.searchPaged(input, {
      tierGroup,
      page: 1,
      sort: "id",
      direction: "asc"
    });

    return result.items;
  }

  async searchPaged(input: string, options: SearchPagedOptions): Promise<SearchResult> {
    const query = this.normalizeQuery(input);
    if (!query) {
      return {
        items: [],
        total: 0,
        page: options.page
      };
    }

    const tierAwareQuery = this.applyTierFilter(query, options.tierGroup);
    const searchResult = await this.solvedAcClient.searchProblems(tierAwareQuery, {
      page: options.page,
      sort: options.sort,
      direction: options.direction
    });

    return {
      ...searchResult,
      items: searchResult.items.filter((item) => inTierGroup(item.level, options.tierGroup))
    };
  }

  async getTierCounts(
    input: string,
    tierGroup: TierGroup,
    knownTotal?: number
  ): Promise<TierCountResult> {
    const query = this.normalizeQuery(input);
    if (!query) {
      return {
        total: 0,
        sum: 0,
        counts: {
          unrated: 0,
          bronze: 0,
          silver: 0,
          gold: 0,
          platinum: 0,
          diamond: 0,
          ruby: 0,
          master: 0
        }
      };
    }

    const baseQuery = this.applyTierFilter(query, tierGroup);
    const total =
      knownTotal ??
      (
        await this.solvedAcClient.searchProblems(baseQuery, {
          page: 1,
          sort: "id",
          direction: "asc"
        })
      ).total;

    const countValues = await Promise.all(
      RANK_GROUPS.map(async (rank) => {
        const rankQuery = `${baseQuery} ${tierClauseForGroup(rank)}`.trim();
        const result = await this.solvedAcClient.searchProblems(rankQuery, {
          page: 1,
          sort: "id",
          direction: "asc"
        });

        return [rank, result.total] as const;
      })
    );

    const counts = {
      unrated: 0,
      bronze: 0,
      silver: 0,
      gold: 0,
      platinum: 0,
      diamond: 0,
      ruby: 0,
      master: 0
    } as Record<Exclude<TierGroup, "all">, number>;

    for (const [rank, count] of countValues) {
      counts[rank] = count;
    }

    const sum = Object.values(counts).reduce((acc, value) => acc + value, 0);

    return {
      total,
      sum,
      counts
    };
  }

  private normalizeQuery(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) {
      return "";
    }

    // If user typed only digits, force problem-id search for precision.
    if (/^\d+$/.test(trimmed)) {
      return `id:${trimmed}`;
    }

    // Keep advanced solved.ac syntax untouched (#dp, tier filters, id ranges, etc.).
    return trimmed;
  }

  private applyTierFilter(query: string, tierGroup: TierGroup): string {
    if (tierGroup === "all") {
      return query;
    }

    // If user already supplied tier syntax, keep original query untouched.
    if (/\btier:|\*(?:[0-9]|[bsgpdru])/i.test(query)) {
      return query;
    }

    return `${query} ${tierClauseForGroup(tierGroup)}`;
  }
}
