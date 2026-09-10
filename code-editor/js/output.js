/**
 * ============================================================================
 * output.js — 输出面板
 * ============================================================================
 * 版本：v8.0.0
 * 更新日期：2026-09-11
 *
 * 重构说明：
 *   1. 展开 / 收起输出面板
 *   2. 追加 / 批量追加输出行（stdout / stderr / success / info）
 *   3. 更新输出状态文本
 *   4. 缓存 stdin 输入
 * ============================================================================
 */

import { EditorState } from './state.js';
import { STORAGE_KEYS } from './config.js';
import { DOM } from './dom.js';
import { saveToLocalStorage, loadFromLocalStorage } from './util.js';

// ==================== 面板开关 ====================

export function openOutputPanel() {
    DOM.outputPanel.classList.add('open');
    EditorState.outputPanelOpen = true;
    DOM.outputPanel.style.maxHeight = EditorState.outputPanelHeight + 'px';
}

export function closeOutputPanel() {
    DOM.outputPanel.classList.remove('open');
    EditorState.outputPanelOpen = false;
}

export function toggleOutputPanel() {
    if (EditorState.outputPanelOpen) closeOutputPanel();
    else openOutputPanel();
}

// ==================== 输出内容 ====================

export function appendOutputLinesBatch(lines) {
    const placeholder = DOM.outputContent.querySelector('.output-placeholder');
    if (placeholder) placeholder.remove();

    const fragment = document.createDocumentFragment();
    for (const lineData of lines) {
        const lineSpan = document.createElement('span');
        lineSpan.className = lineData.type + '-line';
        lineSpan.textContent = lineData.text;
        fragment.appendChild(lineSpan);
        if (!lineData.text.endsWith('\n')) {
            const newlineSpan = document.createElement('span');
            newlineSpan.textContent = '\n';
            fragment.appendChild(newlineSpan);
        }
    }
    DOM.outputContent.appendChild(fragment);
    DOM.outputContent.scrollTop = DOM.outputContent.scrollHeight;
}

export function appendOutputLine(text, type) {
    appendOutputLinesBatch([{ text: text, type: type }]);
}

export function setOutputStatus(text, color) {
    DOM.outputStatus.textContent = text;
    DOM.outputStatus.style.color = color || 'var(--text-secondary)';
}

// ==================== stdin 缓存 ====================

export function saveStdinCache() {
    saveToLocalStorage(STORAGE_KEYS.STDIN_CACHE, DOM.stdinInput.value);
}

export function restoreStdinCache() {
    DOM.stdinInput.value = loadFromLocalStorage(STORAGE_KEYS.STDIN_CACHE, '');
}

// ==================== 事件绑定 ====================

export function bindOutputEvents() {
    DOM.outputPanelHeader.addEventListener('click', function(event) {
        if (event.target === DOM.btnClearOutput || DOM.btnClearOutput.contains(event.target)) return;
        toggleOutputPanel();
    });

    DOM.btnClearOutput.addEventListener('click', function(event) {
        event.stopPropagation();
        DOM.outputContent.innerHTML = '<span class="output-placeholder">输出已清空</span>';
        DOM.outputStatus.textContent = '就绪';
    });

    DOM.stdinInput.addEventListener('input', saveStdinCache);
}