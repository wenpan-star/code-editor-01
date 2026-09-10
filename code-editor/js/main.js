/**
 * ============================================================================
 * main.js — 启动引导 + 初始化
 * ============================================================================
 *
 * 职责：
 *   1. 创建 HistoryManager 并注入回调
 *   2. 打开 IndexedDB 自动保存数据库
 *   3. 加载所有持久化设置
 *   4. 尝试恢复上次编辑内容
 *   5. 创建 Shadow DOM 高亮层
 *   6. 创建搜索 Worker（用于查找替换）
 *   7. 绑定所有事件
 *   8. 注入循环依赖回调（updateMatchCountDebounced）
 *   9. 设置高亮调度器
 *   10. 聚焦编辑器
 *
 * v8.1.1 修复：
 *   语言恢复后显式调用 scheduleHighlightUpdate()。
 *   原实现中，第 14 步 fullUpdate 触发的 scheduleHighlightUpdate
 *   会通过 requestAnimationFrame 排队，而 rAF 在下一帧才执行，此时
 *   EditorState.currentLanguage 已被第 15 步改写 —— 实际上工作正常，
 *   但依赖了 rAF 的异步性，不够明确。本版显式调用一次
 *   scheduleHighlightUpdate()，语义更清晰。
 *
 * 保留 v8.1.0 变更：
 *   语言选择由原来的 5 个 .lang-label 按钮改为单个 #languageSelect
 *   下拉框，恢复语言状态时直接设置 DOM.langSelect.value。
 *
 * 保留 v8.0.2 修复：
 *   - saveToLocalStorage 导入（用于 Java 版本切换）
 *   - 注入 updateMatchCountDebounced（使 fullUpdate 触发的匹配计数也走防抖）
 *   - performHighlightRender 不再内联定义 escapeHtml
 *   - performHighlightRender 不再重复调用 updateLineNumbers / updateCursorPosition
 * ============================================================================
 */

import { EditorState } from './state.js';
import {
    CONFIG,
    STORAGE_KEYS,
    LANGUAGE_DISPLAY_NAMES,
    DEFAULT_CODE_BY_LANGUAGE
} from './config.js';
import { DOM } from './dom.js';
import { showToast } from './toast.js';
import { loadFromLocalStorage, saveToLocalStorage, escapeHtml } from './util.js';
import { HistoryManager, setHistoryManager } from './history.js';
import {
    openAutoSaveDatabase,
    saveCodeToIndexedDB
} from './storage.js';
import {
    setUpdateMatchCountCallback,
    setEditorContent,
    fullUpdate,
    toggleClearButton,
    setOriginalCode,
    loadSavedCode,
    updateFileNameDisplay,
    updateUndoRedoState,
    updateRunButtonState
} from './editor-api.js';
import {
    setupShadowHighlightLayer,
    setHighlightScheduler,
    buildHighlightHTML,
    updateShadowHighlight,
    syncShadowScroll,
    findMatchingBracket,
    updateHighlightStatusIndicator,
    // v8.1.1：新增导入，用于语言恢复后显式刷新高亮。
    scheduleHighlightUpdate
} from './highlight.js';
import {
    createHighlightWorker,
    getMatchRangesAsync,
    updateMatchCountDebounced,
    bindReplaceModalEvents,
    restoreReplaceInputs
} from './search.js';
import {
    initializeEncodingSettings,
    bindEncodingSelectEvents
} from './encoding.js';
import { setupEditorEvents } from './editor.js';
import { setupLineNumberClickHandler } from './folding.js';
import {
    bindImportEvents,
    bindDragAndDropEvents,
    bindDownloadEvents
} from './file-io.js';
import {
    bindOutputEvents,
    restoreStdinCache
} from './output.js';
import { bindRunButton } from './java-runner.js';
import {
    setupUIEvents,
    loadTheme,
    applyInitialFontSize,
    applyInitialWrap,
    loadIndentSetting,
    updateIndentIndicator
} from './ui.js';

// ==================== Java 版本初始化 ====================

function initializeJavaVersion() {
    const savedVersion = loadFromLocalStorage(STORAGE_KEYS.JAVA_VERSION, '21.0.2');
    EditorState.javaVersion = savedVersion;
    DOM.javaVersionSelect.value = savedVersion;
}

