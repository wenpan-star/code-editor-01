/**
 * ============================================================================
 * editor-api.js — 统一编辑入口 / 状态协调层
 * ============================================================================
 *
 * 本模块是编辑器内容变更的唯一入口，解决各模块之间的循环依赖。
 * 对外提供：
 *   - setEditorContent           统一内容设置
 *   - executeCodeModification    批量修改
 *   - fullUpdate / debouncedUpdate
 *   - triggerAutoSave / saveImmediately / emergencySave
 *   - loadSavedCode              启动恢复
 *   - markModified / clearModifiedMark / setOriginalCode
 *   - updateFileNameDisplay
 *   - handleUndo / handleRedo / updateUndoRedoState
 *   - updateRunButtonState / toggleClearButton / switchLanguage
 *   - setUpdateMatchCountCallback      注入匹配计数防抖回调
 *   - setUpdateFileExtensionCallback   注入后缀联动回调（v8.5.5 新增）
 *
 * 循环依赖解除方案：
 *   - search.js 的 updateMatchCountDebounced 通过 setUpdateMatchCountCallback 注入；
 *   - file-io.js 的 updateFileExtensionForLanguage 通过
 *     setUpdateFileExtensionCallback 注入。
 *   两者都避免 editor-api.js ←→ 其他模块 的循环依赖。
 *
 * 【v8.5.5 变更】
 *   switchLanguage 增加回调注入机制：任何调用 switchLanguage 的路径
 *   （ui.js 语言下拉、file-io.js 导入检测）都会自动同步后缀框。
 *   原实现在 ui.js 中显式调用 updateFileExtensionForLanguage，仅在
 *   用户主动切换语言时触发；file-io.js 的导入流程未触发，导致导入
 *   文件后语言跟随后缀不跟随。
 *
 * v8.1.0 变更：
 *   switchLanguage 由原来循环遍历 .lang-label 按钮改为操作单个下拉框
 *   DOM.langSelect。内部 language 值（js / html / css / python / java）
 *   保持不变，LANGUAGE_DISPLAY_NAMES 保持不变。
 *
 * 保留 v8.0.4 修复：
 *   handleUndo / handleRedo 移除冗余的 fullUpdate() 调用。
 *   HistoryManager.undo / redo 内部已通过 onStateApplied 回调执行一次
 *   fullUpdate（见 main.js 中 historyManagerInstance 的构造参数），
 *   handleUndo / handleRedo 无需重复调用。
 *   triggerAutoSave 与 toggleClearButton 保留，因为原本由
 *   handleEditorInput 提供，现已被 internalEditorUpdate 抑制。
 *
 * 保留 v8.0.2 修复：
 *   setEditorContent 主动派发 'input' 时用 internalEditorUpdate 抑制
 *   handleEditorInput 重复处理，并显式补齐 toggleClearButton()。
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
import { saveToLocalStorage, loadFromLocalStorage } from './util.js';
import { historyManager } from './history.js';
import { updateLineNumbers, updateCursorPosition } from './line-numbers.js';
import { scheduleHighlightUpdate, setHighlightEnabled } from './highlight.js';
import { closeOutputPanel } from './output.js';
import { saveCodeToIndexedDB, loadCodeFromIndexedDB } from './storage.js';

// ==================== 注入的回调 ====================

// 匹配计数防抖回调（来自 search.js 的 updateMatchCountDebounced）。
let updateMatchCountCallback = null;

// v8.5.5：后缀联动回调（来自 file-io.js 的 updateFileExtensionForLanguage）。
let updateFileExtensionCallback = null;

/**
 * main.js 注入 updateMatchCountDebounced（来自 search.js）。
 * 注入的应是防抖版本，确保 fullUpdate 触发的匹配计数
 * 也走 150ms 防抖，避免被绕过。
 */
export function setUpdateMatchCountCallback(callback) {
    updateMatchCountCallback = callback;
}

/**
 * v8.5.5：main.js 注入 updateFileExtensionForLanguage（来自 file-io.js）。
 * 注入后，任何调用 switchLanguage 的路径都会自动同步后缀框，例如：
 *   - ui.js 语言下拉 change 事件
 *   - file-io.js 的 loadFileIntoEditor 导入文件后检测到语言
 *   - 未来新增的其他调用路径
 * 这样"切换语言"成为一个原子操作，其所有副作用（高亮更新、
 * 运行按钮状态、后缀联动）都由 switchLanguage 统一负责。
 */
