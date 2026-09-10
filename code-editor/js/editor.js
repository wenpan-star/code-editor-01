/**
 * ============================================================================
 * editor.js — 编辑器核心（键盘输入、光标、缩进、括号匹配、粘贴、滚动）
 * ============================================================================
 *
 * 本模块从 v7.7.0 主脚本提取编辑器键盘事件处理，保持全部行为：
 *   - 自动配对（括号 / 引号）
 *   - 智能回车（自动缩进）
 *   - 智能退格（删除整级缩进）
 *   - Tab / Shift+Tab 缩进与反缩进
 *   - Ctrl+/ 注释切换
 *   - 粘贴（含 1.5MB / 2MB 双重限制）
 *   - 光标位置更新
 *   - 滚动同步（行号列 + Shadow DOM 高亮层）
 *
 * 本版修复：
 *   ★ setupEditorEvents 补回 #codeEditor 元素上丢失的 scroll 事件监听器。
 *     该监听器在 v8.0.0 的模块化迁移中被遗漏，导致：
 *       (1) 鼠标滚轮 / 拖动滚动条时行号列和 Shadow DOM 高亮层无法同步滚动；
 *       (2) 在长文件中滚动后输入字符，行号列会被 updateLineNumbers 重置
 *           回顶部，与编辑器内容错位。
 *     修复方式：从 highlight.js 导入 syncScroll（同时同步行号列与 Shadow
 *     DOM 高亮层），在 setupEditorEvents 中补回监听。使用 { passive: true }
 *     保证滚动事件不阻塞主线程，与 v7.7.0 一致。
 *
 *     该修复不引入循环依赖：
 *       - editor.js 已导入 line-numbers.js（用于 updateCursorPosition）
 *       - line-numbers.js 已导入 highlight.js（用于 syncShadowScroll）
 *       - highlight.js 不导入 editor.js
 *
 * 保留历史修复：
 *   - 自动配对（选中区替换 / 插入括号）与 Tab 单光标缩进三处 setRangeText
 *     调用，用 EditorState.internalEditorUpdate 包住，抑制 handleEditorInput
 *     重复触发，并显式补上 toggleClearButton()。
 *   - 六处 setEditorContent 使用 finalCursorStart / finalCursorEnd 参数，
 *     去掉外部显式 fullUpdate。
 *   - handleEditorInput 检测 EditorState.internalEditorUpdate 标志，
 *     直接返回内部驱动的 'input' 事件。
 *   - 移除本地 debouncedUpdateMatchCount，防抖统一到 search.js 的
 *     updateMatchCountDebounced。
 *
 * 依赖：
 *   - state.js / dom.js / toast.js / util.js
 *   - history.js（historyManager 实例）
 *   - editor-api.js（setEditorContent / fullUpdate / triggerAutoSave /
 *     debouncedUpdate / toggleClearButton）
 *   - line-numbers.js（updateCursorPosition）
 *   - highlight.js（syncScroll）— 本版新增，无循环风险
 * ============================================================================
 */

import { EditorState } from './state.js';
import { DOM } from './dom.js';
import { historyManager } from './history.js';
import { setEditorContent, fullUpdate, triggerAutoSave, debouncedUpdate, toggleClearButton } from './editor-api.js';
import { updateCursorPosition } from './line-numbers.js';
import { syncScroll } from './highlight.js';
import { showToast } from './toast.js';
import { escapeRegExp } from './util.js';

// ==================== 工具函数 ====================

export function getIndentString() {
    if (EditorState.indentCharacter === '\t') return '\t';
    return ' '.repeat(EditorState.indentSize);
}

export function isInsideStringOrComment(code, position) {
    if (EditorState.largeFileActive) return false;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inBacktick = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let i = 0; i < position; i++) {
        const character = code[i];
        if (inLineComment) {
            if (character === '\n') inLineComment = false;
            continue;
        }
        if (inBlockComment) {
            if (character === '*' && code[i + 1] === '/') {
                inBlockComment = false;
                i++;
            }
            continue;
        }
        if (inSingleQuote && character === '\\') { i++; continue; }
        if (inDoubleQuote && character === '\\') { i++; continue; }
        if (inBacktick && character === '\\') { i++; continue; }

        if (character === "'" && !inDoubleQuote && !inBacktick) inSingleQuote = !inSingleQuote;
        else if (character === '"' && !inSingleQuote && !inBacktick) inDoubleQuote = !inDoubleQuote;
        else if (character === '`' && !inSingleQuote && !inDoubleQuote) inBacktick = !inBacktick;
        else if (!inSingleQuote && !inDoubleQuote && !inBacktick && character === '/' && code[i + 1] === '/') {
            inLineComment = true;
            i++;
        } else if (!inSingleQuote && !inDoubleQuote && !inBacktick && character === '/' && code[i + 1] === '*') {
            inBlockComment = true;
            i++;
        }
    }
    return inSingleQuote || inDoubleQuote || inBacktick || inLineComment || inBlockComment;
}