function bindJavaVersionSelectEvent() {
    DOM.javaVersionSelect.addEventListener('change', function() {
        EditorState.javaVersion = this.value;
        saveToLocalStorage(STORAGE_KEYS.JAVA_VERSION, this.value);
        showToast('Java 版本已切换为 ' + this.value);
    });
}

// ==================== 高亮渲染调度器 ====================

/**
 * 由 main.js 注入到 highlight.js 的调度回调。
 * 回调负责：计算搜索/括号范围、调用 buildHighlightHTML 生成 HTML、
 *           更新 Shadow DOM 高亮层。
 *
 * 注意：
 *   - 不内联定义 escapeHtml，改用 util.js 的统一实现。
 *   - 不在此处调用 updateLineNumbers / updateCursorPosition，
 *     因为它们已由 fullUpdate 同步调用过。
 */
function performHighlightRender() {
    if (EditorState.largeFileActive) {
        if (EditorState.highlightPreElement) EditorState.highlightPreElement.innerHTML = '';
        syncShadowScroll();
        return;
    }

    if (!EditorState.highlightEnabled) {
        // 已关闭高亮：仅做 HTML 转义输出
        updateShadowHighlight(escapeHtml(DOM.codeEditor.value), EditorState.wordWrapEnabled);
        syncShadowScroll();
        return;
    }

    // 括号匹配（仅取光标前一个字符，若为括号则查找配对）
    const bracketRanges = [];
    const cursorPosition = DOM.codeEditor.selectionStart;
    if (cursorPosition > 0) {
        const checkPosition = cursorPosition - 1;
        if (DOM.codeEditor.value[checkPosition] && /[()\[\]{}]/.test(DOM.codeEditor.value[checkPosition])) {
            const matchingPos = findMatchingBracket(DOM.codeEditor.value, checkPosition);
            if (matchingPos !== -1) {
                const rangeStart = Math.min(checkPosition, matchingPos);
                const rangeEnd = Math.max(checkPosition, matchingPos) + 1;
                bracketRanges.push({ start: rangeStart, end: rangeEnd });
            }
        }
    }

    const currentLineIndex = DOM.codeEditor.value.substring(0, DOM.codeEditor.selectionStart).split('\n').length - 1;

    if (DOM.replaceModalOverlay.classList.contains('open') && DOM.replaceFind.value) {
        getMatchRangesAsync(
            DOM.codeEditor.value,
            DOM.replaceFind.value,
            DOM.replaceCaseSensitive.checked,
            DOM.replaceWholeWord.checked,
            DOM.replaceUseRegex.checked,
            function(searchRanges, reason) {
                const finalHTML = buildHighlightHTML(
                    DOM.codeEditor.value,
                    EditorState.currentLanguage,
                    searchRanges,
                    bracketRanges,
                    currentLineIndex
                );
                updateShadowHighlight(finalHTML, EditorState.wordWrapEnabled);
                syncShadowScroll();
            },
            CONFIG.SEARCH_TIMEOUT_MS
        );
    } else {
        const finalHTML = buildHighlightHTML(
            DOM.codeEditor.value,
            EditorState.currentLanguage,
            [],
            bracketRanges,
            currentLineIndex
        );
        updateShadowHighlight(finalHTML, EditorState.wordWrapEnabled);
        syncShadowScroll();
    }
}

// ==================== 初始化 ====================

