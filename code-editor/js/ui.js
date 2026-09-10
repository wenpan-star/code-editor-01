/**
 * ============================================================================
 * ui.js — 主 UI 事件
 * ============================================================================
 *
 * 本模块职责：
 *   1. 主题切换 / 字体缩放 / 自动换行 / 缩进设置
 *   2. 帮助弹窗 / 大文件弹窗
 *   3. 全局快捷键（Ctrl +/-/0/F/H/G/S/T/Enter/Shift+C，Ctrl+Z/Y）
 *   4. 复制 / 清空 / 全选 / 撤销 / 重做 按钮
 *   5. 高亮状态指示器点击
 *   6. 智能 textarea 高度调整
 *   7. 页面隐藏 / 卸载时终止 Worker + 紧急保存
 *
 * 编码精简：
 *   beforeunload 中移除 GB18030 Worker 的终止逻辑（该 Worker 已下线）。
 *   仅保留对查找替换 Worker（highlightWorker）的终止。
 *
 * 保留历史修复：
 *   - 大文件模式下手动开启高亮后立即 fullUpdate，刷新行号 / 光标 / 高亮层。
 * ============================================================================
 */

import { EditorState } from './state.js';
import {
    STORAGE_KEYS,
    THEME_SEQUENCE,
    THEME_ICONS
} from './config.js';
import { DOM } from './dom.js';
import { showToast } from './toast.js';
import {
    saveToLocalStorage,
    loadFromLocalStorage
} from './util.js';
import {
    handleUndo,
    handleRedo,
    updateUndoRedoState,
    saveImmediately,
    emergencySave,
    switchLanguage,
    setEditorContent,
    updateFileNameDisplay,
    fullUpdate
} from './editor-api.js';
import {
    syncShadowCSSVariables,
    scheduleHighlightUpdate,
    setHighlightEnabled,
    syncScroll
} from './highlight.js';
import { scrollToCursor, updateCursorPosition } from './line-numbers.js';
import { toggleReplaceModal, openReplaceModal } from './search.js';
import { runJavaCode } from './java-runner.js';
import { historyManager } from './history.js';

// ==================== 主题 ====================

export function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    EditorState.theme = theme;
    saveToLocalStorage(STORAGE_KEYS.THEME, theme);
    DOM.btnTheme.textContent = THEME_ICONS[theme] || '☀️';
    DOM.btnTheme.setAttribute('aria-label', '切换主题（当前：' + theme + '）');
    syncShadowCSSVariables();
}

export function cycleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const currentIndex = THEME_SEQUENCE.indexOf(currentTheme);
    const nextTheme = THEME_SEQUENCE[(currentIndex + 1) % THEME_SEQUENCE.length];
    setTheme(nextTheme);
    showToast('主题已切换为 ' + nextTheme);
}

export function loadTheme() {
    const savedTheme = loadFromLocalStorage(STORAGE_KEYS.THEME, 'dark');
    setTheme(savedTheme);
}

// ==================== 字体缩放 ====================

export function setFontSize(size) {
    EditorState.currentFontSize = Math.max(10, Math.min(30, size));
    document.documentElement.style.setProperty('--editor-font-size', EditorState.currentFontSize + 'px');
    saveToLocalStorage(STORAGE_KEYS.FONT_SIZE, EditorState.currentFontSize);
    syncShadowCSSVariables();
}

export function applyInitialFontSize() {
    const savedSize = loadFromLocalStorage(STORAGE_KEYS.FONT_SIZE, 14);
    EditorState.currentFontSize = savedSize;
    document.documentElement.style.setProperty('--editor-font-size', savedSize + 'px');
    syncShadowCSSVariables();
}

// ==================== 自动换行 ====================

