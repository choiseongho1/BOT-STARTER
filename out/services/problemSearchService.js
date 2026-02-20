"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProblemSearchService = void 0;
const tiers_1 = require("../utils/tiers");
const SEARCH_PAGE_SIZE = 50;
class ProblemSearchService {
    solvedAcClient;
    constructor(solvedAcClient) {
        this.solvedAcClient = solvedAcClient;
    }
    // Convert user-friendly input into solved.ac query-compatible text.
    async search(input, tierGroup) {
        const result = await this.searchPaged(input, {
            tierGroup,
            page: 1,
            sort: "id",
            direction: "asc"
        });
        return result.items;
    }
    async searchPaged(input, options) {
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
        const filteredItems = searchResult.items.filter((item) => (0, tiers_1.inTierGroup)(item.level, options.tierGroup));
        const sortedItems = this.isRankDirection(options.direction)
            ? this.sortItemsByRank(filteredItems, options.direction)
            : filteredItems;
        return {
            ...searchResult,
            items: sortedItems
        };
    }
    shouldUseSplitRankAscSearch(options, query) {
        return options.direction === "rankAsc" && options.tierGroup === "all" && !this.hasExplicitTierSyntax(query);
    }
    async searchRankAscAllWithUnratedLast(query, page) {
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
    resolveRequestedSort(sort, direction) {
        return this.isRankDirection(direction) ? "level" : sort;
    }
    resolveRequestedDirection(direction) {
        return direction === "desc" || direction === "rankDesc" ? "desc" : "asc";
    }
    isRankDirection(direction) {
        return direction === "rankAsc" || direction === "rankDesc";
    }
    sortItemsByRank(items, direction) {
        return [...items].sort((left, right) => this.compareByRank(left, right, direction));
    }
    compareByRank(left, right, direction) {
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
    rankGroupIndex(level) {
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
    normalizeQuery(input) {
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
    applyTierFilter(query, tierGroup) {
        if (tierGroup === "all") {
            return query;
        }
        // If user already supplied tier syntax, keep original query untouched.
        if (this.hasExplicitTierSyntax(query)) {
            return query;
        }
        return `${query} ${(0, tiers_1.tierClauseForGroup)(tierGroup)}`;
    }
    hasExplicitTierSyntax(query) {
        return /\btier:|\*(?:[0-9]|[bsgpdru])/i.test(query);
    }
}
exports.ProblemSearchService = ProblemSearchService;
//# sourceMappingURL=problemSearchService.js.map