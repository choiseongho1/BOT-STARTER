import { ProblemDetail, ProblemTestCase } from "../types/problem";

const STATEMENT_ALLOWED_TAGS = new Set([
  "a",
  "blockquote",
  "br",
  "code",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "li",
  "ol",
  "p",
  "pre",
  "s",
  "span",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "u",
  "ul"
]);
const VOID_TAGS = new Set(["br", "hr", "img"]);
const FORBIDDEN_BLOCK_TAG_PATTERN =
  /<\s*(script|style|iframe|object|embed|form|textarea|select|option|button|svg|math|noscript)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;
const FORBIDDEN_SINGLE_TAG_PATTERN =
  /<\s*(script|style|iframe|object|embed|form|textarea|select|option|button|input|link|meta|base|svg|math|noscript)\b[^>]*\/?>/gi;

interface CacheEntry {
  expiresAt: number;
  detail: ProblemDetail;
}

export class ProblemDetailService {
  private readonly baseOrigin = "https://www.acmicpc.net";
  private readonly baseUrl = `${this.baseOrigin}/problem`;
  private readonly timeoutMs = 10_000;
  private readonly cacheTtlMs = 60_000;
  private readonly cache = new Map<number, CacheEntry>();

  // Load BOJ problem page and extract title/description/sample testcases.
  async getProblemDetail(problemId: number): Promise<ProblemDetail> {
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
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
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
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseProblemHtml(problemId: number, html: string): ProblemDetail {
    const titleRaw = this.captureFirst(html, /id="problem_title"[^>]*>([\s\S]*?)<\/span>/i);
    const title = this.cleanText(titleRaw) || `BOJ ${problemId}`;

    const problemHtmlRaw = this.captureFirst(
      html,
      /<div[^>]*id="problem_description"[^>]*>([\s\S]*?)<\/div>/i
    );
    const inputHtmlRaw = this.captureFirst(html, /<div[^>]*id="problem_input"[^>]*>([\s\S]*?)<\/div>/i);
    const outputHtmlRaw = this.captureFirst(
      html,
      /<div[^>]*id="problem_output"[^>]*>([\s\S]*?)<\/div>/i
    );

    const problemText = this.cleanText(problemHtmlRaw);
    const inputText = this.cleanText(inputHtmlRaw);
    const outputText = this.cleanText(outputHtmlRaw);
    const problemHtml = this.sanitizeStatementHtml(problemHtmlRaw);
    const inputHtml = this.sanitizeStatementHtml(inputHtmlRaw);
    const outputHtml = this.sanitizeStatementHtml(outputHtmlRaw);

    const sampleInputs = this.captureSampleMap(html, "sampleinput");
    const sampleOutputs = this.captureSampleMap(html, "sampleoutput");
    const indices = Array.from(new Set([...sampleInputs.keys(), ...sampleOutputs.keys()])).sort(
      (left, right) => left - right
    );

    const testCaseCount = indices.length;
    const testCases: ProblemTestCase[] = [];
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
      problemHtml,
      input: inputText,
      inputHtml,
      output: outputText,
      outputHtml,
      testCases
    };
  }

  private sanitizeStatementHtml(rawHtml: string): string {
    const stripped = rawHtml
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
      .replace(FORBIDDEN_BLOCK_TAG_PATTERN, "")
      .replace(FORBIDDEN_SINGLE_TAG_PATTERN, "");

    return stripped
      .replace(/<\/?([a-zA-Z0-9:-]+)([^>]*)>/g, (full, rawTagName: string, rawAttrs: string) => {
        const tagName = rawTagName.toLowerCase();
        if (!STATEMENT_ALLOWED_TAGS.has(tagName)) {
          return "";
        }

        if (full.startsWith("</")) {
          return VOID_TAGS.has(tagName) ? "" : `</${tagName}>`;
        }

        const attrs = this.sanitizeTagAttributes(tagName, rawAttrs);
        if (attrs.length === 0) {
          return `<${tagName}>`;
        }

        return `<${tagName} ${attrs}>`;
      })
      .replace(/\r/g, "")
      .trim();
  }

