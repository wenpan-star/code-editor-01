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
 *   9. 注入后缀联动回调（updateFileExtensionForLanguage）
 *   10. 设置高亮调度器
 *   11. 初始化自定义文件后缀输入框
 *   12. 初始化设置导出 / 导入模块
 *   13. 聚焦编辑器
 *
 * 【v8.6.0 更新】
 *   - 新增初始化设置导出 / 导入模块（setupSettingsIOEvents）
 *   - APP_VERSION 更新为 '8.6.0'
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
    setUpdateFileExtensionCallback,
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
    bindDownloadEvents,
    initializeFileExtensionInput,
    updateFileExtensionForLanguage
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
// v8.6.0 新增：设置导出 / 导入模块
import { setupSettingsIOEvents } from './settings-io.js';

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
 * v8.5.3：括号匹配增加 TXT 判断，TXT 为纯文本语义，
 *         不参与括号高亮。
 */
function performHighlightRender() {
    if (EditorState.largeFileActive) {
        if (EditorState.highlightPreElement) EditorState.highlightPreElement.innerHTML = '';
        syncShadowScroll();
        return;
    }

    if (!EditorState.highlightEnabled) {
        updateShadowHighlight(escapeHtml(DOM.codeEditor.value), EditorState.wordWrapEnabled);
        syncShadowScroll();
        return;
    }

    const bracketRanges = [];
    if (EditorState.currentLanguage !== 'txt') {
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

    // ---- 2. 注入循环依赖回调（匹配计数防抖） ----
    setUpdateMatchCountCallback(updateMatchCountDebounced);

    // ---- 2.1 注入后缀联动回调 ----
    setUpdateFileExtensionCallback(updateFileExtensionForLanguage);

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
        } else if (savedLanguage === 'python') {
            setEditorContent(DEFAULT_CODE_BY_LANGUAGE.python, false);
        } else if (savedLanguage === 'html') {
            setEditorContent(DEFAULT_CODE_BY_LANGUAGE.html, false);
        } else if (savedLanguage === 'css') {
            setEditorContent(DEFAULT_CODE_BY_LANGUAGE.css, false);
        } else if (savedLanguage === 'txt') {
            setEditorContent(DEFAULT_CODE_BY_LANGUAGE.txt, false);
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
    const savedLanguage = loadFromLocalStorage(STORAGE_KEYS.LANGUAGE, 'js');
    EditorState.currentLanguage = savedLanguage;
    if (DOM.langSelect) {
        DOM.langSelect.value = savedLanguage;
    }
    DOM.langDisplay.textContent = LANGUAGE_DISPLAY_NAMES[savedLanguage] || savedLanguage;

    scheduleHighlightUpdate();

    // ---- 15.1 初始化后缀输入框 ----
    initializeFileExtensionInput();

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
    // v8.6.0 新增：设置导出 / 导入
    setupSettingsIOEvents();

    // ---- 19. 聚焦编辑器 ----
    DOM.codeEditor.focus();
    updateUndoRedoState();

    console.log(
        '%c🚀 专业版编辑器 v' + CONFIG.APP_VERSION + ' 已就绪（新增设置导出/导入）',
        'color:#3fb950;font-weight:bold;'
    );
}

// ==================== 启动 ====================

initialize().catch(function(error) {
    console.error('初始化失败:', error);
    showToast('❌ 编辑器初始化失败，请刷新页面重试', true);
});