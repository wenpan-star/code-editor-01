/**
 * ============================================================================
 * highlight.js — 语法高亮 + Shadow DOM 高亮层
 * ============================================================================
 * 版本：v8.0.2（深度审核修复版）
 * 更新日期：2026-09-11
 *
 * 重构说明：
 *   1. syntaxHighlightMainThread：JS / HTML / CSS / Python / Java 正则高亮
 *   2. setupShadowHighlightLayer：创建 Shadow DOM 容器
 *   3. updateShadowHighlight：更新高亮层 HTML
 *   4. syncShadowScroll / syncShadowCSSVariables：滚动与 CSS 变量同步
 *   5. buildHighlightHTML：合并语法 + 搜索 + 括号匹配 + 当前行高亮
 *   6. scheduleHighlightUpdate：requestAnimationFrame 节流调度
 *   7. setHighlightEnabled / updateHighlightStatusIndicator：高亮开关控制
 *   8. syncScroll：同步行号、高亮层滚动
 *
 * v8.0.2 修复（问题 2）：
 *   buildHighlightHTML 中的行高计算由
 *     EditorState.currentFontSize * parseFloat(getComputedStyle(...).lineHeight)
 *   修正为
 *     parseFloat(getComputedStyle(...).lineHeight) || EditorState.currentFontSize * 1.7
 *
 *   原写法会先把 lineHeight（例如 23.8）乘以 fontSize（例如 14），得到 333.2，
 *   导致当前行高亮与括号 / 搜索高亮的垂直位置严重偏移（偏移量随字号增大而放大）。
 *   修正后与 line-numbers.js 的 scrollToCursor 采用同一套读取逻辑，行为一致。
 *
 *   同时将 getComputedStyle 调用提取到行循环外部，避免每行重复读取计算样式。
 * ============================================================================
 */

import { EditorState } from './state.js';
import { DOM } from './dom.js';
import { escapeHtml, saveToLocalStorage } from './util.js';
import { STORAGE_KEYS } from './config.js';

// ==================== 语法高亮（主线程） ====================