export function setUpdateFileExtensionCallback(callback) {
    updateFileExtensionCallback = callback;
}

// ==================== 统一编辑入口 ====================

export function setEditorContent(newValue, shouldRecordHistory, preserveCursor, finalCursorStart, finalCursorEnd) {
    const shouldRecord = shouldRecordHistory !== false;
    const preserve = preserveCursor === true;
    const editor = DOM.codeEditor;
    if (!editor) return;

    if (newValue.length > EditorState.absoluteFileSizeLimit) {
        showToast('❌ 内容超过 2MB，已阻止加载以避免卡顿', true);
        return;
    }

    const oldValue = editor.value;
    if (oldValue === newValue && newValue !== '') return;

    const isLargeFile = newValue.length > EditorState.largeFileThreshold;
    EditorState.largeFileActive = isLargeFile;

    if (historyManager) {
        historyManager.setLargeFileMode(isLargeFile);
    }

    if (isLargeFile && EditorState.highlightEnabled) {
        setHighlightEnabled(false, false);
    }

    const oldStart = editor.selectionStart;
    const oldEnd = editor.selectionEnd;

    if (shouldRecord && historyManager) {
        historyManager.pushState(editor);
    }
    editor.value = newValue;

    if (preserve && oldStart <= newValue.length) {
        editor.setSelectionRange(Math.min(oldStart, newValue.length), Math.min(oldEnd, newValue.length));
    } else if (
        finalCursorStart !== null && finalCursorStart !== undefined &&
        finalCursorEnd !== null && finalCursorEnd !== undefined &&
        finalCursorStart <= newValue.length && finalCursorEnd <= newValue.length
    ) {
        editor.setSelectionRange(finalCursorStart, finalCursorEnd);
    }

    // 设置内部更新标志，抑制 editor.js 的 handleEditorInput
    // 重复触发 debouncedUpdate / triggerAutoSave / toggleClearButton。
    // dispatchEvent 是同步的，所以标志的置位 / 复位发生在同一 tick 内，安全。
    EditorState.internalEditorUpdate = true;
    try {
        const inputEvent = new Event('input', { bubbles: true });
        editor.dispatchEvent(inputEvent);
    } finally {
        EditorState.internalEditorUpdate = false;
    }

    // 由于抑制了 handleEditorInput，这里需要显式补齐原本由
    // handleEditorInput 调用的 toggleClearButton()。
    fullUpdate();
    triggerAutoSave();
    toggleClearButton();

    if (shouldRecord && historyManager) {
        historyManager.pushState(editor);
    }
}

export function executeCodeModification(modificationFunc) {
    const editor = DOM.codeEditor;
    if (EditorState.largeFileActive) {
        modificationFunc();
        fullUpdate();
        triggerAutoSave();
        return;
    }
    if (historyManager) historyManager.beginBatch();
    modificationFunc();
    if (historyManager) historyManager.endBatch(editor);
    fullUpdate();
    triggerAutoSave();
}

// ==================== 全量刷新 ====================

export function fullUpdate() {
    updateLineNumbers();
    updateCursorPosition();
    scheduleHighlightUpdate();
    if (updateMatchCountCallback) updateMatchCountCallback();
    updateRunButtonState();
}

export function debouncedUpdate() {
    if (EditorState.updateTimer) clearTimeout(EditorState.updateTimer);
    EditorState.updateTimer = setTimeout(fullUpdate, 80);
}

// ==================== 运行按钮状态 ====================

export function updateRunButtonState() {
    if (EditorState.currentLanguage === 'java') {
        DOM.btnRun.disabled = false;
    } else {
        DOM.btnRun.disabled = true;
    }
}

// ==================== 清空按钮状态 ====================

export function toggleClearButton() {
    DOM.btnClear.disabled = (DOM.codeEditor.value === '');
}

// ==================== 修改状态标记 ====================

export function markModified() {
    if (!EditorState.codeModified) {
        EditorState.codeModified = true;
        const currentModifiedDot = document.getElementById('modifiedDot');
        if (currentModifiedDot) currentModifiedDot.style.display = 'inline-block';
    }
}

export function clearModifiedMark() {
    EditorState.codeModified = false;
    const currentModifiedDot = document.getElementById('modifiedDot');
    if (currentModifiedDot) currentModifiedDot.style.display = 'none';
}