async function initialize() {
    // ---- 1. 历史管理器 ----
    const historyManagerInstance = new HistoryManager(CONFIG.MAX_HISTORY, {
        onStateApplied: function() {
            fullUpdate();
        },
        onButtonsUpdate: function() {
            updateUndoRedoState();
        }
    });
    setHistoryManager(historyManagerInstance);
    historyManagerInstance.pushState(DOM.codeEditor);

    // ---- 2. 注入循环依赖回调 ----
    // 注入防抖版本，使 fullUpdate 触发的匹配计数也走防抖。
    setUpdateMatchCountCallback(updateMatchCountDebounced);

    // ---- 3. 设置高亮调度器 ----
    setHighlightScheduler(performHighlightRender);

    // ---- 4. 打开 IndexedDB ----
    try {
        await openAutoSaveDatabase();
    } catch (dbError) {
        console.warn('IndexedDB 不可用，将仅使用 localStorage 缓存');
    }

    // ---- 5. 加载设置 ----
    loadIndentSetting();
    updateIndentIndicator();
    loadTheme();
    applyInitialFontSize();
    applyInitialWrap();
    initializeEncodingSettings();
    initializeJavaVersion();

    // ---- 6. 文件名显示 ----
    updateFileNameDisplay('在线代码编辑器');

    // ---- 7. 折叠范围恢复 ----
    EditorState.foldedRanges = loadFromLocalStorage(STORAGE_KEYS.FOLDED_RANGES, []);
    setupLineNumberClickHandler();

    // ---- 8. 高亮开关状态 ----
    EditorState.highlightEnabled = loadFromLocalStorage(STORAGE_KEYS.HIGHLIGHT_ENABLED, true);
    EditorState.userForcedHighlight = false;
    updateHighlightStatusIndicator(EditorState.highlightEnabled);

    // ---- 9. stdin 恢复 ----
    restoreStdinCache();

    // ---- 10. 恢复编辑内容 ----
    const wasRestored = await loadSavedCode();
    if (!wasRestored) {
        const savedLanguage = loadFromLocalStorage(STORAGE_KEYS.LANGUAGE, 'js');
        if (savedLanguage === 'java') {
            setEditorContent(DEFAULT_CODE_BY_LANGUAGE.java, false);
        } else {
            setEditorContent(DEFAULT_CODE_BY_LANGUAGE.js, false);
        }
    }
    setOriginalCode(DOM.codeEditor.value);
    historyManagerInstance.pushState(DOM.codeEditor);

    // ---- 11. 创建搜索 Worker ----
    try {
        createHighlightWorker();
    } catch (workerError) {
        console.warn('Web Worker 创建失败，将使用主线程搜索', workerError);
    }

    // ---- 12. 初始化 Shadow DOM 高亮层 ----
    setupShadowHighlightLayer();

    // ---- 13. 恢复查找替换输入 ----
    restoreReplaceInputs();

    // ---- 14. 全量刷新 ----
    fullUpdate();
    toggleClearButton();

    // ---- 15. 恢复语言状态 ----
    // 语言选择改为单个下拉框，直接设置 value。
    const savedLanguage = loadFromLocalStorage(STORAGE_KEYS.LANGUAGE, 'js');
    EditorState.currentLanguage = savedLanguage;
    if (DOM.langSelect) {
        DOM.langSelect.value = savedLanguage;
    }
    DOM.langDisplay.textContent = LANGUAGE_DISPLAY_NAMES[savedLanguage] || savedLanguage;

    // v8.1.1：语言恢复后显式刷新高亮，不再依赖第 14 步 rAF 的异步性。
    scheduleHighlightUpdate();

    // ---- 16. 更新运行按钮状态 ----
    updateRunButtonState();

    // ---- 17. 保存初始内容到 IndexedDB ----
    try {
        await saveCodeToIndexedDB(DOM.codeEditor.value);
    } catch (saveError) {
        // 忽略
    }

    // ---- 18. 绑定所有事件 ----
    setupEditorEvents();
    bindReplaceModalEvents();
    bindEncodingSelectEvents();
    bindImportEvents();
    bindDragAndDropEvents();
    bindDownloadEvents();
    bindOutputEvents();
    bindRunButton();
    bindJavaVersionSelectEvent();
    setupUIEvents();

    // ---- 19. 聚焦编辑器 ----
    DOM.codeEditor.focus();
    updateUndoRedoState();

    console.log(
        '%c🚀 专业版编辑器 v' + CONFIG.APP_VERSION + ' 已就绪（细节修复版 · 单文件 → 多文件模块化重构）',
        'color:#3fb950;font-weight:bold;'
    );
}

// ==================== 启动 ====================

initialize().catch(function(error) {
    console.error('初始化失败:', error);
    showToast('❌ 编辑器初始化失败，请刷新页面重试', true);
});