export function syntaxHighlightMainThread(code, language) {
    if (!code) return '';
    let escaped = escapeHtml(code);

    if (language === 'js' || language === 'javascript') {
        escaped = escaped.replace(/\/\*[\s\S]*?\*\//g, function(m) {
            return '<span class="cmt">' + m + '</span>';
        });
        escaped = escaped.replace(/(\/\/.*)/g, '<span class="cmt">$1</span>');
        escaped = escaped.replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g, '<span class="str">$1</span>');
        escaped = escaped.replace(/\b(function|const|let|var|return|if|else|for|while|do|switch|case|break|continue|new|class|extends|import|export|from|async|await|try|catch|throw|typeof|instanceof|this|super|default|yield|of|in|static|get|set)\b/g, '<span class="kw">$1</span>');
        escaped = escaped.replace(/\b(\d+\.?\d*)\b/g, '<span class="num">$1</span>');
        escaped = escaped.replace(/\b([a-zA-Z_$][\w$]*)\s*\(/g, '<span class="fn">$1</span>(');
        escaped = escaped.replace(/\.([a-zA-Z_$][\w$]*)/g, '.<span class="prop">$1</span>');
    } else if (language === 'html') {
        escaped = escaped.replace(/&lt;!--[\s\S]*?--&gt;/g, '<span class="cmt">$&</span>');
        escaped = escaped.replace(/(&lt;\/?)([\w-]+)([\s\S]*?)(\/?&gt;)/g, function(m, openTag, tagName, attributes, closeTag) {
            const processedAttributes = attributes.replace(/([\w-]+)=(".*?"|'.*?')/g, '<span class="attr">$1</span>=<span class="str">$2</span>');
            return openTag + '<span class="tag">' + tagName + '</span>' + processedAttributes + closeTag;
        });
    } else if (language === 'css') {
        escaped = escaped.replace(/\/\*[\s\S]*?\*\//g, '<span class="cmt">$&</span>');
        escaped = escaped.replace(/([\w-]+)\s*:/g, '<span class="attr">$1</span>:');
        escaped = escaped.replace(/:\s*([^;{}]+)/g, function(m, propertyValue) {
            return ': ' + propertyValue.replace(/(#[0-9a-fA-F]{3,8}|\d+\.?\d*(\w+|%)?)/g, '<span class="num">$1</span>');
        });
        escaped = escaped.replace(/([.#][\w-]+)/g, '<span class="tag">$1</span>');
    } else if (language === 'python') {
        escaped = escaped.replace(/("""[\s\S]*?"""|'''[\s\S]*?''')/g, '<span class="str">$&</span>');
        escaped = escaped.replace(/(#.*)/g, '<span class="cmt">$1</span>');
        escaped = escaped.replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, '<span class="str">$1</span>');
        escaped = escaped.replace(/\b(def|class|import|from|return|if|elif|else|for|while|try|except|finally|with|as|pass|break|continue|yield|lambda|and|or|not|in|is|None|True|False|self|print|range|len|int|str|float|list|dict|set|tuple)\b/g, '<span class="kw">$1</span>');
        escaped = escaped.replace(/\b(\d+\.?\d*)\b/g, '<span class="num">$1</span>');
        escaped = escaped.replace(/def\s+([a-zA-Z_]\w*)/g, 'def <span class="fn">$1</span>');
        escaped = escaped.replace(/(@[\w.]+)/g, '<span class="tag">$1</span>');
    } else if (language === 'java') {
        escaped = escaped.replace(/\/\*\*[\s\S]*?\*\//g, function(m) {
            return '<span class="cmt">' + m + '</span>';
        });
        escaped = escaped.replace(/\/\*[\s\S]*?\*\//g, function(m) {
            return '<span class="cmt">' + m + '</span>';
        });
        escaped = escaped.replace(/(\/\/.*)/g, '<span class="cmt">$1</span>');
        escaped = escaped.replace(/("(?:[^"\\]|\\.)*")/g, '<span class="str">$1</span>');
        escaped = escaped.replace(/('(?:[^'\\]|\\.)')/g, '<span class="str">$1</span>');
        escaped = escaped.replace(/(@[\w.]+)/g, '<span class="annot">$1</span>');
        escaped = escaped.replace(/\b(public|private|protected|static|final|class|interface|extends|implements|new|return|if|else|for|while|do|switch|case|break|continue|try|catch|finally|throw|throws|import|package|void|int|long|double|float|boolean|char|byte|short|this|super|null|true|false|abstract|synchronized|volatile|transient|native|strictfp|instanceof|enum|assert|default|var|record|sealed|permits|yield)\b/g, '<span class="kw">$1</span>');
        escaped = escaped.replace(/\b(\d+\.?\d*(?:[lLfFdD])?|0x[0-9a-fA-F]+)\b/g, '<span class="num">$1</span>');
        escaped = escaped.replace(/\b([A-Z][a-zA-Z0-9_]*)\b/g, '<span class="type">$1</span>');
        escaped = escaped.replace(/\b([a-z_][\w$]*)\s*\(/g, '<span class="fn">$1</span>(');
        escaped = escaped.replace(/\.([a-z_][\w$]*)/g, '.<span class="prop">$1</span>');
    }
    return escaped;
}

// ==================== Shadow DOM 高亮层 ====================

export function syncShadowCSSVariables() {
    if (!EditorState.highlightShadowRoot) return;
    const host = EditorState.highlightShadowRoot.host;
    const rootStyle = getComputedStyle(document.documentElement);
    const vars = [
        '--hl-kw', '--hl-str', '--hl-num', '--hl-cmt', '--hl-fn',
        '--hl-tag', '--hl-attr', '--hl-prop', '--hl-op', '--hl-punc',
        '--hl-annot', '--hl-type', '--hl-search-bg', '--hl-bracket-bg',
        '--text', '--editor-font-size', '--editor-line-height', '--editor-font',
        '--line-highlight-bg'
    ];
    vars.forEach(function(v) {
        host.style.setProperty(v, rootStyle.getPropertyValue(v).trim());
    });
}

export function setupShadowHighlightLayer() {
    const shadowRoot = DOM.highlightHost.attachShadow({ mode: 'open' });
    EditorState.highlightShadowRoot = shadowRoot;
    const style = document.createElement('style');
    style.textContent = `
        :host { display: block; width: 100%; height: 100%; position: absolute; top: 0; left: 0; overflow: hidden; pointer-events: none; }
        pre { position: absolute; top: 0; left: 0; right: 0; bottom: 0; margin: 0; padding: 12px 18px; font-family: var(--editor-font, monospace); font-size: var(--editor-font-size, 14px); line-height: var(--editor-line-height, 1.7); tab-size: 4; white-space: pre; overflow-wrap: normal; word-wrap: normal; overflow: hidden; color: var(--text, #cdd6f4); background: transparent; border: none; outline: none; letter-spacing: 0; box-sizing: border-box; }
        pre.wrap-enabled { white-space: pre-wrap; word-break: break-all; }
        .kw { color: var(--hl-kw); }
        .str { color: var(--hl-str); }
        .num { color: var(--hl-num); }
        .cmt { color: var(--hl-cmt); font-style: italic; }
        .fn { color: var(--hl-fn); }
        .tag { color: var(--hl-tag); }
        .attr { color: var(--hl-attr); }
        .prop { color: var(--hl-prop); }
        .op { color: var(--hl-op); }
        .punc { color: var(--hl-punc); }
        .annot { color: var(--hl-annot); }
        .type { color: var(--hl-type); }
        .search-match { background: var(--hl-search-bg); border-radius: 2px; display: inline; }
        .bracket-match { background: var(--hl-bracket-bg); border-radius: 2px; display: inline; }
        .line-highlight { background: var(--line-highlight-bg); display: block; position: absolute; left: 0; right: 0; pointer-events: none; }
    `;
    shadowRoot.appendChild(style);
    const preElement = document.createElement('pre');
    preElement.setAttribute('aria-hidden', 'true');
    shadowRoot.appendChild(preElement);
    EditorState.highlightPreElement = preElement;
    syncShadowCSSVariables();
}

export function updateShadowHighlight(highlightedHTML, wrapEnabled) {
    if (!EditorState.highlightPreElement) return;
    const pre = EditorState.highlightPreElement;
    pre.innerHTML = highlightedHTML + '\n';
    if (wrapEnabled) pre.classList.add('wrap-enabled');
    else pre.classList.remove('wrap-enabled');
}

export function syncShadowScroll() {
    if (EditorState.highlightPreElement) {
        EditorState.highlightPreElement.scrollTop = DOM.codeEditor.scrollTop;
        EditorState.highlightPreElement.scrollLeft = DOM.codeEditor.scrollLeft;
    }
}

/**
 * 同步滚动：行号 + 高亮层。
 */
export function syncScroll() {
    DOM.lineNumbers.scrollTop = DOM.codeEditor.scrollTop;
    syncShadowScroll();
}

// ==================== 括号匹配 ====================

export function findMatchingBracket(code, position) {
    const character = code[position];
    const bracketPairs = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{' };
    if (!bracketPairs[character]) return -1;
    const isOpeningBracket = '([{'.indexOf(character) !== -1;
    const targetCharacter = bracketPairs[character];
    let nestingDepth = 0;
    if (isOpeningBracket) {
        for (let i = position + 1; i < code.length; i++) {
            if (code[i] === character) nestingDepth++;
            else if (code[i] === targetCharacter) {
                if (nestingDepth === 0) return i;
                nestingDepth--;
            }
        }
    } else {
        for (let i = position - 1; i >= 0; i--) {
            if (code[i] === character) nestingDepth++;
            else if (code[i] === targetCharacter) {
                if (nestingDepth === 0) return i;
                nestingDepth--;
            }
        }
    }
    return -1;
}

// ==================== 综合高亮渲染 ====================

export function buildHighlightHTML(code, language, searchRanges, bracketRanges, currentLineIndex) {
    if (!code || EditorState.largeFileActive) return '';
    if (!EditorState.highlightEnabled) return escapeHtml(code) + '\n';

    const allHighlightRanges = [];
    for (let i = 0; i < searchRanges.length; i++) {
        allHighlightRanges.push({ start: searchRanges[i].start, end: searchRanges[i].end, type: 'search' });
    }
    for (let i = 0; i < bracketRanges.length; i++) {
        allHighlightRanges.push({ start: bracketRanges[i].start, end: bracketRanges[i].end, type: 'bracket' });
    }
    allHighlightRanges.sort(function(a, b) {
        return a.start - b.start;
    });

    const lines = code.split('\n');
    let resultHtml = '';
    let charIndex = 0;
    let visualLineIndex = 0;
    let rangePointer = 0;

    // ---- v8.0.2 修复（问题 2）：行高只读取一次计算样式，避免每行重复读取 ----
    // 原错误写法：EditorState.currentFontSize * parseFloat(lineHeight)
    //   —— 会把 14 * 23.8 变成 333.2，导致高亮位置严重偏移。
    // 正确写法：与 line-numbers.js 的 scrollToCursor 保持一致 ——
    //   直接使用 computedStyle.lineHeight 的像素值，若为 NaN（"normal"）
    //   再回退到 fontSize * 1.7 的估算值。
    const editorComputedStyle = getComputedStyle(DOM.codeEditor);
    const parsedLineHeight = parseFloat(editorComputedStyle.lineHeight);
    const lineHeightPx = parsedLineHeight || EditorState.currentFontSize * 1.7;
    const paddingTop = parseFloat(editorComputedStyle.paddingTop) || 12;
    const scrollTopOffset = DOM.codeEditor.scrollTop;

    function processTextSegment(text, segmentStart, segmentEnd) {
        while (rangePointer < allHighlightRanges.length && allHighlightRanges[rangePointer].end <= segmentStart) {
            rangePointer++;
        }
        let result = '';
        let lastPos = 0;
        while (rangePointer < allHighlightRanges.length && allHighlightRanges[rangePointer].start < segmentEnd) {
            const currentRange = allHighlightRanges[rangePointer];
            const rangeStartInSegment = currentRange.start - segmentStart;
            const rangeEndInSegment = Math.min(currentRange.end, segmentEnd) - segmentStart;
            if (rangeStartInSegment > lastPos) {
                const plainText = text.substring(segmentStart + lastPos, segmentStart + rangeStartInSegment);
                result += syntaxHighlightMainThread(plainText, language);
            }
            const matchText = text.substring(segmentStart + rangeStartInSegment, segmentStart + rangeEndInSegment);
            const matchClass = currentRange.type === 'search' ? 'search-match' : 'bracket-match';
            result += '<span class="' + matchClass + '">' + syntaxHighlightMainThread(matchText, language) + '</span>';
            lastPos = rangeEndInSegment;
            if (currentRange.end <= segmentEnd) rangePointer++;
            else break;
        }
        if (lastPos < segmentEnd - segmentStart) {
            const remainingText = text.substring(segmentStart + lastPos, segmentEnd);
            result += syntaxHighlightMainThread(remainingText, language);
        }
        return result;
    }

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        let isLineFolded = false;
        for (let f = 0; f < EditorState.foldedRanges.length; f++) {
            const foldRange = EditorState.foldedRanges[f];
            if (lineIdx > foldRange.startLine && lineIdx <= foldRange.endLine) {
                isLineFolded = true;
                break;
            }
        }
        if (isLineFolded) {
            charIndex += lines[lineIdx].length + 1;
            continue;
        }
        const line = lines[lineIdx];
        const lineStartGlobal = charIndex;
        const lineEndGlobal = lineStartGlobal + line.length;
        if (lineIdx === currentLineIndex) {
            const highlightTopPosition = (visualLineIndex * lineHeightPx) - scrollTopOffset + paddingTop;
            resultHtml += '<span class="line-highlight" style="top:' + highlightTopPosition + 'px;height:' + lineHeightPx + 'px;"></span>';
        }
        visualLineIndex++;
        resultHtml += processTextSegment(code, lineStartGlobal, lineEndGlobal) + '\n';
        charIndex = lineEndGlobal + 1;
    }
    return resultHtml;
}

// ==================== 调度 ====================

let highlightRAFId = null;
let scheduleHighlightCallback = null;

export function setHighlightScheduler(callback) {
    scheduleHighlightCallback = callback;
}

export function scheduleHighlightUpdate() {
    if (!scheduleHighlightCallback) return;
    if (highlightRAFId) return;
    highlightRAFId = requestAnimationFrame(function() {
        highlightRAFId = null;
        scheduleHighlightCallback();
    });
}

// ==================== 高亮开关 ====================

export function updateHighlightStatusIndicator(enabled) {
    if (enabled) {
        DOM.highlightIcon.textContent = '🔆';
        DOM.highlightLabel.textContent = '高亮';
        DOM.highlightStatus.style.color = 'var(--green)';
    } else {
        DOM.highlightIcon.textContent = '🌑';
        DOM.highlightLabel.textContent = '高亮已关';
        DOM.highlightStatus.style.color = 'var(--text-secondary)';
    }
}

export function setHighlightEnabled(enabled, showModal) {
    const shouldShowModal = showModal === true;
    if (EditorState.highlightEnabled === enabled && !shouldShowModal) return;
    EditorState.highlightEnabled = enabled;
    saveToLocalStorage(STORAGE_KEYS.HIGHLIGHT_ENABLED, enabled);
    updateHighlightStatusIndicator(enabled);

    if (enabled) {
        if (EditorState.largeFileActive) {
            DOM.largeFileModal.classList.add('open');
        } else {
            DOM.largeFileModal.classList.remove('open');
        }
        scheduleHighlightUpdate();
    } else {
        if (shouldShowModal && !EditorState.userForcedHighlight) {
            DOM.largeFileModal.classList.add('open');
        }
        if (EditorState.largeFileActive) {
            if (EditorState.highlightPreElement) EditorState.highlightPreElement.innerHTML = '';
        } else {
            updateShadowHighlight(escapeHtml(DOM.codeEditor.value), EditorState.wordWrapEnabled);
        }
        syncShadowScroll();
    }
}