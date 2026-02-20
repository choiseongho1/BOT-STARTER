import { SolvedAcClient } from "../clients/solvedAcClient";
import {
  ProblemSortKey,
  ProblemSummary,
  SearchResult,
  SortDirection,
  TierGroup
} from "../types/problem";
import { inTierGroup, tierClauseForGroup } from "../utils/tiers";

interface SearchPagedOptions {
  tierGroup: TierGroup;
  page: number;
  sort: ProblemSortKey;
  direction: SortDirection;
}

const SEARCH_PAGE_SIZE = 50;

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
    if (this.shouldUseSplitRankAscSearch(options, query)) {
      return this.searchRankAscAllWithUnratedLast(tierAwareQuery, options.page);
    }

    const requestedSort = this.resolveRequestedSort(options.sort, options.direction);
    const requestedDirection = this.resolveRequestedDirection(options.direction);

    const searchResult = await this.solvedAcClient.searchProblems(tierAwareQuery, {
      page: options.page,
      sort: requestedSort,
      direction: requestedDirection
    });

    const filteredItems = searchResult.items.filter((item) => inTierGroup(item.level, options.tierGroup));
    const sortedItems = this.isRankDirection(options.direction)
      ? this.sortItemsByRank(filteredItems, options.direction)
      : filteredItems;

    return {
      ...searchResult,
      items: sortedItems
    };
  }

  private shouldUseSplitRankAscSearch(options: SearchPagedOptions, query: string): boolean {
    return options.direction === "rankAsc" && options.tierGroup === "all" && !this.hasExplicitTierSyntax(query);
  }

  private async searchRankAscAllWithUnratedLast(query: string, page: number): Promise<SearchResult> {
    const ratedQuery = `${query} *1..31`.trim();
    const unratedQuery = `${query} *0`.trim();

    const ratedFirst = await this.solvedAcClient.searchProblems(ratedQuery, {
      page: 1,
      sort: "level",
      direction: "asc"
    });
    const unratedFirst = await this.solvedAcClient.searchProblems(unratedQuery, {
      page: 1,
      sort: "id",
      direction: "asc"
    });

    const ratedTotal = ratedFirst.total;
    const unratedTotal = unratedFirst.total;
    const total = ratedTotal + unratedTotal;
    const ratedPageCount = Math.ceil(ratedTotal / SEARCH_PAGE_SIZE);

    if (page <= ratedPageCount || unratedTotal === 0) {
      const ratedPage = page === 1 ? ratedFirst : await this.solvedAcClient.searchProblems(ratedQuery, {
        page,
        sort: "level",
        direction: "asc"
      });

      return {
        total,
        page,
        items: this.sortItemsByRank(ratedPage.items, "rankAsc")
      };
    }

    const unratedPageNumber = page - ratedPageCount;
    const unratedPage = unratedPageNumber === 1
      ? unratedFirst
      : await this.solvedAcClient.searchProblems(unratedQuery, {
          page: unratedPageNumber,
          sort: "id",
          direction: "asc"
        });

    return {
      total,
      page,
      items: this.sortItemsByRank(unratedPage.items, "rankAsc")
    };
  }

  private resolveRequestedSort(sort: ProblemSortKey, direction: SortDirection): ProblemSortKey {
    return this.isRankDirection(direction) ? "level" : sort;
  }

  private resolveRequestedDirection(direction: SortDirection): "asc" | "desc" {
    return direction === "desc" || direction === "rankDesc" ? "desc" : "asc";
  }

  private isRankDirection(direction: SortDirection): direction is "rankAsc" | "rankDesc" {
    return direction === "rankAsc" || direction === "rankDesc";
  }

  private sortItemsByRank(
    items: ProblemSummary[],
    direction: Extract<SortDirection, "rankAsc" | "rankDesc">
  ): ProblemSummary[] {
    return [...items].sort((left, right) => this.compareByRank(left, right, direction));
  }

  private compareByRank(
    left: ProblemSummary,
    right: ProblemSummary,
    direction: Extract<SortDirection, "rankAsc" | "rankDesc">
  ): number {
    const leftIsUnrated = left.level <= 0;
    const rightIsUnrated = right.level <= 0;
    if (leftIsUnrated && rightIsUnrated) {
      return left.problemId - right.problemId;
    }

    if (leftIsUnrated) {
      return 1;
    }

    if (rightIsUnrated) {
      return -1;
    }

    const leftGroup = this.rankGroupIndex(left.level);
    const rightGroup = this.rankGroupIndex(right.level);

    if (leftGroup !== rightGroup) {
      return direction === "rankAsc" ? leftGroup - rightGroup : rightGroup - leftGroup;
    }

    if (left.level !== right.level) {
      return direction === "rankAsc" ? left.level - right.level : right.level - left.level;
    }

    return left.problemId - right.problemId;
  }

  private rankGroupIndex(level: number): number {
    if (level <= 0) {
      return 7;
    }

    if (level === 31) {
      return 6;
    }

    if (level <= 30) {
      return Math.floor((level - 1) / 5);
    }

    return 7;
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
    if (this.hasExplicitTierSyntax(query)) {
      return query;
    }

    return `${query} ${tierClauseForGroup(tierGroup)}`;
  }

  private hasExplicitTierSyntax(query: string): boolean {
    return /\btier:|\*(?:[0-9]|[bsgpdru])/i.test(query);
  }
}
