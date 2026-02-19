"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProblemSearchService = void 0;
const tiers_1 = require("../utils/tiers");
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
        const searchResult = await this.solvedAcClient.searchProblems(tierAwareQuery, {
            page: options.page,
            sort: options.sort,
            direction: options.direction
        });
        return {
            ...searchResult,
            items: searchResult.items.filter((item) => (0, tiers_1.inTierGroup)(item.level, options.tierGroup))
        };
    }
    async getTierCounts(input, tierGroup, knownTotal) {
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
        const total = knownTotal ??
            (await this.solvedAcClient.searchProblems(baseQuery, {
                page: 1,
                sort: "id",
                direction: "asc"
            })).total;
        const countValues = await Promise.all(tiers_1.RANK_GROUPS.map(async (rank) => {
            const rankQuery = `${baseQuery} ${(0, tiers_1.tierClauseForGroup)(rank)}`.trim();
            const result = await this.solvedAcClient.searchProblems(rankQuery, {
                page: 1,
                sort: "id",
                direction: "asc"
            });
            return [rank, result.total];
        }));
        const counts = {
            unrated: 0,
            bronze: 0,
            silver: 0,
            gold: 0,
            platinum: 0,
            diamond: 0,
            ruby: 0,
            master: 0
        };
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
        if (/\btier:|\*(?:[0-9]|[bsgpdru])/i.test(query)) {
            return query;
        }
        return `${query} ${(0, tiers_1.tierClauseForGroup)(tierGroup)}`;
    }
}
exports.ProblemSearchService = ProblemSearchService;
//# sourceMappingURL=problemSearchService.js.map