export function toggleWordWrap() {
    EditorState.wordWrapEnabled = !EditorState.wordWrapEnabled;
    if (EditorState.wordWrapEnabled) {
        DOM.codeEditor.wrap = 'soft';
        DOM.btnWrap.style.color = 'var(--accent)';
    } else {
        DOM.codeEditor.wrap = 'off';
        DOM.btnWrap.style.color = '';
    }
    saveToLocalStorage(STORAGE_KEYS.WRAP_ENABLED, EditorState.wordWrapEnabled);
    scheduleHighlightUpdate();
    showToast(EditorState.wordWrapEnabled ? '自动换行：开' : '自动换行：关');
}

export function applyInitialWrap() {
    const savedWrap = loadFromLocalStorage(STORAGE_KEYS.WRAP_ENABLED, false);
    EditorState.wordWrapEnabled = savedWrap;
    DOM.codeEditor.wrap = savedWrap ? 'soft' : 'off';
    if (savedWrap) DOM.btnWrap.style.color = 'var(--accent)';
}

// ==================== 缩进设置 ====================

export function updateIndentIndicator() {
    if (EditorState.indentCharacter === '\t') {
        DOM.indentIndicator.textContent = 'Tab';
    } else {
        DOM.indentIndicator.textContent = EditorState.indentSize + '空格';
    }
    saveToLocalStorage(STORAGE_KEYS.INDENT, {
        size: EditorState.indentSize,
        character: EditorState.indentCharacter
    });
}

export function loadIndentSetting() {
    const savedIndent = loadFromLocalStorage(STORAGE_KEYS.INDENT, { size: 4, character: ' ' });
    EditorState.indentSize = savedIndent.size;
    EditorState.indentCharacter = savedIndent.character;
}

function cycleIndent() {
    if (EditorState.indentCharacter === ' ' && EditorState.indentSize === 4) {
        EditorState.indentSize = 2;
        EditorState.indentCharacter = ' ';
    } else if (EditorState.indentCharacter === ' ' && EditorState.indentSize === 2) {
        EditorState.indentSize = 8;
        EditorState.indentCharacter = ' ';
    } else if (EditorState.indentCharacter === ' ' && EditorState.indentSize === 8) {
        EditorState.indentCharacter = '\t';
    } else {
        EditorState.indentCharacter = ' ';
        EditorState.indentSize = 4;
    }
    updateIndentIndicator();
    const indentDisplay = EditorState.indentCharacter === '\t' ? 'Tab' : EditorState.indentSize + ' 空格';
    showToast('缩进设置已切换为 ' + indentDisplay);
}

// ==================== 复制 ====================

async function copyCode() {
    const currentCode = DOM.codeEditor.value;
    if (!currentCode.trim()) {
        showToast('⚠️ 编辑器为空，请先输入代码', true);
        return;
    }
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(currentCode);
        } else {
            const tempTextarea = document.createElement('textarea');
            tempTextarea.value = currentCode;
            tempTextarea.style.position = 'fixed';
            tempTextarea.style.left = '-9999px';
            document.body.appendChild(tempTextarea);
            tempTextarea.select();
            document.execCommand('copy');
            document.body.removeChild(tempTextarea);
        }
        DOM.copyIcon.style.display = 'none';
        DOM.checkIcon.style.display = 'inline-block';
        DOM.copyText.textContent = '已复制!';
        DOM.btnCopy.style.background = 'var(--green-bg)';
        DOM.btnCopy.style.color = 'var(--green)';
        DOM.btnCopy.style.borderColor = 'rgba(166,227,161,0.3)';
        showToast('✅ 代码已复制到剪贴板');
        if (EditorState.copyRestoreTimer) clearTimeout(EditorState.copyRestoreTimer);
        EditorState.copyRestoreTimer = setTimeout(function() {
            DOM.checkIcon.style.display = 'none';
            DOM.copyIcon.style.display = 'inline-block';
            DOM.copyText.textContent = '复制';
            DOM.btnCopy.style.background = '';
            DOM.btnCopy.style.color = '';
            DOM.btnCopy.style.borderColor = '';
            EditorState.copyRestoreTimer = null;
        }, 2000);
    } catch (copyError) {
        showToast('❌ 复制失败，请手动选择复制', true);
    }
}

