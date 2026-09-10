/**
 * ============================================================================
 * java-runner.js — Java 编译运行（Piston API）
 * ============================================================================
 * 版本：v8.0.2（深度审核修复版）
 * 更新日期：2026-09-11
 *
 * 重构说明：
 *   通过 https://emkc.org/api/v2/piston/execute 编译并运行 Java 代码。
 *   支持 stdin / Java 版本选择 / 30 秒超时 / AbortController 中断控制。
 *
 * v8.0.2 修复（问题 8）：
 *   timeoutId 的 clearTimeout 从 try 块中移到 finally，确保 fetch 抛错时
 *   定时器也会被清理。原实现若 fetch 立即抛错（例如 DNS 解析失败、
 *   网络离线），clearTimeout 不会执行，30 秒后 AbortController 仍会被再次
 *   abort（虽然无副作用，但属于定时器泄漏）。本版修正。
 * ============================================================================
 */

import { EditorState } from './state.js';
import { CONFIG } from './config.js';
import { DOM } from './dom.js';
import { showToast } from './toast.js';
import { updateRunButtonState } from './editor-api.js';
import {
    openOutputPanel,
    appendOutputLinesBatch,
    setOutputStatus
} from './output.js';

// ==================== 类名提取 ====================

export function extractJavaClassName(code) {
    const publicClassMatch = code.match(/public\s+class\s+([A-Za-z_$][\w$]*)/);
    if (publicClassMatch && publicClassMatch[1]) return publicClassMatch[1];
    const classMatch = code.match(/\bclass\s+([A-Za-z_$][\w$]*)/);
    if (classMatch && classMatch[1]) return classMatch[1];
    return 'Main';
}

// ==================== 主流程 ====================

