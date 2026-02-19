import { ProblemSortKey, ProblemSummary, SearchResult, SortDirection } from "../types/problem";
import { tierLabelFromLevel } from "../utils/tiers";

interface SolvedAcTitle {
  language: string;
  title: string;
}

interface SolvedAcTagDisplayName {
  language: string;
  name: string;
  short?: string;
}

interface SolvedAcTag {
  key: string;
  displayNames?: SolvedAcTagDisplayName[];
}

interface SolvedAcProblem {
  problemId: number;
  titleKo?: string;
  titles?: SolvedAcTitle[];
  level: number;
  tags?: SolvedAcTag[];
}

interface SolvedAcSearchResponse {
  count: number;
  items: SolvedAcProblem[];
}

interface CacheEntry {
  expiresAt: number;
  result: SearchResult;
}

interface SearchRequestOptions {
  page: number;
  sort: ProblemSortKey;
  direction: SortDirection;
}

export class SolvedAcClient {
  private readonly baseUrl = "https://solved.ac/api/v3";
  private readonly timeoutMs = 8_000;
  private readonly cacheTtlMs = 30_000;
  private readonly cache = new Map<string, CacheEntry>();

  // Fetch only metadata from solved.ac (never BOJ statement content).
  async searchProblems(
    rawQuery: string,
    options: Partial<SearchRequestOptions> = {}
  ): Promise<SearchResult> {
    const query = rawQuery.trim();
    const page = options.page ?? 1;
    const sort = options.sort ?? "id";
    const direction = options.direction ?? "asc";
    const cacheKey = `${query}::${page}::${sort}::${direction}`;
    const cached = this.cache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.result;
    }

    const encodedQuery = encodeURIComponent(query);
    const url = `${this.baseUrl}/search/problem?query=${encodedQuery}&page=${page}&sort=${sort}&direction=${direction}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json"
        },
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`solved.ac API request failed (${response.status})`);
      }

      const payload = (await response.json()) as SolvedAcSearchResponse;

      if (!Array.isArray(payload.items)) {
        throw new Error("solved.ac API response schema mismatch");
      }

      const result: SearchResult = {
        total: typeof payload.count === "number" ? payload.count : payload.items.length,
        page,
        items: payload.items.map((item) => this.mapProblem(item))
      };

      this.cache.set(cacheKey, {
        expiresAt: Date.now() + this.cacheTtlMs,
        result
      });

      return result;
    } finally {
      clearTimeout(timeout);
    }
  }

  private mapProblem(item: SolvedAcProblem): ProblemSummary {
    const title =
      item.titleKo ??
      item.titles?.find((entry) => entry.language === "ko")?.title ??
      item.titles?.[0]?.title ??
      `BOJ ${item.problemId}`;

    const tags = (item.tags ?? [])
      .map((tag) => this.pickTagName(tag))
      .filter((name): name is string => Boolean(name));

    return {
      problemId: item.problemId,
      title,
      level: item.level,
      tierText: tierLabelFromLevel(item.level),
      tags
    };
  }

  private pickTagName(tag: SolvedAcTag): string | undefined {
    if (!tag.displayNames || tag.displayNames.length === 0) {
      return tag.key;
    }

    const ko = tag.displayNames.find((displayName) => displayName.language === "ko");
    if (ko) {
      return ko.short ?? ko.name;
    }

    const en = tag.displayNames.find((displayName) => displayName.language === "en");
    if (en) {
      return en.short ?? en.name;
    }

    return tag.displayNames[0].short ?? tag.displayNames[0].name;
  }
}
