/**
 * ============================================================================
 * file-io.js — 文件导入 / 下载 / 拖拽
 * ============================================================================
 *
 * 本模块职责：
 *   1. 导入：读取 ArrayBuffer → BOM 检测 → UTF-8 有效性检测 → 解码 → 设置内容
 *   2. 导出：编码文本 → 优先写入已选目录（File System Access API）
 *           → 否则触发浏览器下载
 *   3. 拖拽：监听 editorWrapper 的 dragover / drop
 *
 * 编码精简：
 *   移除下载流程中的 GB18030 特殊分支（含 getGB18030EncodingMap /
 *   encodeTextToGB18030WithMap 的导入与调用）。下载时统一走
 *   encodeTextToBytes，支持 utf-8 / utf-8-bom / windows-1252。
 *
 * 依赖：
 *   - state.js / config.js / dom.js / toast.js / util.js
 *   - editor-api.js（setEditorContent / switchLanguage / updateFileNameDisplay）
 *   - encoding.js（detectBOMEncoding / isValidUTF8 / decodeTextFromBytes /
 *                  encodeTextToBytes / updateEncodingDisplay /
 *                  updateEncodingStatusOnly）
 *   - storage.js（目录句柄相关）
 * ============================================================================
 */

import { EditorState } from './state.js';
import {
    STORAGE_KEYS,
    ENCODING_DISPLAY_NAMES,
    LANGUAGE_EXTENSIONS,
    MIME_TYPES,
    EXTENSION_LANGUAGE_MAP,
    VALID_TEXT_FILE_EXTENSION_REGEX
} from './config.js';
import { DOM } from './dom.js';
import { showToast } from './toast.js';
import { saveToLocalStorage, loadFromLocalStorage, sanitizeFilename } from './util.js';
import { setEditorContent, switchLanguage, updateFileNameDisplay } from './editor-api.js';
import {
    detectBOMEncoding,
    isValidUTF8,
    decodeTextFromBytes,
    encodeTextToBytes,
    updateEncodingDisplay,
    updateEncodingStatusOnly
} from './encoding.js';
import {
    loadDirectoryHandle,
    saveDirectoryHandle,
    writeFileToDirectory,
    clearDirectoryHandle
} from './storage.js';

// ==================== 导入 ====================

function loadFileIntoEditor(file) {
    if (!file) return;

    const isValidTextFile = (file.type && file.type.startsWith('text/')) || VALID_TEXT_FILE_EXTENSION_REGEX.test(file.name);
    if (!isValidTextFile) {
        showToast('⚠️ 仅支持文本文件', true);
        return;
    }
    if (file.size > EditorState.absoluteFileSizeLimit) {
        showToast('❌ 文件超过 2MB，已阻止加载以避免卡顿', true);
        return;
    }

    const fileReader = new FileReader();
    fileReader.onload = function(loadEvent) {
        const arrayBuffer = loadEvent.target.result;
        const detectedEncoding = detectBOMEncoding(arrayBuffer);
        let finalEncoding = EditorState.currentEncoding;

        if (detectedEncoding) {
            finalEncoding = detectedEncoding;
            updateEncodingDisplay(finalEncoding);
            showToast('📂 检测到编码: ' + ENCODING_DISPLAY_NAMES[finalEncoding]);
        } else if (finalEncoding === 'auto') {
            if (!isValidUTF8(arrayBuffer)) {
                showToast('⚠️ 字节流不是有效的 UTF-8，可能是其他编码（如 Windows-1252），请手动选择', true);
                finalEncoding = 'utf-8';
                updateEncodingStatusOnly(finalEncoding);
            } else {
                finalEncoding = 'utf-8';
                updateEncodingStatusOnly(finalEncoding);
                showToast('📂 未检测到 BOM，默认使用 UTF-8');
            }
        } else {
            updateEncodingStatusOnly(finalEncoding);
        }

        const decodedText = decodeTextFromBytes(arrayBuffer, finalEncoding);
        setEditorContent(decodedText, true);
        updateFileNameDisplay(file.name);

        const fileExtension = file.name.split('.').pop().toLowerCase();
        if (EXTENSION_LANGUAGE_MAP[fileExtension]) {
            switchLanguage(EXTENSION_LANGUAGE_MAP[fileExtension]);
        }
        showToast('📂 已加载 ' + file.name + ' (' + ENCODING_DISPLAY_NAMES[finalEncoding] + ')');
    };
    fileReader.onerror = function() {
        showToast('❌ 文件读取失败', true);
    };
    fileReader.readAsArrayBuffer(file);
}

// ==================== 导入事件绑定 ====================

export function bindImportEvents() {
    DOM.btnImport.addEventListener('click', function() {
        DOM.fileInput.click();
    });

    DOM.fileInput.addEventListener('change', function(event) {
        const selectedFile = event.target.files[0];
        if (!selectedFile) return;
        loadFileIntoEditor(selectedFile);
        DOM.fileInput.value = '';
    });
}

