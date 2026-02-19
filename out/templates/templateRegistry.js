"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderTemplate = renderTemplate;
// Build file templates with metadata only (copyright-safe).
function renderTemplate(problem, extension) {
    const url = `https://www.acmicpc.net/problem/${problem.problemId}`;
    const tags = problem.tags.join(", ") || "-";
    if (extension === "py") {
        return `# BOJ ${problem.problemId} - ${problem.title}
# URL: ${url}
# Tier: ${problem.tierText}
# Tags: ${tags}

import sys
input = sys.stdin.readline

def solve() -> None:
    pass

if __name__ == "__main__":
    solve()
`;
    }
    if (extension === "cpp") {
        return `// BOJ ${problem.problemId} - ${problem.title}
// URL: ${url}
// Tier: ${problem.tierText}
// Tags: ${tags}

#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    return 0;
}
`;
    }
    if (extension === "js") {
        return `// BOJ ${problem.problemId} - ${problem.title}
// URL: ${url}
// Tier: ${problem.tierText}
// Tags: ${tags}

const fs = require("fs");
const input = fs.readFileSync(0, "utf8").trim().split(/\s+/);

function solve() {
  // TODO: implement
}

solve();
`;
    }
    if (extension === "java") {
        return `// BOJ ${problem.problemId} - ${problem.title}
// URL: ${url}
// Tier: ${problem.tierText}
// Tags: ${tags}

import java.io.*;
import java.util.*;

class Main {
    public static void main(String[] args) throws Exception {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));

    }
}
`;
    }
    return `// BOJ ${problem.problemId} - ${problem.title}
// URL: ${url}
// Tier: ${problem.tierText}
// Tags: ${tags}
`;
}
//# sourceMappingURL=templateRegistry.js.map