// ==================== 清空 / 全选 ====================

function clearEditor() {
    if (!DOM.codeEditor.value.trim()) {
        showToast('编辑器已为空');
        return;
    }
    if (!confirm('确定要清空编辑器中的所有代码吗？')) return;
    setEditorContent('', true);
    updateFileNameDisplay('在线代码编辑器');
    showToast('🗑️ 编辑器已清空');
}

function selectAll() {
    DOM.codeEditor.focus();
    DOM.codeEditor.select();
    updateCursorPosition();
}

// ==================== 高亮状态点击 ====================

function handleHighlightStatusClick() {
    const newState = !EditorState.highlightEnabled;
    EditorState.userForcedHighlight = newState;
    if (newState && EditorState.largeFileActive) {
        if (!confirm('大文件开启高亮可能导致编辑器卡顿，确定继续？')) return;
        EditorState.largeFileActive = false;
        if (historyManager) historyManager.setLargeFileMode(false);
        setHighlightEnabled(newState, false);
        // 立即刷新行号 / 光标 / 高亮层，避免行号列停留在"大文件"提示。
        fullUpdate();
        showToast('高亮已开启');
        return;
    }
    setHighlightEnabled(newState, false);
    showToast(newState ? '高亮已开启' : '高亮已关闭');
}

// ==================== 大文件弹窗 ====================

function bindLargeFileModalEvents() {
    DOM.btnEnableHighlightModal.addEventListener('click', function() {
        EditorState.userForcedHighlight = true;
        EditorState.largeFileActive = false;
        if (historyManager) historyManager.setLargeFileMode(false);
        setHighlightEnabled(true, false);
        DOM.largeFileModal.classList.remove('open');
        // 立即刷新行号 / 光标 / 高亮层。
        fullUpdate();
        showToast('已手动开启高亮，编辑大型文件时请注意性能');
    });

    DOM.btnDismissLargeFileModal.addEventListener('click', function() {
        DOM.largeFileModal.classList.remove('open');
        EditorState.userForcedHighlight = true;
    });

    DOM.largeFileModal.addEventListener('click', function(event) {
        if (event.target === DOM.largeFileModal) DOM.largeFileModal.classList.remove('open');
    });
}

// ==================== 帮助弹窗 ====================

function bindHelpModalEvents() {
    DOM.btnHelp.addEventListener('click', function() {
        EditorState.lastFocusedElement = document.activeElement;
        DOM.helpModal.classList.add('open');
        DOM.btnCloseHelp.focus();
    });

    DOM.btnCloseHelp.addEventListener('click', function() {
        DOM.helpModal.classList.remove('open');
        if (EditorState.lastFocusedElement) EditorState.lastFocusedElement.focus();
    });

    DOM.helpModal.addEventListener('click', function(event) {
        if (event.target === DOM.helpModal) {
            DOM.helpModal.classList.remove('open');
            if (EditorState.lastFocusedElement) EditorState.lastFocusedElement.focus();
        }
    });

    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape' && DOM.helpModal.classList.contains('open')) {
            DOM.helpModal.classList.remove('open');
            if (EditorState.lastFocusedElement) EditorState.lastFocusedElement.focus();
        }
    });
}

// ==================== 全局快捷键 ====================

function isEditableInputFocused() {
    const activeElement = document.activeElement;
    if (!activeElement) return false;
    if (activeElement === DOM.codeEditor) return false;
    const tagName = activeElement.tagName;
    if (tagName === 'INPUT' || tagName === 'TEXTAREA' || activeElement.isContentEditable) return true;
    return false;
}

