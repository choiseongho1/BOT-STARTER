"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProblemDetailService = void 0;
class ProblemDetailService {
    baseUrl = "https://www.acmicpc.net/problem";
    timeoutMs = 10_000;
    cacheTtlMs = 60_000;
    cache = new Map();
    // Load BOJ problem page and extract title/description/sample testcases.
    async getProblemDetail(problemId) {
        const cached = this.cache.get(problemId);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.detail;
        }
        const url = `${this.baseUrl}/${problemId}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const response = await fetch(url, {
                method: "GET",
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
                },
                signal: controller.signal
            });
            if (!response.ok) {
                throw new Error(`BOJ problem request failed (${response.status})`);
            }
            const html = await response.text();
            const detail = this.parseProblemHtml(problemId, html);
            this.cache.set(problemId, {
                expiresAt: Date.now() + this.cacheTtlMs,
                detail
            });
            return detail;
        }
        finally {
            clearTimeout(timeout);
        }
    }
    parseProblemHtml(problemId, html) {
        const titleRaw = this.captureFirst(html, /id="problem_title"[^>]*>([\s\S]*?)<\/span>/i);
        const title = this.cleanText(titleRaw) || `BOJ ${problemId}`;
        const problemText = this.cleanText(this.captureFirst(html, /<div[^>]*id="problem_description"[^>]*>([\s\S]*?)<\/div>/i));
        const inputText = this.cleanText(this.captureFirst(html, /<div[^>]*id="problem_input"[^>]*>([\s\S]*?)<\/div>/i));
        const outputText = this.cleanText(this.captureFirst(html, /<div[^>]*id="problem_output"[^>]*>([\s\S]*?)<\/div>/i));
        const sampleInputs = this.captureSampleMap(html, "sampleinput");
        const sampleOutputs = this.captureSampleMap(html, "sampleoutput");
        const indices = Array.from(new Set([...sampleInputs.keys(), ...sampleOutputs.keys()])).sort((left, right) => left - right);
        const testCaseCount = indices.length;
        const testCases = [];
        for (let index = 0; index < testCaseCount; index += 1) {
            const sampleIndex = indices[index] ?? index + 1;
            testCases.push({
                index: sampleIndex,
                input: sampleInputs.get(sampleIndex) ?? "",
                output: sampleOutputs.get(sampleIndex) ?? ""
            });
        }
        return {
            problemId,
            title,
            url: `${this.baseUrl}/${problemId}`,
            problem: problemText,
            input: inputText,
            output: outputText,
            testCases
        };
    }
    captureSampleMap(html, prefix) {
        const pattern = new RegExp(`<section[^>]*id="${prefix}(\\d+)"[\\s\\S]*?<pre[^>]*>([\\s\\S]*?)<\\/pre>[\\s\\S]*?<\\/section>`, "gi");
        const values = new Map();
        let match = pattern.exec(html);
        while (match) {
            const index = Number(match[1]);
            const text = this.cleanPreText(match[2] ?? "");
            if (Number.isInteger(index) && index > 0) {
                values.set(index, text);
            }
            match = pattern.exec(html);
        }
        return values;
    }
    captureFirst(text, pattern) {
        const match = text.match(pattern);
        return match?.[1] ?? match?.[0] ?? "";
    }
    cleanText(input) {
        const withLineBreaks = input
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<\/p>/gi, "\n")
            .replace(/<\/li>/gi, "\n")
            .replace(/<[^>]+>/g, "");
        const decoded = this.decodeEntities(withLineBreaks)
            .replace(/\r/g, "")
            .replace(/\t/g, " ")
            .replace(/[ ]+\n/g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
        return decoded;
    }
    cleanPreText(input) {
        const stripped = input.replace(/<[^>]+>/g, "");
        const decoded = this.decodeEntities(stripped).replace(/\r/g, "");
        return decoded.replace(/\n+$/g, "");
    }
    decodeEntities(input) {
        let value = input;
        const named = [
            [/&nbsp;/g, " "],
            [/&lt;/g, "<"],
            [/&gt;/g, ">"],
            [/&amp;/g, "&"],
            [/&quot;/g, '"'],
            [/&#39;/g, "'"],
            [/&#x2F;/gi, "/"]
        ];
        for (const [pattern, replacement] of named) {
            value = value.replace(pattern, replacement);
        }
        value = value.replace(/&#(\d+);/g, (_full, code) => {
            const parsed = Number(code);
            return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : _full;
        });
        value = value.replace(/&#x([0-9a-f]+);/gi, (_full, hexCode) => {
            const parsed = parseInt(hexCode, 16);
            return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : _full;
        });
        return value;
    }
}
exports.ProblemDetailService = ProblemDetailService;
//# sourceMappingURL=problemDetailService.js.map