// ==================== 主键盘处理器 ====================

function handleEditorKeyDown(event) {
    if (EditorState.largeFileActive) return;
    const openingPairs = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };
    const closingPairs = { ')': '(', ']': '[', '}': '{' };
    const pressedKey = event.key;
    const selectionStart = this.selectionStart;
    const selectionEnd = this.selectionEnd;
    const editorValue = this.value;

    // ---- 跳过已存在的闭合符号 ----
    if (pressedKey in closingPairs && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
        if (selectionStart === selectionEnd && editorValue[selectionStart] === pressedKey) {
            event.preventDefault();
            this.selectionStart = this.selectionEnd = selectionStart + 1;
            updateCursorPosition();
            return;
        }
    }

    // ---- 自动配对 ----
    if (pressedKey in openingPairs && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
        // 选中区被包裹分支
        if (selectionStart !== selectionEnd) {
            event.preventDefault();
            const selectedText = editorValue.substring(selectionStart, selectionEnd);
            const replacement = pressedKey + selectedText + openingPairs[pressedKey];
            if (historyManager) historyManager.pushState(DOM.codeEditor);
            // 抑制 setRangeText 派发的 'input' 事件被 handleEditorInput 重复处理，
            // 避免同一操作触发两次 fullUpdate / triggerAutoSave。
            EditorState.internalEditorUpdate = true;
            try {
                this.setRangeText(replacement, selectionStart, selectionEnd, 'select');
            } finally {
                EditorState.internalEditorUpdate = false;
            }
            if (historyManager) historyManager.pushState(DOM.codeEditor);
            fullUpdate();
            triggerAutoSave();
            // 因抑制了 handleEditorInput，需显式补齐其原本调用的 toggleClearButton。
            toggleClearButton();
            return;
        }
        // 未选中内容，插入成对括号分支
        if (isInsideStringOrComment(editorValue, selectionStart)) return;
        const nextCharacter = editorValue[selectionStart];
        if (nextCharacter === '' || /[\s}\]\)]/.test(nextCharacter)) {
            event.preventDefault();
            if (historyManager) historyManager.pushState(DOM.codeEditor);
            // 同上，抑制 handleEditorInput 重复触发。
            EditorState.internalEditorUpdate = true;
            try {
                this.setRangeText(pressedKey + openingPairs[pressedKey], selectionStart, selectionStart, 'start');
            } finally {
                EditorState.internalEditorUpdate = false;
            }
            this.selectionStart = this.selectionEnd = selectionStart + 1;
            if (historyManager) historyManager.pushState(DOM.codeEditor);
            fullUpdate();
            triggerAutoSave();
            toggleClearButton();
        }
        return;
    }

    // ---- Enter 智能缩进 ----
    if (pressedKey === 'Enter') {
        event.preventDefault();
        const textBeforeCursor = editorValue.substring(0, selectionStart);
        const textAfterCursor = editorValue.substring(selectionEnd);
        const currentLineStart = editorValue.lastIndexOf('\n', selectionStart - 1) + 1;
        const currentLine = editorValue.substring(currentLineStart, selectionStart);
        const currentIndent = currentLine.match(/^[ \t]*/)[0];
        const trimmedLine = currentLine.trimEnd();
        let extraIndent = '';

        if (!isInsideStringOrComment(editorValue, selectionStart)) {
            if (
                trimmedLine.endsWith('{') ||
                trimmedLine.endsWith('(') ||
                trimmedLine.endsWith('[') ||
                (EditorState.currentLanguage === 'python' && trimmedLine.endsWith(':'))
            ) {
                extraIndent = getIndentString();
            }
        }

        const insertedText = '\n' + currentIndent + extraIndent;
        const newValue = textBeforeCursor + insertedText + textAfterCursor;
        const newCursorPos = selectionStart + insertedText.length;
        setEditorContent(newValue, true, false, newCursorPos, newCursorPos);
        return;
    }

    // ---- Backspace 智能删除整级缩进 ----
    if (pressedKey === 'Backspace') {
        const lineStart = editorValue.lastIndexOf('\n', selectionStart - 1) + 1;
        const lineContent = editorValue.substring(lineStart, selectionStart);
        if (selectionStart === selectionEnd && lineContent.trim() === '' && lineContent.length > 0) {
            const currentLineIndent = lineContent.match(/^[ \t]*/)[0];
            const removeLength = (EditorState.indentCharacter === '\t') ? 1 : EditorState.indentSize;
            if (currentLineIndent.length >= removeLength && (selectionStart - lineStart) <= currentLineIndent.length) {
                event.preventDefault();
                const newIndent = currentLineIndent.substring(removeLength);
                const newValue = editorValue.substring(0, lineStart) + newIndent + editorValue.substring(selectionStart);
                const newCursorPos = lineStart + newIndent.length;
                setEditorContent(newValue, true, false, newCursorPos, newCursorPos);
                return;
            }
        }
    }

    // ---- Tab 缩进 ----
    if (pressedKey === 'Tab' && !event.shiftKey) {
        event.preventDefault();
        const indentStr = getIndentString();

        if (selectionStart !== selectionEnd) {
            // 选中区缩进分支：改用 setEditorContent 的 finalCursorStart / finalCursorEnd 参数。
            const textBeforeSelection = editorValue.substring(0, selectionStart);
            const selectedText = editorValue.substring(selectionStart, selectionEnd);
            const textAfterSelection = editorValue.substring(selectionEnd);
            const selectedLines = selectedText.split('\n');
            const indentedLines = selectedLines.map(function(line) {
                return indentStr + line;
            }).join('\n');
            const newValue = textBeforeSelection + indentedLines + textAfterSelection;
            const newCursorStart = selectionStart;
            const newCursorEnd = selectionStart + indentedLines.length;
            setEditorContent(newValue, true, false, newCursorStart, newCursorEnd);
        } else {
            // 单光标缩进分支：直接 setRangeText + pushState。
            // 抑制 handleEditorInput 重复触发，显式补 toggleClearButton。
            if (historyManager) historyManager.pushState(DOM.codeEditor);
            EditorState.internalEditorUpdate = true;
            try {
                this.setRangeText(indentStr, selectionStart, selectionStart, 'end');
            } finally {
                EditorState.internalEditorUpdate = false;
            }
            if (historyManager) historyManager.pushState(DOM.codeEditor);
            fullUpdate();
            triggerAutoSave();
            toggleClearButton();
        }
        return;
    }

    // ---- Shift + Tab 反缩进 ----
    if (pressedKey === 'Tab' && event.shiftKey) {
        event.preventDefault();
        if (selectionStart !== selectionEnd) {
            const textBeforeSelection = editorValue.substring(0, selectionStart);
            const selectedText = editorValue.substring(selectionStart, selectionEnd);
            const textAfterSelection = editorValue.substring(selectionEnd);
            const selectedLines = selectedText.split('\n');
            const removePattern = (EditorState.indentCharacter === '\t') ? '\t' : ' {1,' + EditorState.indentSize + '}';
            const dedentedLines = selectedLines.map(function(line) {
                return line.replace(new RegExp('^' + removePattern), '');
            });
            const newValue = textBeforeSelection + dedentedLines.join('\n') + textAfterSelection;
            const newCursorStart = selectionStart;
            const newCursorEnd = selectionStart + dedentedLines.join('\n').length;
            setEditorContent(newValue, true, false, newCursorStart, newCursorEnd);
        } else {
            const lineStart = editorValue.lastIndexOf('\n', selectionStart - 1) + 1;
            const lineContent = editorValue.substring(lineStart, selectionStart);
            const removePattern = (EditorState.indentCharacter === '\t') ? '^\t' : '^ {1,' + EditorState.indentSize + '}';
            const indentMatch = lineContent.match(new RegExp(removePattern));
            if (indentMatch && selectionStart - lineStart <= indentMatch[0].length) {
                const newValue = editorValue.substring(0, lineStart) + lineContent.substring(indentMatch[0].length) + editorValue.substring(selectionStart);
                const newCursorPos = selectionStart - indentMatch[0].length;
                setEditorContent(newValue, true, false, newCursorPos, newCursorPos);
            }
            // 若 indentMatch 为空或不满足条件，无操作。
        }
        return;
    }
}

