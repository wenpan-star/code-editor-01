/**
 * ============================================================================
 * line-numbers.js — 行号渲染 + 光标位置 + 滚动定位
 * ============================================================================
 *
 * 本模块职责：
 *   1. renderLineNumbersWithFolds：依据折叠状态动态生成行号 HTML
 *   2. updateLineNumbers：行号 / 字符数 / 大文件提示
 *   3. updateCursorPosition：光标位置 / 选区信息
 *   4. syncLineNumbersScroll：同步行号与编辑器滚动
 *   5. scrollToCursor：读取实际 CSS 行高而非硬编码
 *
 * v8.1.1 修复：
 *   状态栏文案统一（去掉冒号），与 index.html 中的初始文案对齐。
 *   原 index.html 初始文案为"行 0 · 字符 0 · 行 1 列 1"（无冒号），
 *   而本模块文案为"行: 0 · 字符: 0 · 行:1 列:1"（有冒号），导致用户
 *   输入第一个字符后状态栏会从"行 0"瞬间变成"行: 1"，视觉上突兀。
 *   本版统一为无冒号格式：
 *     - '字符: 0'              → '字符 0'
 *     - '行: 0'                → '行 0'
 *     - '行: 大文件'            → '行 大文件'
 *     - '选中: 5 字符 / 1 行'   → '选中 5 字符 / 1 行'
 *     - '行:1 列:1'            → '行 1 列 1'
 *
 * 保留 v8.0.1 修复（问题 8）：
 *   scrollToCursor 末尾通过 highlight.js 导出的 syncShadowScroll() 同步高亮层，
 *   避免直接访问 Shadow DOM 内部元素。
 *
 * 依赖：
 *   - state.js / dom.js
 *   - folding.js（findFoldRange / getFoldedLinesSet）
 *   - highlight.js（syncShadowScroll）
 * ============================================================================
 */

import { EditorState } from './state.js';
import { DOM } from './dom.js';
import { findFoldRange, getFoldedLinesSet } from './folding.js';
import { syncShadowScroll } from './highlight.js';

/**
 * 渲染带折叠标记的行号列。
 */
export function renderLineNumbersWithFolds() {
    if (EditorState.largeFileActive) return;
    const code = DOM.codeEditor.value;
    const lines = code.split('\n');
    let html = '';
    const foldedLines = getFoldedLinesSet();
    let displayLineNumber = 0;

    for (let i = 0; i < lines.length; i++) {
        if (foldedLines.has(i)) continue;
        displayLineNumber++;
        html += '<div class="line-container" role="listitem">';

        if (i < lines.length - 1) {
            const range = findFoldRange(lines, i);
            if (range) {
                const isFolded = EditorState.foldedRanges.some(function(r) {
                    return r.startLine === i;
                });
                const countText = isFolded && range.endLine - range.startLine > 0
                    ? ' (' + (range.endLine - range.startLine) + ')'
                    : '';
                html += `<span class="fold-marker ${isFolded ? 'folded' : 'unfolded'}" data-line="${i}" title="折叠/展开">${isFolded ? '▶' + countText : '▼'}</span>`;
            } else {
                html += '<span class="fold-marker" style="visibility:hidden;opacity:0;"></span>';
            }
        } else {
            html += '<span class="fold-marker" style="visibility:hidden;opacity:0;"></span>';
        }
        html += `<span>${displayLineNumber}</span></div>\n`;
    }
    DOM.lineNumbers.innerHTML = html;
}

/**
 * 更新行号 / 字符数 / 大文件提示。
 *
 * v8.1.1：文案去冒号，与 index.html 初始值对齐。
 */
export function updateLineNumbers() {
    const codeText = DOM.codeEditor.value;
    DOM.charCountEl.textContent = '字符 ' + codeText.length;

    if (EditorState.largeFileActive) {
        DOM.lineCountEl.textContent = '行 大文件';
        DOM.lineNumbers.innerHTML = '<div style="padding: 8px; text-align: center; color: var(--text-secondary); font-size: 12px;">大文件</div>';
        return;
    }

    const lineCount = codeText.split('\n').length;
    DOM.lineCountEl.textContent = '行 ' + lineCount;
    renderLineNumbersWithFolds();
}

/**
 * 更新光标位置 / 选区信息。
 *
 * v8.1.1：文案去冒号，与 index.html 初始值对齐。
 */
export function updateCursorPosition() {
    if (EditorState.largeFileActive) {
        DOM.cursorPosEl.textContent = '行 -- 列 --';
        return;
    }
    const selectionStart = DOM.codeEditor.selectionStart;
    const selectionEnd = DOM.codeEditor.selectionEnd;
    const codeText = DOM.codeEditor.value;

    if (selectionStart !== selectionEnd) {
        const selectedText = codeText.substring(selectionStart, selectionEnd);
        const selectedLineCount = selectedText.split('\n').length;
        DOM.cursorPosEl.textContent = '选中 ' + selectedText.length + ' 字符 / ' + selectedLineCount + ' 行';
    } else {
        const textBeforeCursor = codeText.substring(0, selectionStart);
        const linesBeforeCursor = textBeforeCursor.split('\n');
        const currentRow = linesBeforeCursor.length;
        const currentColumn = linesBeforeCursor[linesBeforeCursor.length - 1].length + 1;
        DOM.cursorPosEl.textContent = '行 ' + currentRow + ' 列 ' + currentColumn;
    }
}

/**
 * 同步行号与编辑器滚动。
 */
export function syncLineNumbersScroll() {
    DOM.lineNumbers.scrollTop = DOM.codeEditor.scrollTop;
}

/**
 * 读取实际 CSS 行高（--editor-line-height 对应的 computed lineHeight）。
 * 末尾通过 syncShadowScroll 同步高亮层，避免直接访问 Shadow DOM 内部。
 */
export function scrollToCursor() {
    if (EditorState.largeFileActive) return;
    const editor = DOM.codeEditor;
    const cursorPosition = editor.selectionStart;
    const textBeforeCursor = editor.value.substring(0, cursorPosition);
    const currentLineIndex = textBeforeCursor.split('\n').length - 1;

    const computedStyle = getComputedStyle(editor);
    const lineHeightPx = parseFloat(computedStyle.lineHeight) || EditorState.currentFontSize * 1.7;
    const paddingTop = parseFloat(computedStyle.paddingTop) || 12;

    const targetScrollTop = currentLineIndex * lineHeightPx + paddingTop - editor.clientHeight / 3;
    editor.scrollTop = Math.max(0, targetScrollTop);

    DOM.lineNumbers.scrollTop = editor.scrollTop;
    syncShadowScroll();
}