export function setOriginalCode(code) {
    EditorState.originalCode = code;
    clearModifiedMark();
}

// ==================== 文件名显示 ====================

export function updateFileNameDisplay(filename) {
    EditorState.currentFileName = filename;
    DOM.fileNameDisplay.innerHTML = '';
    const textNode = document.createTextNode(filename + ' ');
    DOM.fileNameDisplay.appendChild(textNode);
    const modifiedDotSpan = document.createElement('span');
    modifiedDotSpan.className = 'modified-dot';
    modifiedDotSpan.id = 'modifiedDot';
    modifiedDotSpan.title = '未保存的更改';
    DOM.fileNameDisplay.appendChild(modifiedDotSpan);
    const newModifiedDot = document.getElementById('modifiedDot');
    if (newModifiedDot) {
        newModifiedDot.style.display = EditorState.codeModified ? 'inline-block' : 'none';
    }
}

// ==================== 自动保存 ====================

export function triggerAutoSave() {
    if (EditorState.autoSaveTimer) clearTimeout(EditorState.autoSaveTimer);
    const delay = EditorState.largeFileActive ? CONFIG.AUTOSAVE_DELAY_LARGE_FILE : CONFIG.AUTOSAVE_DELAY_NORMAL;
    EditorState.autoSaveTimer = setTimeout(async function() {
        const currentCode = DOM.codeEditor.value;
        try {
            await saveCodeToIndexedDB(currentCode);
            if (!EditorState.largeFileActive && currentCode.length < CONFIG.AUTOSAVE_LOCAL_STORAGE_MAX_LENGTH) {
                saveToLocalStorage(STORAGE_KEYS.CODE_CACHE, currentCode);
            }
            clearModifiedMark();
            DOM.autoSaveStatus.textContent = '💾 已自动保存';
            DOM.autoSaveStatus.style.color = 'var(--green)';
            setTimeout(function() {
                DOM.autoSaveStatus.textContent = '💾 自动保存';
            }, 2000);
        } catch (error) {
            console.warn('自动保存失败', error);
            if (!EditorState.largeFileActive) {
                try {
                    saveToLocalStorage(STORAGE_KEYS.CODE_CACHE, currentCode);
                    DOM.autoSaveStatus.textContent = '💾 已保存(本地)';
                } catch (localError) {
                    DOM.autoSaveStatus.textContent = '⚠️ 保存失败';
                    DOM.autoSaveStatus.style.color = 'var(--red)';
                }
            } else {
                DOM.autoSaveStatus.textContent = '⚠️ 大文件未保存';
                DOM.autoSaveStatus.style.color = 'var(--red)';
            }
            if (currentCode !== EditorState.originalCode) markModified();
        }
    }, delay);
}

export async function saveImmediately() {
    const currentCode = DOM.codeEditor.value;
    try {
        await saveCodeToIndexedDB(currentCode);
        if (!EditorState.largeFileActive && currentCode.length < CONFIG.AUTOSAVE_LOCAL_STORAGE_MAX_LENGTH) {
            saveToLocalStorage(STORAGE_KEYS.CODE_CACHE, currentCode);
        }
        setOriginalCode(currentCode);
        clearModifiedMark();
        showToast('✅ 已保存');
    } catch (error) {
        showToast('❌ 保存失败', true);
    }
}

// ==================== 紧急保存 ====================

export function emergencySave() {
    const code = DOM.codeEditor.value;
    try {
        if (!EditorState.largeFileActive) {
            saveToLocalStorage(STORAGE_KEYS.CODE_CACHE, code);
            saveToLocalStorage(STORAGE_KEYS.DIRTY_FLAG, '1');
        }
    } catch (saveError) {
        // 静默
    }
    if (EditorState.autoSaveDB) {
        const savePromise = saveCodeToIndexedDB(code);
        const timeoutPromise = new Promise(function(_, reject) {
            setTimeout(function() { reject(new Error('timeout')); }, 500);
        });
        Promise.race([savePromise, timeoutPromise]).then(function() {
            if (!EditorState.largeFileActive) {
                saveToLocalStorage(STORAGE_KEYS.DIRTY_FLAG, '0');
            }
        }).catch(function() { /* 静默 */ });
    }
}

// ==================== 恢复上次编辑 ====================