// ==================== 拖拽事件绑定 ====================

export function bindDragAndDropEvents() {
    DOM.editorWrapper.addEventListener('dragover', function(event) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
    });

    DOM.editorWrapper.addEventListener('drop', function(event) {
        event.preventDefault();
        const droppedFile = event.dataTransfer.files[0];
        if (!droppedFile) return;
        loadFileIntoEditor(droppedFile);
    });
}

// ==================== 下载 ====================

async function handleDownloadClick() {
    const currentCode = DOM.codeEditor.value;
    if (!currentCode.trim()) {
        showToast('⚠️ 编辑器为空，无法下载', true);
        return;
    }

    const fileExtension = LANGUAGE_EXTENSIONS[EditorState.currentLanguage] || 'txt';
    const mimeType = MIME_TYPES[EditorState.currentLanguage] || 'text/plain';

    let exportEncoding = EditorState.currentEncoding;
    if (exportEncoding === 'auto') {
        exportEncoding = 'utf-8';
        updateEncodingStatusOnly(exportEncoding);
        showToast('当前为自动检测，导出使用 UTF-8');
    }

    // 统一走 encodeTextToBytes，内部支持 utf-8 / utf-8-bom / windows-1252。
    // 若 exportEncoding 为已移除的编码，会安全降级为 UTF-8。
    const encodedBytes = encodeTextToBytes(currentCode, exportEncoding);

    // ---- 优先使用 File System Access API ----
    if (window.showDirectoryPicker) {
        try {
            let directoryHandle = await loadDirectoryHandle();
            if (!directoryHandle) {
                directoryHandle = await window.showDirectoryPicker({ mode: 'readwrite', startIn: 'documents' });
                await saveDirectoryHandle(directoryHandle);
            }
            const lastFilename = loadFromLocalStorage(STORAGE_KEYS.LAST_DOWNLOAD_FILENAME, 'code');
            const userInputFilename = prompt('请输入文件名（无需后缀）:', lastFilename);
            if (userInputFilename === null) return;
            const safeFilename = sanitizeFilename(userInputFilename);
            if (safeFilename && safeFilename !== 'code' && userInputFilename.trim()) {
                saveToLocalStorage(STORAGE_KEYS.LAST_DOWNLOAD_FILENAME, safeFilename);
            }
            const finalFilename = safeFilename + '.' + fileExtension;
            await writeFileToDirectory(directoryHandle, finalFilename, encodedBytes);
            showToast('💾 已保存 "' + finalFilename + '" 到上次选择的目录 (' + ENCODING_DISPLAY_NAMES[exportEncoding] + ')');
            return;
        } catch (err) {
            if (err.name === 'AbortError') return;
            if (err.name === 'NotAllowedError') {
                showToast('⚠️ 目录权限已失效，已切换为浏览器下载', true);
                try {
                    await clearDirectoryHandle();
                } catch (clearError) {
                    // 忽略
                }
            } else {
                console.error('保存失败:', err);
            }
        }
    }

    // ---- 浏览器下载回退 ----
    const lastFilename = loadFromLocalStorage(STORAGE_KEYS.LAST_DOWNLOAD_FILENAME, 'code');
    const userInputFilename = prompt('请输入文件名（无需后缀）:', lastFilename);
    if (userInputFilename === null) return;
    const safeFilename = sanitizeFilename(userInputFilename);
    if (safeFilename && safeFilename !== 'code' && userInputFilename.trim()) {
        saveToLocalStorage(STORAGE_KEYS.LAST_DOWNLOAD_FILENAME, safeFilename);
    }
    const finalFilename = safeFilename + '.' + fileExtension;
    const blob = new Blob([encodedBytes], { type: mimeType });
    const downloadUrl = URL.createObjectURL(blob);
    const downloadLink = document.createElement('a');
    downloadLink.href = downloadUrl;
    downloadLink.download = finalFilename;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    URL.revokeObjectURL(downloadUrl);
    showToast('💾 已下载 ' + finalFilename + ' (' + ENCODING_DISPLAY_NAMES[exportEncoding] + ')');
}

async function changeSaveDirectory() {
    if (!window.showDirectoryPicker) {
        showToast('⚠️ 您的浏览器不支持目录选择，请使用传统下载', true);
        return;
    }
    try {
        const directoryHandle = await window.showDirectoryPicker({ mode: 'readwrite', startIn: 'documents' });
        await saveDirectoryHandle(directoryHandle);
        showToast('📁 保存位置已更新');
    } catch (err) {
        if (err.name === 'AbortError') return;
        showToast('❌ 更改保存位置失败', true);
    }
}

// ==================== 下载事件绑定 ====================

export function bindDownloadEvents() {
    DOM.btnDownload.addEventListener('click', handleDownloadClick);
    DOM.btnChangeSaveDir.addEventListener('click', changeSaveDirectory);
}