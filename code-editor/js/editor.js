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
 *   - Ctrl+↑ 跳到文档第一行（v8.5.2）
 *   - Ctrl+Shift+↑ 扩展选区到文档开头（v8.5.3）
 *   - 粘贴（含 1.5MB / 2MB 双重限制）
 *   - 光标位置更新
 *   - 滚动同步（行号列 + Shadow DOM 高亮层）
 *
 * 【v8.5.3 变更】
 *   1. Ctrl+↑ 分支增加 Shift 修饰键判断：
 *      · Ctrl + ↑           → 光标移至文档第一行行首
 *      · Ctrl + Shift + ↑   → 从当前位置扩展选区到文档开头
 *      锚点选取：无选区时取光标位置，有选区时取远端端点（Math.max）。
 *   2. 自动配对分支增加 TXT 短路：
 *      TXT 为纯文本语义，用户按 ( [ { " ' ` 时不自动补全闭合符号。
 *      直接 return，让浏览器默认行为插入用户按键字符。
 *
 * 【v8.5.1 保留修复】
 *   1. TXT 模式智能回车不再自动添加缩进。
 *   2. TXT 模式 Ctrl+/ 无操作。
 *
 * 【v8.0.x 及更早保留】
 *   - setupEditorEvents 补回 #codeEditor 上的 scroll 监听器（syncScroll）
 *   - 自动配对（选中区替换 / 插入括号）与 Tab 单光标缩进三处 setRangeText
 *     调用用 internalEditorUpdate 包住，抑制 handleEditorInput 重复触发
 *   - 六处 setEditorContent 使用 finalCursorStart / finalCursorEnd 参数
 *   - handleEditorInput 检测 internalEditorUpdate 标志直接返回
 *   - 移除本地 debouncedUpdateMatchCount，统一到 search.js
 *
 * 依赖：
 *   - state.js / dom.js / toast.js / util.js
 *   - history.js（historyManager 实例）
 *   - editor-api.js（setEditorContent / fullUpdate / triggerAutoSave /
 *     debouncedUpdate / toggleClearButton）
 *   - line-numbers.js（updateCursorPosition）
 *   - highlight.js（syncScroll）
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

    // ---- Ctrl + ↑ / Ctrl + Shift + ↑ ----
    // · Ctrl + ↑           → 光标移至文档第一行行首
    // · Ctrl + Shift + ↑   → 从当前位置扩展选区到文档开头
    // v8.5.2：新增 Ctrl + ↑ 分支，覆盖浏览器默认行为（跳到段落 / 滚动一行）。
    // v8.5.3：增加 Shift 修饰键判断，扩展选区到文档开头。
    // 使用 event.key === 'ArrowUp' 判断：keyCode 已废弃，key 为现代标准。
    if ((event.ctrlKey || event.metaKey) && pressedKey === 'ArrowUp') {
        event.preventDefault();
        if (event.shiftKey) {
            // 扩展选区到文档开头：锚点取当前位置（无选区）或选区远端（有选区）。
            // 使用 Math.max 取远端端点，等价于"不改变远端锚点，把活动端拉到 0"。
            const anchorPosition = (selectionStart === selectionEnd)
                ? selectionStart
                : Math.max(selectionStart, selectionEnd);
            if (anchorPosition > 0) {
                this.setSelectionRange(0, anchorPosition);
            }
        } else {
            // 跳到文档开头：光标移至 0 处。
            this.selectionStart = this.selectionEnd = 0;
        }
        this.scrollTop = 0;
        // 同步行号列与 Shadow DOM 高亮层滚动（syncScroll 由 highlight.js 导出）。
        syncScroll();
        updateCursorPosition();
        return;
    }

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
        // v8.5.3：TXT 为纯文本语义，禁用自动配对。
        // 直接 return，让浏览器默认行为插入用户按下的字符。
        if (EditorState.currentLanguage === 'txt') return;

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

        // v8.5.1：TXT 为纯文本语义，不根据 { ( [ : 结尾自动追加缩进。
        // 行首已有的缩进（currentIndent）仍被保留 —— 它反映用户手动输入的格式。
        if (
            EditorState.currentLanguage !== 'txt' &&
            !isInsideStringOrComment(editorValue, selectionStart)
        ) {
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
    // v8.5.1：TXT 为纯文本语义，无注释概念，Ctrl+/ 直接返回。
    // event.preventDefault() 已调用，浏览器不会插入 '/' 字符。
    if (EditorState.currentLanguage === 'txt') return;

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
    // 滚动同步监听器：
    // syncScroll 由 highlight.js 导出，同步行号列（lineNumbers.scrollTop）
    // 与 Shadow DOM 高亮层（highlightPreElement.scrollTop / scrollLeft）。
    // 使用 { passive: true } 保证滚动事件不阻塞主线程。
    DOM.codeEditor.addEventListener('scroll', syncScroll, { passive: true });
}