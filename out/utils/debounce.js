"use strict";
// Small debounce helper for async UI-driven searches.
Object.defineProperty(exports, "__esModule", { value: true });
exports.debounce = debounce;
function debounce(fn, delayMs) {
    let timer;
    return (...args) => {
        if (timer) {
            clearTimeout(timer);
        }
        timer = setTimeout(() => {
            fn(...args);
        }, delayMs);
    };
}
//# sourceMappingURL=debounce.js.map