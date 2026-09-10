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
 *
 * 循环依赖解除方案：search.js 中的 updateMatchCountDebounced 通过
 * setUpdateMatchCountCallback 注入，避免 editor-api.js ←→ search.js 循环。
 *
 * 本次修复：
 *   handleUndo / handleRedo 移除冗余的 fullUpdate() 调用。
 *   HistoryManager.undo / redo 内部已通过 onStateApplied 回调执行一次
 *   fullUpdate（见 main.js 中 historyManagerInstance 的构造参数），
 *   handleUndo / handleRedo 无需重复调用。
 *   triggerAutoSave 与 toggleClearButton 保留，因为原本由
 *   handleEditorInput 提供，现已被 internalEditorUpdate 抑制。
 *
 *   行为完全不变：撤销 / 重做的刷新内容、自动保存触发、按钮状态均一致。
 *
 * 保留历史修复：
 *   - setEditorContent 主动派发 'input' 时用 internalEditorUpdate 抑制
 *     handleEditorInput 重复处理，并显式补齐 toggleClearButton()。
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
let updateMatchCountCallback = null;

/**
 * main.js 注入 updateMatchCountDebounced（来自 search.js）。
 * 注入的应是防抖版本，确保 fullUpdate 触发的匹配计数
 * 也走 150ms 防抖，避免被绕过。
 */
export function setUpdateMatchCountCallback(callback) {
    updateMatchCountCallback = callback;
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
        // 本次修复：onStateApplied（在 historyManager.undo 内部被调用）已经
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

export function switchLanguage(language) {
    EditorState.currentLanguage = language;
    saveToLocalStorage(STORAGE_KEYS.LANGUAGE, language);
    for (let i = 0; i < DOM.langLabels.length; i++) {
        const label = DOM.langLabels[i];
        const isActive = label.dataset.lang === language;
        label.classList.toggle('active', isActive);
        label.setAttribute('aria-pressed', isActive);
    }
    DOM.langDisplay.textContent = LANGUAGE_DISPLAY_NAMES[language] || language;
    scheduleHighlightUpdate();
    updateRunButtonState();
    if (language !== 'java' && EditorState.outputPanelOpen && !EditorState.isRunning) {
        closeOutputPanel();
    }
}