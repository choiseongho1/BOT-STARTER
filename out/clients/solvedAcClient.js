"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SolvedAcClient = void 0;
const tiers_1 = require("../utils/tiers");
class SolvedAcClient {
    baseUrl = "https://solved.ac/api/v3";
    timeoutMs = 8_000;
    cacheTtlMs = 30_000;
    cache = new Map();
    // Fetch only metadata from solved.ac (never BOJ statement content).
    async searchProblems(rawQuery, options = {}) {
        const query = rawQuery.trim();
        const page = options.page ?? 1;
        const sort = options.sort ?? "id";
        const direction = options.direction ?? "asc";
        const apiDirection = this.resolveApiDirection(direction);
        const cacheKey = `${query}::${page}::${sort}::${direction}`;
        const cached = this.cache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.result;
        }
        const encodedQuery = encodeURIComponent(query);
        const url = `${this.baseUrl}/search/problem?query=${encodedQuery}&page=${page}&sort=${sort}&direction=${apiDirection}`;
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
            const payload = (await response.json());
            if (!Array.isArray(payload.items)) {
                throw new Error("solved.ac API response schema mismatch");
            }
            const result = {
                total: typeof payload.count === "number" ? payload.count : payload.items.length,
                page,
                items: payload.items.map((item) => this.mapProblem(item))
            };
            this.cache.set(cacheKey, {
                expiresAt: Date.now() + this.cacheTtlMs,
                result
            });
            return result;
        }
        finally {
            clearTimeout(timeout);
        }
    }
    resolveApiDirection(direction) {
        return direction === "desc" || direction === "rankDesc" ? "desc" : "asc";
    }
    mapProblem(item) {
        const title = item.titleKo ??
            item.titles?.find((entry) => entry.language === "ko")?.title ??
            item.titles?.[0]?.title ??
            `BOJ ${item.problemId}`;
        const tags = (item.tags ?? [])
            .map((tag) => this.pickTagName(tag))
            .filter((name) => Boolean(name));
        return {
            problemId: item.problemId,
            title,
            level: item.level,
            tierText: (0, tiers_1.tierLabelFromLevel)(item.level),
            tags,
            acceptedUserCount: item.acceptedUserCount,
            averageTries: item.averageTries,
            votedUserCount: item.votedUserCount,
            isPartial: item.isPartial,
            official: item.official,
            sprout: item.sprout
        };
    }
    pickTagName(tag) {
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
exports.SolvedAcClient = SolvedAcClient;
//# sourceMappingURL=solvedAcClient.js.map