function handleGlobalKeyDown(event) {
    const isCtrlOrMeta = event.ctrlKey || event.metaKey;

    if (isCtrlOrMeta && (event.key === '=' || event.key === '+')) {
        event.preventDefault();
        setFontSize(EditorState.currentFontSize + 1);
        showToast('字体大小: ' + EditorState.currentFontSize + 'px');
        return;
    }
    if (isCtrlOrMeta && event.key === '-') {
        event.preventDefault();
        setFontSize(EditorState.currentFontSize - 1);
        showToast('字体大小: ' + EditorState.currentFontSize + 'px');
        return;
    }
    if (isCtrlOrMeta && event.key === '0') {
        event.preventDefault();
        setFontSize(14);
        showToast('字体已重置为 14px');
        return;
    }
    if (isCtrlOrMeta && event.key === 'f') {
        event.preventDefault();
        if (!DOM.replaceModalOverlay.classList.contains('open')) openReplaceModal();
        DOM.replaceFind.focus();
        return;
    }
    if (isCtrlOrMeta && event.key === 'h') {
        event.preventDefault();
        if (!DOM.replaceModalOverlay.classList.contains('open')) openReplaceModal();
        DOM.replaceWith.focus();
        return;
    }
    if (isCtrlOrMeta && event.key === 'g') {
        event.preventDefault();
        const lineInput = prompt('跳转到行号:');
        if (lineInput && !isNaN(lineInput)) {
            const allLines = DOM.codeEditor.value.split('\n');
            const targetLine = Math.min(Math.max(1, parseInt(lineInput)), allLines.length);
            let characterPosition = 0;
            for (let j = 0; j < targetLine - 1; j++) {
                characterPosition += allLines[j].length + 1;
            }
            DOM.codeEditor.focus();
            DOM.codeEditor.setSelectionRange(characterPosition, characterPosition);
            scrollToCursor();
            updateCursorPosition();
            showToast('已跳转到第 ' + targetLine + ' 行');
        }
        return;
    }
    if (isCtrlOrMeta && event.key === 's') {
        event.preventDefault();
        saveImmediately().catch(function() { /* 静默 */ });
        return;
    }
    if (isCtrlOrMeta && event.key === 'z' && !event.shiftKey && !isEditableInputFocused()) {
        event.preventDefault();
        handleUndo();
        updateUndoRedoState();
        scrollToCursor();
        return;
    }
    if (isCtrlOrMeta && (event.key === 'y' || (event.key === 'z' && event.shiftKey)) && !isEditableInputFocused()) {
        event.preventDefault();
        handleRedo();
        updateUndoRedoState();
        scrollToCursor();
        return;
    }
    if (isCtrlOrMeta && event.key === 't') {
        event.preventDefault();
        cycleTheme();
        showToast('主题: ' + EditorState.theme);
        return;
    }
    if (isCtrlOrMeta && event.key === 'Enter') {
        if (EditorState.currentLanguage === 'java') {
            event.preventDefault();
            runJavaCode();
        }
        return;
    }
    if (isEditableInputFocused()) return;
    if (isCtrlOrMeta && event.shiftKey && (event.key === 'C' || event.key === 'c')) {
        event.preventDefault();
        copyCode();
        return;
    }
}

// ==================== 页面生命周期 ====================

function bindPageLifecycleEvents() {
    window.addEventListener('pagehide', emergencySave);
    window.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'hidden') emergencySave();
    });
    window.addEventListener('beforeunload', function(event) {
        // 终止查找替换 Worker（若存在）。
        if (EditorState.highlightWorker) {
            EditorState.highlightWorker.terminate();
            EditorState.highlightWorker = null;
        }
        emergencySave();
        if (EditorState.codeModified) {
            event.preventDefault();
            event.returnValue = '您有未保存的更改，刷新页面可能会丢失。';
            return event.returnValue;
        }
    });
    window.addEventListener('resize', function() {
        syncScroll();
    });
}

// ==================== 智能 textarea 高度 ====================