  private sanitizeTagAttributes(tagName: string, rawAttrs: string): string {
    const allowedAttrsByTag: Record<string, Set<string>> = {
      a: new Set(["href", "title"]),
      img: new Set(["src", "alt", "title", "width", "height"]),
      td: new Set(["colspan", "rowspan"]),
      th: new Set(["colspan", "rowspan"]),
      span: new Set(["title"])
    };

    const allowedAttrs = allowedAttrsByTag[tagName];
    if (!allowedAttrs) {
      return "";
    }

    const attrs: string[] = [];
    const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let match = pattern.exec(rawAttrs);
    while (match) {
      const attrName = (match[1] ?? "").toLowerCase();
      if (attrName.startsWith("on") || !allowedAttrs.has(attrName)) {
        match = pattern.exec(rawAttrs);
        continue;
      }

      const rawValue = match[2] ?? match[3] ?? match[4] ?? "";
      const normalized = this.normalizeStatementAttribute(attrName, rawValue);
      if (!normalized) {
        match = pattern.exec(rawAttrs);
        continue;
      }

      attrs.push(`${attrName}="${this.escapeHtmlAttribute(normalized)}"`);
      match = pattern.exec(rawAttrs);
    }

    if (tagName === "a" && attrs.some((attr) => attr.startsWith("href="))) {
      attrs.push('target="_blank"');
      attrs.push('rel="noopener noreferrer"');
    }

    return attrs.join(" ");
  }

  private normalizeStatementAttribute(name: string, value: string): string | undefined {
    if (name === "href" || name === "src") {
      return this.normalizeStatementUrl(value);
    }

    if (name === "width" || name === "height" || name === "colspan" || name === "rowspan") {
      const numberValue = Number(value);
      if (!Number.isInteger(numberValue) || numberValue <= 0) {
        return undefined;
      }

      return String(numberValue);
    }

    const decoded = this.decodeEntities(value).trim();
    return decoded.length > 0 ? decoded : undefined;
  }

  private normalizeStatementUrl(raw: string): string | undefined {
    const decoded = this.decodeEntities(raw).trim();
    if (!decoded) {
      return undefined;
    }

    if (/^(javascript|vbscript|data|file):/i.test(decoded)) {
      return undefined;
    }

    if (decoded.startsWith("//")) {
      return `https:${decoded}`;
    }

    if (decoded.startsWith("/")) {
      return `${this.baseOrigin}${decoded}`;
    }

    if (/^http:\/\//i.test(decoded)) {
      return `https://${decoded.slice("http://".length)}`;
    }

    if (/^https?:\/\//i.test(decoded)) {
      return decoded;
    }

    return undefined;
  }

  private escapeHtmlAttribute(value: string): string {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  private captureSampleMap(
    html: string,
    prefix: "sampleinput" | "sampleoutput"
  ): Map<number, string> {
    const pattern = new RegExp(
      `<section[^>]*id="${prefix}(\\d+)"[\\s\\S]*?<pre[^>]*>([\\s\\S]*?)<\\/pre>[\\s\\S]*?<\\/section>`,
      "gi"
    );

    const values = new Map<number, string>();
    let match: RegExpExecArray | null = pattern.exec(html);
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

  private captureFirst(text: string, pattern: RegExp): string {
    const match = text.match(pattern);
    return match?.[1] ?? match?.[0] ?? "";
  }

  private cleanText(input: string): string {
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

  private cleanPreText(input: string): string {
    const stripped = input.replace(/<[^>]+>/g, "");
    const decoded = this.decodeEntities(stripped).replace(/\r/g, "");
    return decoded.replace(/\n+$/g, "");
  }

  private decodeEntities(input: string): string {
    let value = input;
    const named: Array<[RegExp, string]> = [
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