// ==================== 注释切换 ====================

function handleCommentToggle(event) {
    if (!(event.ctrlKey || event.metaKey) || event.key !== '/') return;
    event.preventDefault();
    if (EditorState.largeFileActive) return;

    const selectionStart = this.selectionStart;
    const selectionEnd = this.selectionEnd;
    const editorValue = this.value;
    const textBeforeSelection = editorValue.substring(0, selectionStart);
    const selectedText = editorValue.substring(selectionStart, selectionEnd);
    const textAfterSelection = editorValue.substring(selectionEnd);

    let commentCharacter = '//';
    if (EditorState.currentLanguage === 'python') commentCharacter = '#';
    else if (EditorState.currentLanguage === 'html') commentCharacter = '<!-- -->';
    else if (EditorState.currentLanguage === 'css') commentCharacter = '/* */';
    else if (EditorState.currentLanguage === 'java') commentCharacter = '//';

    let newSelection;
    if (EditorState.currentLanguage === 'html') {
        const isCommented = selectedText.startsWith('<!--') && selectedText.endsWith('-->');
        newSelection = isCommented ? selectedText.slice(5, -4) : '<!--' + selectedText + '-->';
    } else if (EditorState.currentLanguage === 'css') {
        const isCommented = selectedText.startsWith('/*') && selectedText.endsWith('*/');
        newSelection = isCommented ? selectedText.slice(2, -2) : '/*' + selectedText + '*/';
    } else {
        const selectedLines = selectedText.split('\n');
        const allLinesCommented = selectedLines.every(function(line) {
            return line.trimStart().startsWith(commentCharacter);
        });
        if (allLinesCommented) {
            newSelection = selectedLines.map(function(line) {
                return line.replace(new RegExp('^\\s*' + escapeRegExp(commentCharacter) + '\\s?'), '');
            }).join('\n');
        } else {
            newSelection = selectedLines.map(function(line) {
                return commentCharacter + ' ' + line;
            }).join('\n');
        }
    }

    const newValue = textBeforeSelection + newSelection + textAfterSelection;
    const newCursorStart = selectionStart;
    const newCursorEnd = selectionStart + newSelection.length;
    setEditorContent(newValue, true, false, newCursorStart, newCursorEnd);
}