function initializeResizableTextareas() {
    const resizeHandles = document.querySelectorAll('.resize-handle-textarea');
    const textareaHeightStorageKeys = {
        replaceFind: STORAGE_KEYS.REPLACE_FIND_MANUAL_HEIGHT,
        replaceWith: STORAGE_KEYS.REPLACE_WITH_MANUAL_HEIGHT
    };

    function restoreTextareaHeight(textareaId) {
        const textareaElement = document.getElementById(textareaId);
        if (!textareaElement) return;
        const savedHeight = loadFromLocalStorage(textareaHeightStorageKeys[textareaId], null);
        if (savedHeight && typeof savedHeight === 'number' && savedHeight >= 60 && savedHeight <= 400) {
            textareaElement.style.height = savedHeight + 'px';
        } else {
            textareaElement.style.height = '60px';
        }
        textareaElement.style.resize = 'none';
    }

    restoreTextareaHeight('replaceFind');
    restoreTextareaHeight('replaceWith');

    resizeHandles.forEach(function(handle) {
        const targetId = handle.getAttribute('data-target');
        const targetTextarea = document.getElementById(targetId);
        if (!targetTextarea) return;

        let isDraggingHeight = false;
        let dragStartY = 0;
        let dragStartHeight = 0;

        const onMouseMoveResize = function(moveEvent) {
            if (!isDraggingHeight) return;
            const deltaY = moveEvent.clientY - dragStartY;
            let newHeight = dragStartHeight + deltaY;
            newHeight = Math.min(400, Math.max(60, newHeight));
            targetTextarea.style.height = newHeight + 'px';
            saveToLocalStorage(textareaHeightStorageKeys[targetId], newHeight);
        };

        const onMouseUpResize = function() {
            if (!isDraggingHeight) return;
            isDraggingHeight = false;
            document.removeEventListener('mousemove', onMouseMoveResize);
            document.removeEventListener('mouseup', onMouseUpResize);
        };

        handle.addEventListener('mousedown', function(downEvent) {
            downEvent.preventDefault();
            downEvent.stopPropagation();
            isDraggingHeight = true;
            dragStartY = downEvent.clientY;
            dragStartHeight = targetTextarea.offsetHeight;
            document.addEventListener('mousemove', onMouseMoveResize);
            document.addEventListener('mouseup', onMouseUpResize);
        });
    });
}

// ==================== 事件绑定入口 ====================

export function setupUIEvents() {
    // 主题
    DOM.btnTheme.addEventListener('click', cycleTheme);
    // 自动换行
    DOM.btnWrap.addEventListener('click', toggleWordWrap);
    // 缩进
    DOM.indentIndicator.addEventListener('click', cycleIndent);
    // 高亮状态
    DOM.highlightStatus.addEventListener('click', handleHighlightStatusClick);
    // 复制
    DOM.btnCopy.addEventListener('click', copyCode);
    // 清空 / 全选
    DOM.btnClear.addEventListener('click', clearEditor);
    DOM.btnSelectAll.addEventListener('click', selectAll);
    // 撤销 / 重做
    DOM.btnUndo.addEventListener('click', function() {
        handleUndo();
        updateUndoRedoState();
    });
    DOM.btnRedo.addEventListener('click', function() {
        handleRedo();
        updateUndoRedoState();
    });
    // 查找替换
    DOM.btnToggleReplace.addEventListener('click', toggleReplaceModal);
    // 语言标签
    for (let i = 0; i < DOM.langLabels.length; i++) {
        DOM.langLabels[i].addEventListener('click', function() {
            switchLanguage(this.dataset.lang);
        });
    }
    // 全局快捷键
    document.addEventListener('keydown', handleGlobalKeyDown);
    // 帮助弹窗
    bindHelpModalEvents();
    // 大文件弹窗
    bindLargeFileModalEvents();
    // 页面生命周期
    bindPageLifecycleEvents();
    // 可调整 textarea
    initializeResizableTextareas();
    // 编辑器 input / keyup 更新撤销重做按钮
    DOM.codeEditor.addEventListener('input', updateUndoRedoState);
    DOM.codeEditor.addEventListener('keyup', updateUndoRedoState);
}