export async function loadSavedCode() {
    const wasDirty = loadFromLocalStorage(STORAGE_KEYS.DIRTY_FLAG, '0') === '1';
    if (wasDirty) {
        const cachedCode = loadFromLocalStorage(STORAGE_KEYS.CODE_CACHE, null);
        if (cachedCode && cachedCode !== DEFAULT_CODE_BY_LANGUAGE.js) {
            if (confirm('检测到上次页面异常关闭时未保存的内容，是否恢复？')) {
                setEditorContent(cachedCode, false);
                saveToLocalStorage(STORAGE_KEYS.DIRTY_FLAG, '0');
                return true;
            }
        }
        saveToLocalStorage(STORAGE_KEYS.DIRTY_FLAG, '0');
    }
    try {
        const indexedCode = await loadCodeFromIndexedDB();
        if (indexedCode !== null && indexedCode !== undefined && indexedCode !== DEFAULT_CODE_BY_LANGUAGE.js) {
            if (confirm('检测到上次未完成的编辑内容，是否恢复？')) {
                setEditorContent(indexedCode, false);
                return true;
            }
        }
    } catch (dbError) {
        // 忽略
    }
    const cachedCode = loadFromLocalStorage(STORAGE_KEYS.CODE_CACHE, null);
    if (cachedCode && cachedCode !== DEFAULT_CODE_BY_LANGUAGE.js) {
        if (confirm('检测到本地缓存的编辑内容，是否恢复？')) {
            setEditorContent(cachedCode, false);
            return true;
        }
    }
    return false;
}

// ==================== 撤销 / 重做 ====================

export function handleUndo() {
    if (!historyManager) return;
    if (historyManager.undo(DOM.codeEditor)) {
        // onStateApplied（在 historyManager.undo 内部被调用）已经
        // 执行过 fullUpdate，此处不再重复调用。
        // 原由 handleEditorInput 提供的 triggerAutoSave / toggleClearButton
        // 因 internalEditorUpdate 抑制而不会被调用，需显式补齐。
        triggerAutoSave();
        toggleClearButton();
    }
}

export function handleRedo() {
    if (!historyManager) return;
    if (historyManager.redo(DOM.codeEditor)) {
        // 同上：fullUpdate 已由 onStateApplied 执行，此处不再重复调用。
        triggerAutoSave();
        toggleClearButton();
    }
}

export function updateUndoRedoState() {
    if (!historyManager) return;
    DOM.btnUndo.disabled = !historyManager.canUndo();
    DOM.btnRedo.disabled = !historyManager.canRedo();
}

// ==================== 语言切换 ====================

/**
 * 切换语言并同步所有相关状态。
 *
 * v8.5.5：本函数现在是"切换语言"的**唯一原子操作**，包括：
 *   1. 更新 EditorState.currentLanguage；
 *   2. 持久化到 localStorage；
 *   3. 同步语言下拉框 value；
 *   4. 更新状态栏语言全称；
 *   5. 调度语法高亮刷新；
 *   6. 更新运行按钮状态；
 *   7. 非 Java 语言时关闭输出面板；
 *   8. 触发后缀联动回调（若已注入）—— 保证后缀框自动跟随语言。
 *
 * 由 ui.js 的语言下拉 change 事件、file-io.js 的文件导入路径调用。
 */
export function switchLanguage(language) {
    EditorState.currentLanguage = language;
    saveToLocalStorage(STORAGE_KEYS.LANGUAGE, language);

    // 语言选择为单个下拉框，直接同步 value。
    if (DOM.langSelect) {
        DOM.langSelect.value = language;
    }

    // 状态栏显示全称（如 JavaScript）。
    DOM.langDisplay.textContent = LANGUAGE_DISPLAY_NAMES[language] || language;

    scheduleHighlightUpdate();
    updateRunButtonState();
    if (language !== 'java' && EditorState.outputPanelOpen && !EditorState.isRunning) {
        closeOutputPanel();
    }

    // v8.5.5：触发后缀联动回调（若已注入）。
    // 支持所有调用路径自动同步后缀框：
    //   - ui.js 语言下拉切换
    //   - file-io.js 导入文件检测到语言
    //   - 未来新增的其他调用路径
    // 回调可能抛出异常（例如输入框尚未挂载），已做防御性 try / catch。
    if (updateFileExtensionCallback) {
        try {
            updateFileExtensionCallback(language);
        } catch (callbackError) {
            console.warn('后缀联动回调执行失败:', callbackError);
        }
    }
}