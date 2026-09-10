/**
 * ============================================================================
 * util.js — 通用工具函数
 * ============================================================================
 * 版本：v8.0.0
 * 更新日期：2026-09-11
 *
 * 重构说明：
 *   本模块从 v7.7.0 单文件主脚本提取，保留全部工具函数：
 *   - escapeHtml / escapeRegExp / isHighSurrogate / isLowSurrogate
 *   - sanitizeFilename
 *   - saveToLocalStorage / loadFromLocalStorage
 *   - isRegexSafe（含 19 条危险正则模式检测）
 *   - buildSearchRegex
 *
 * 无 DOM 依赖，无副作用。
 * ============================================================================
 */

export function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeRegExp(string) {
    return string.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

export function isHighSurrogate(charCode) {
    return charCode >= 0xD800 && charCode <= 0xDBFF;
}

export function isLowSurrogate(charCode) {
    return charCode >= 0xDC00 && charCode <= 0xDFFF;
}

export function sanitizeFilename(filename) {
    if (!filename) return 'code';
    return filename.trim().replace(/[\/\\:*?"<>|]/g, '_').replace(/\.\./g, '_') || 'code';
}

export function saveToLocalStorage(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (storageError) {
        // 静默失败
    }
}

export function loadFromLocalStorage(key, defaultValue) {
    try {
        const storedItem = localStorage.getItem(key);
        if (storedItem !== null) return JSON.parse(storedItem);
        return defaultValue;
    } catch (parseError) {
        return defaultValue;
    }
}

export function isRegexSafe(pattern) {
    if (!pattern || pattern.length > 100) return false;
    const dangerousPatterns = [
        /\([^)]*\|[^)]*\)[+*]{2,}/,
        /\((?:[^()]|\([^()]*\))*\)[+*]{2,}/,
        /\(\.\*\)[+*]/,
        /\(\.\+\)[+*]/,
        /\w+\+\+/,
        /\w+\*\*/,
        /\([^)]*\)\{[^}]*,[^}]*\}[+*]/,
        /(\[.*?\])\1[+*]/,
        /([+*{]\d*,?\d*})[\s\S]*\1/,
        /\([^)]*\|[^)]*\)[+*]/,
        /\([^)]*\)[+*]\s*[+*]/,
        /\([^)]+\|[^)]+\)\+/,
        /\(\w+\s?\?\)[+*]/,
        /\([^)]*\|[^)]*\)\+/,
        /\([^)]+\|[^)]+\)[+*]/,
        /\([a-zA-Z0-9_]+[+*?]\)[+*]/,
        /\([^)]+\|[^)]+\)\s*\+/,
        /\([^)]+\)\+[+*]/,
        /\([^)]*[+*][^)]*\)[+*]/
    ];
    for (let i = 0; i < dangerousPatterns.length; i++) {
        if (dangerousPatterns[i].test(pattern)) return false;
    }
    try {
        new RegExp(pattern);
    } catch (e) {
        return false;
    }
    return true;
}

export function buildSearchRegex(searchTerm, caseSensitive, wholeWord, useRegex) {
    if (!searchTerm) return null;
    let pattern;
    if (useRegex) {
        if (!isRegexSafe(searchTerm)) return null;
        try {
            new RegExp(searchTerm);
            pattern = searchTerm;
        } catch (e) {
            return null;
        }
    } else {
        const escapedTerm = escapeRegExp(searchTerm);
        pattern = wholeWord ? '\\b' + escapedTerm + '\\b' : escapedTerm;
    }
    const flags = 'g' + (caseSensitive ? '' : 'i');
    try {
        return new RegExp(pattern, flags);
    } catch (e) {
        return null;
    }
}