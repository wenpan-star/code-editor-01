/**
 * ============================================================================
 * history.js — 撤销/重做历史管理器
 * ============================================================================
 * 版本：v8.0.3（遗留问题补完版）
 * 更新日期：2026-09-11
 *
 * 重构说明：
 *   从 v7.7.0 主脚本提取 HistoryManager 类，保持全部行为：
 *   - 大文件模式限制步数为 30（但不清空已裁剪的历史）
 *   - 支持批量操作 beginBatch / endBatch
 *   - 通过回调 onStateApplied / onButtonsUpdate 解耦
 *
 * 重要：historyManager 全局实例由 main.js 创建并注入。
 *
 * v8.0.3 修复（问题 A）：
 *   dispatchEditorUpdate 主动派发 'input' 事件前，先将
 *   EditorState.internalEditorUpdate 置为 true，事件派发完成后复位。
 *   这样 editor.js 的 handleEditorInput 检测到该标志后会直接返回，
 *   不再重复触发 debouncedUpdate / triggerAutoSave / toggleClearButton，
 *   避免一次撤销 / 重做操作触发多次 fullUpdate（v8.0.2 修复 5 的遗漏补完）。
 *
 *   补充：撤销 / 重做路径的 triggerAutoSave 与 toggleClearButton
 *   已由 editor-api.js 的 handleUndo / handleRedo 显式调用，
 *   因此抑制 handleEditorInput 不会导致这两处逻辑丢失。
 *
 * 依赖：
 *   - config.js（CONFIG）
 *   - state.js（EditorState）—— v8.0.3 新增依赖，无循环风险
 * ============================================================================
 */

import { CONFIG } from './config.js';
import { EditorState } from './state.js';

export class HistoryManager {
    constructor(maxHistory, callbacks) {
        const callbacksObject = callbacks || {};
        this.history = [];
        this.currentIndex = -1;
        this.maxHistory = maxHistory || CONFIG.MAX_HISTORY;
        this.largeFileMaxHistory = CONFIG.LARGE_FILE_MAX_HISTORY;
        this.batchDepth = 0;
        this.pendingBatchState = null;
        this.historyPaused = false;
        this.isLargeFileMode = false;

        this.onStateApplied = callbacksObject.onStateApplied || null;
        this.onButtonsUpdate = callbacksObject.onButtonsUpdate || null;
    }

    captureState(editorElement) {
        return {
            code: editorElement.value,
            selectionStart: editorElement.selectionStart,
            selectionEnd: editorElement.selectionEnd
        };
    }

    applyState(state, editorElement) {
        if (!state) return;
        editorElement.value = state.code;
        editorElement.setSelectionRange(state.selectionStart, state.selectionEnd);
        this.dispatchEditorUpdate(editorElement);
    }

    /**
     * v8.0.3 修复（问题 A）：
     * 在主动派发 'input' 事件时置位 / 复位 EditorState.internalEditorUpdate，
     * 让 editor.js 的 handleEditorInput 直接返回，避免重复处理。
     * dispatchEvent 是同步的，置位 / 复位发生在同一 tick 内，安全。
     */
    dispatchEditorUpdate(editorElement) {
        EditorState.internalEditorUpdate = true;
        try {
            const event = new Event('input', { bubbles: true });
            editorElement.dispatchEvent(event);
        } finally {
            EditorState.internalEditorUpdate = false;
        }
        if (this.onStateApplied) this.onStateApplied();
    }

    pushState(editorElement, force) {
        const shouldForce = force === true;
        if (this.historyPaused) return;
        const newState = this.captureState(editorElement);
        if (this.batchDepth > 0) {
            this.pendingBatchState = newState;
            return;
        }
        if (this.currentIndex >= 0 && this.history[this.currentIndex]) {
            const lastState = this.history[this.currentIndex];
            if (
                lastState.code === newState.code &&
                lastState.selectionStart === newState.selectionStart &&
                lastState.selectionEnd === newState.selectionEnd
            ) {
                return;
            }
        }
        if (this.currentIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.currentIndex + 1);
        }
        this.history.push(newState);
        const effectiveMax = this.isLargeFileMode ? this.largeFileMaxHistory : this.maxHistory;
        if (this.history.length > effectiveMax) {
            this.history.shift();
        } else {
            this.currentIndex++;
        }
        this.updateButtons();
    }

    undo(editorElement) {
        if (this.historyPaused || !this.canUndo()) return false;
        this.currentIndex--;
        this.applyState(this.history[this.currentIndex], editorElement);
        this.updateButtons();
        return true;
    }

    redo(editorElement) {
        if (this.historyPaused || !this.canRedo()) return false;
        this.currentIndex++;
        this.applyState(this.history[this.currentIndex], editorElement);
        this.updateButtons();
        return true;
    }

    canUndo() {
        return this.currentIndex > 0;
    }

    canRedo() {
        return this.currentIndex < this.history.length - 1;
    }

    updateButtons() {
        if (this.onButtonsUpdate) this.onButtonsUpdate();
    }

    beginBatch() {
        this.batchDepth++;
    }

    endBatch(editorElement) {
        if (this.batchDepth > 0) this.batchDepth--;
        if (this.batchDepth === 0 && this.pendingBatchState) {
            if (this.historyPaused) {
                this.pendingBatchState = null;
                return;
            }
            const newState = this.pendingBatchState;
            this.pendingBatchState = null;
            if (this.currentIndex >= 0 && this.history[this.currentIndex]) {
                const lastState = this.history[this.currentIndex];
                if (
                    lastState.code === newState.code &&
                    lastState.selectionStart === newState.selectionStart &&
                    lastState.selectionEnd === newState.selectionEnd
                ) {
                    return;
                }
            }
            if (this.currentIndex < this.history.length - 1) {
                this.history = this.history.slice(0, this.currentIndex + 1);
            }
            this.history.push(newState);
            const effectiveMax = this.isLargeFileMode ? this.largeFileMaxHistory : this.maxHistory;
            if (this.history.length > effectiveMax) {
                this.history.shift();
            } else {
                this.currentIndex++;
            }
            this.updateButtons();
        }
    }

    setLargeFileMode(isLargeFile) {
        this.isLargeFileMode = isLargeFile;
        if (isLargeFile) {
            const effectiveMax = this.largeFileMaxHistory;
            while (this.history.length > effectiveMax) {
                this.history.shift();
                if (this.currentIndex > 0) this.currentIndex--;
            }
        }
        this.updateButtons();
    }

    setPaused(paused) {
        this.historyPaused = paused;
        if (paused) {
            this.pendingBatchState = null;
            this.updateButtons();
        }
    }
}

export let historyManager = null;

export function setHistoryManager(instance) {
    historyManager = instance;
}