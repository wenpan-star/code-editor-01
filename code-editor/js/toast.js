/**
 * ============================================================================
 * toast.js — Toast 顶部滑入提示
 * ============================================================================
 * 版本：v8.0.0
 * 更新日期：2026-09-11
 *
 * 重构说明：
 *   从 v7.7.0 主脚本提取 showToast，保持行为一致：
 *   - 顶部居中滑入
 *   - 2.5 秒后自动消失
 *   - 支持错误样式（红色背景）
 *   - 通过强制回流重新触发动画
 * ============================================================================
 */

import { DOM } from './dom.js';
import { CONFIG } from './config.js';
import { EditorState } from './state.js';

export function showToast(message, isError) {
    if (EditorState.toastTimer) clearTimeout(EditorState.toastTimer);
    DOM.toast.textContent = message;
    DOM.toast.className = isError ? 'toast error' : 'toast';
    void DOM.toast.offsetHeight;
    DOM.toast.classList.add('show');
    EditorState.toastTimer = setTimeout(function() {
        DOM.toast.classList.remove('show');
        EditorState.toastTimer = null;
    }, CONFIG.TOAST_DURATION_MS);
}