export async function runJavaCode() {
    if (EditorState.isRunning) {
        showToast('⚠️ 代码正在运行中，请稍候', true);
        return;
    }
    if (EditorState.currentLanguage !== 'java') {
        showToast('⚠️ 仅支持运行 Java 代码', true);
        return;
    }
    const javaCode = DOM.codeEditor.value;
    if (!javaCode.trim()) {
        showToast('⚠️ 编辑器为空，无法运行', true);
        return;
    }
    if (!javaCode.match(/public\s+static\s+void\s+main\s*\(\s*String\s*\[\s*\]\s*\w+\s*\)/)) {
        if (!confirm('代码中未找到 main 方法，可能无法运行。是否继续尝试？')) return;
    }

    const className = extractJavaClassName(javaCode);
    if (className !== 'Main') {
        if (!confirm('检测到主类名为 "' + className + '"，Piston API 可能需要类名为 "Main"。是否仍然尝试运行？')) return;
    }

    const fileName = className + '.java';
    const javaVersion = EditorState.javaVersion;

    EditorState.isRunning = true;
    updateRunButtonState();
    DOM.btnRun.classList.add('running');
    DOM.btnRun.querySelector('span').textContent = '运行中...';
    openOutputPanel();
    setOutputStatus('编译运行中...', 'var(--accent)');
    DOM.outputContent.innerHTML = '<span class="info-line">⏳ 正在编译并运行 Java 代码 (版本 ' + javaVersion + ')...</span>\n';
    DOM.outputContent.scrollTop = DOM.outputContent.scrollHeight;

    const stdinData = DOM.stdinInput.value;
    const startTime = performance.now();

    // v8.0.2 修复（问题 8）：timeoutId 在 try 外声明，finally 中统一清理。
    let timeoutId = null;

    try {
        const controller = new AbortController();
        EditorState.runAbortController = controller;
        timeoutId = setTimeout(function() {
            controller.abort();
        }, CONFIG.JAVA_RUN_TIMEOUT_MS);

        const response = await fetch('https://emkc.org/api/v2/piston/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                language: 'java',
                version: javaVersion,
                files: [{ name: fileName, content: javaCode }],
                stdin: stdinData,
                args: [],
                compile_timeout: 15000,
                run_timeout: 10000,
                compile_memory_limit: -1,
                run_memory_limit: -1
            }),
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error('API 请求失败: HTTP ' + response.status);
        }

        const result = await response.json();
        const elapsedTime = ((performance.now() - startTime) / 1000).toFixed(2);

        DOM.outputContent.innerHTML = '';
        const outputLinesBatch = [];

        if (result.compile && result.compile.code !== 0) {
            outputLinesBatch.push({ text: '❌ 编译错误 (Exit Code: ' + result.compile.code + ')', type: 'stderr' });
            if (result.compile.stderr) outputLinesBatch.push({ text: result.compile.stderr, type: 'stderr' });
            if (result.compile.stdout) outputLinesBatch.push({ text: result.compile.stdout, type: 'stdout' });
            appendOutputLinesBatch(outputLinesBatch);
            setOutputStatus('编译失败 (' + elapsedTime + 's)', 'var(--red)');
            showToast('❌ 编译失败', true);
            return;
        }

        if (result.compile) {
            outputLinesBatch.push({ text: '✅ 编译成功 (' + elapsedTime + 's)', type: 'success' });
            if (result.compile.stderr) outputLinesBatch.push({ text: result.compile.stderr, type: 'stderr' });
        }

        if (result.run) {
            if (result.run.stdout) {
                const stdoutLines = result.run.stdout.split('\n');
                for (let i = 0; i < stdoutLines.length; i++) {
                    if (stdoutLines[i] || i < stdoutLines.length - 1) {
                        outputLinesBatch.push({ text: stdoutLines[i], type: 'stdout' });
                    }
                }
            }
            if (result.run.stderr) {
                const stderrLines = result.run.stderr.split('\n');
                for (let i = 0; i < stderrLines.length; i++) {
                    if (stderrLines[i] || i < stderrLines.length - 1) {
                        outputLinesBatch.push({ text: stderrLines[i], type: 'stderr' });
                    }
                }
            }
            if (result.run.code === 0) {
                outputLinesBatch.push({ text: '✅ 程序正常退出 (Exit Code: 0)', type: 'success' });
                setOutputStatus('运行完成 (' + elapsedTime + 's)', 'var(--green)');
                showToast('✅ Java 程序运行完成');
            } else {
                outputLinesBatch.push({ text: '❌ 程序异常退出 (Exit Code: ' + result.run.code + ')', type: 'stderr' });
                if (result.run.signal) {
                    outputLinesBatch.push({ text: 'Signal: ' + result.run.signal, type: 'stderr' });
                }
                setOutputStatus('运行失败 (' + elapsedTime + 's)', 'var(--red)');
                showToast('❌ 程序运行出错', true);
            }
        } else {
            outputLinesBatch.push({ text: '⚠️ 没有运行输出', type: 'info' });
            setOutputStatus('无输出 (' + elapsedTime + 's)', 'var(--text-secondary)');
        }
        appendOutputLinesBatch(outputLinesBatch);

    } catch (error) {
        DOM.outputContent.innerHTML = '';
        const errorLinesBatch = [];
        if (error.name === 'AbortError') {
            errorLinesBatch.push({ text: '⏱️ 请求超时（超过 30 秒）', type: 'stderr' });
            setOutputStatus('请求超时', 'var(--red)');
            showToast('⏱️ 请求超时', true);
        } else if (error.message && error.message.includes('Failed to fetch')) {
            errorLinesBatch.push({ text: '🌐 网络错误：无法连接到 Piston API 服务器', type: 'stderr' });
            errorLinesBatch.push({ text: '请检查网络连接后重试', type: 'info' });
            setOutputStatus('网络错误', 'var(--red)');
            showToast('🌐 网络连接失败', true);
        } else if (error.message && error.message.includes('API 请求失败')) {
            errorLinesBatch.push({ text: '❌ ' + error.message, type: 'stderr' });
            errorLinesBatch.push({ text: 'Piston API 可能暂时不可用，请稍后重试', type: 'info' });
            setOutputStatus('API 错误', 'var(--red)');
            showToast('❌ API 请求失败', true);
        } else {
            errorLinesBatch.push({ text: '❌ 未知错误: ' + (error.message || error), type: 'stderr' });
            setOutputStatus('错误', 'var(--red)');
            showToast('❌ 运行出错', true);
        }
        appendOutputLinesBatch(errorLinesBatch);
        DOM.outputContent.scrollTop = DOM.outputContent.scrollHeight;
    } finally {
        // v8.0.2 修复（问题 8）：无论成功、失败还是抛错，都清理超时定时器。
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
        EditorState.isRunning = false;
        EditorState.runAbortController = null;
        DOM.btnRun.classList.remove('running');
        DOM.btnRun.querySelector('span').textContent = '运行';
        updateRunButtonState();
    }
}

// ==================== 运行按钮绑定 ====================

export function bindRunButton() {
    DOM.btnRun.addEventListener('click', function() {
        if (EditorState.currentLanguage === 'java') {
            runJavaCode();
        } else {
            showToast('⚠️ 仅 Java 语言支持编译运行', true);
        }
    });
}