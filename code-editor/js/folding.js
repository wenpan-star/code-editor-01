/**
 * ============================================================================
 * folding.js — 代码折叠
 * ============================================================================
 * 版本：v8.0.0
 * 更新日期：2026-09-11
 *
 * 重构说明：
 *   从 v7.7.0 主脚本提取，保持全部行为：
 *   - 基于缩进层级判断可折叠范围
 *   - 用户点击行号旁的 ▼ / ▶ 触发
 *   - 折叠状态持久化到 localStorage
 * ============================================================================
 */

import { EditorState } from './state.js';
import { STORAGE_KEYS } from './config.js';
import { saveToLocalStorage } from './util.js';
import { DOM } from './dom.js';
import { scheduleHighlightUpdate } from './highlight.js';

export function getLineIndentLevel(line) {
    const indentMatch = line.match(/^[ \t]*/);
    if (!indentMatch) return 0;
    return indentMatch[0].length;
}

export function findFoldRange(lines, startLineIndex) {
    if (startLineIndex >= lines.length - 1) return null;
    const baseIndent = getLineIndentLevel(lines[startLineIndex]);
    if (baseIndent === 0) return null;
    let foldStart = startLineIndex + 1;
    while (foldStart < lines.length) {
        const indent = getLineIndentLevel(lines[foldStart]);
        if (indent > baseIndent && lines[foldStart].trim() !== '') break;
        foldStart++;
    }
    if (foldStart >= lines.length) return null;
    let endLineIndex = foldStart;
    while (endLineIndex < lines.length) {
        const currentIndent = getLineIndentLevel(lines[endLineIndex]);
        if (currentIndent <= baseIndent && lines[endLineIndex].trim() !== '') break;
        endLineIndex++;
    }
    if (endLineIndex > foldStart) return { startLine: startLineIndex, endLine: endLineIndex - 1 };
    return null;
}

export function updateFoldedRangesInStorage() {
    saveToLocalStorage(STORAGE_KEYS.FOLDED_RANGES, EditorState.foldedRanges);
}

export function setupLineNumberClickHandler() {
    DOM.lineNumbers.addEventListener('click', function(event) {
        if (EditorState.largeFileActive) return;
        const target = event.target;
        if (target.classList.contains('fold-marker')) {
            event.stopPropagation();
            const lineIndex = parseInt(target.dataset.line);
            if (isNaN(lineIndex)) return;
            toggleFold(lineIndex);
        }
    });
}

export function toggleFold(lineIndex) {
    if (EditorState.largeFileActive) return;
    const lines = DOM.codeEditor.value.split('\n');
    const range = findFoldRange(lines, lineIndex);
    if (!range) return;
    const existingIndex = EditorState.foldedRanges.findIndex(function(r) {
        return r.startLine === range.startLine;
    });
    if (existingIndex >= 0) {
        EditorState.foldedRanges.splice(existingIndex, 1);
    } else {
        range.foldedCount = range.endLine - range.startLine;
        EditorState.foldedRanges.push(range);
    }
    updateFoldedRangesInStorage();
    scheduleHighlightUpdate();
}

export function getFoldedLinesSet() {
    const foldedLines = new Set();
    for (const range of EditorState.foldedRanges) {
        for (let i = range.startLine + 1; i <= range.endLine; i++) {
            foldedLines.add(i);
        }
    }
    return foldedLines;
}

export function isLineHidden(lineIndex) {
    for (const range of EditorState.foldedRanges) {
        if (lineIndex > range.startLine && lineIndex <= range.endLine) return true;
    }
    return false;
}