// ==================== 粘贴处理 ====================

function handleEditorPaste(event) {
    event.preventDefault();
    const clipboardData = event.clipboardData || window.clipboardData;
    const pastedText = clipboardData.getData('text/plain');
    if (pastedText.length > EditorState.maxPasteSize) {
        showToast('❌ 粘贴内容超过 1.5MB，已阻止粘贴以避免卡顿', true);
        return;
    }
    const start = this.selectionStart;
    const end = this.selectionEnd;
    const newValue = this.value.substring(0, start) + pastedText + this.value.substring(end);
    if (newValue.length > EditorState.absoluteFileSizeLimit) {
        showToast('❌ 粘贴后内容超过 2MB，已阻止粘贴', true);
        return;
    }
    const newCursorPos = start + pastedText.length;
    setEditorContent(newValue, true, false, newCursorPos, newCursorPos);
}

// ==================== 输入事件 ====================

function handleEditorInput() {
    // 内部驱动的更新（setEditorContent / HistoryManager 主动派发 'input'、
    // 以及自动配对 / Tab 单光标缩进）会设置该标志，直接返回，
    // 避免与显式 fullUpdate 叠加造成双重刷新。
    if (EditorState.internalEditorUpdate) return;

    debouncedUpdate();
    toggleClearButton();
    triggerAutoSave();
    if (DOM.replaceModalOverlay.classList.contains('open')) {
        EditorState.lastSearchMatches = [];
        EditorState.searchMatchIndex = -1;
        // 防抖版 updateMatchCount 已由 fullUpdate 注入的回调触发，
        // 此处不再重复调用，避免双重 Worker 请求。
    }
}

// ==================== 绑定入口 ====================

export function setupEditorEvents() {
    DOM.codeEditor.addEventListener('keydown', handleEditorKeyDown);
    DOM.codeEditor.addEventListener('keydown', handleCommentToggle);
    DOM.codeEditor.addEventListener('click', updateCursorPosition);
    DOM.codeEditor.addEventListener('keyup', updateCursorPosition);
    DOM.codeEditor.addEventListener('input', handleEditorInput);
    DOM.codeEditor.addEventListener('paste', handleEditorPaste);
    // 本版修复：补回滚动同步监听器。
    // syncScroll 由 highlight.js 导出，同步行号列（lineNumbers.scrollTop）
    // 与 Shadow DOM 高亮层（highlightPreElement.scrollTop / scrollLeft）。
    // 使用 { passive: true } 保证滚动事件不阻塞主线程。
    DOM.codeEditor.addEventListener('scroll', syncScroll, { passive: true });
}