/**
 * ============================================================================
 * file-io.js — 文件导入 / 下载 / 拖拽 / 自定义文件后缀与历史下拉
 * ============================================================================
 *
 * 本模块职责：
 *   1. 导入：读取 ArrayBuffer → BOM 检测 → UTF-8 有效性检测 → 解码 → 设置内容
 *   2. 导出：编码文本 → 优先写入已选目录（File System Access API）
 *           → 否则触发浏览器下载
 *   3. 拖拽：监听 editorWrapper 的 dragover / drop
 *   4. 自定义文件后缀：读取输入框内容、实时净化、持久化到 localStorage，
 *      下载时优先使用该后缀（留空回退语言默认后缀）。
 *   5. 历史后缀下拉：记录用户输入过的后缀，点击输入框时弹出下拉列表供选择；
 *      按字母排序、自动去重、上限 CONFIG.FILE_EXTENSION_HISTORY_MAX；
 *      输入时按输入值过滤显示。
 *
 * 【v8.3.1 修复（3 处）】
 *   1. initializeFileExtensionInput 增加幂等保护。
 *      增加模块级标志 isFileExtensionInputInitialized，函数开头检查；
 *      重复调用直接返回，避免全局 mousedown 监听器被重复注册。
 *   2. Escape 语义修正。
 *      用户按 Escape 语义为"取消"。新增模块级标志 suppressNextBlurHistory，
 *      Escape 时置为 true，紧随其后的 blur 事件检测该标志后跳过历史写入。
 *   3. 输入时保留下拉，改为按输入值过滤显示。
 *      过滤规则：历史项的小写形式包含输入值的小写形式。
 *      renderFileExtensionDropdown 与 showFileExtensionDropdown 均新增
 *      可选参数 filterText：
 *        - focus / click 时调用 showFileExtensionDropdown()（空过滤）→ 全部显示
 *        - input 时调用 showFileExtensionDropdown(this.value) → 按输入过滤
 *      过滤后为空则隐藏下拉（避免空面板遮挡视线）。
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
    CONFIG,
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

// ==================== 自定义文件后缀：净化与读取 ====================

/**
 * 净化用户输入的文件后缀字符串。
 *
 * 规则：
 *   - 去除首尾空白
 *   - 去除所有前导点号（用户习惯输入 ".txt"，但后缀本身不含点号）
 *   - 移除非字母 / 数字 / 连字符 / 下划线字符
 *   - 统一转小写（避免 "TXT" / "txt" 重复记录）
 *   - 截断到 CONFIG.FILE_EXTENSION_MAX_LENGTH（默认 12）个字符
 *   - 若结果为空字符串，表示"自动"（沿用语言默认后缀）
 */
export function sanitizeFileExtension(extensionText) {
    if (extensionText === null || extensionText === undefined) return '';
    return String(extensionText)
        .trim()
        .replace(/^\.+/, '')
        .replace(/[^A-Za-z0-9_-]/g, '')
        .toLowerCase()
        .slice(0, CONFIG.FILE_EXTENSION_MAX_LENGTH);
}

/**
 * 从输入框读取当前自定义后缀（已净化）。
 * 输入框不存在时返回空字符串（安全降级，不抛错）。
 */
export function getCustomFileExtension() {
    if (!DOM.fileExtensionInput) return '';
    return sanitizeFileExtension(DOM.fileExtensionInput.value);
}

// ==================== 自定义文件后缀：历史记录管理 ====================

/**
 * 读取历史后缀列表。
 *
 * - 从 localStorage 读取原始数组（可能为空、可能包含非法字符）。
 * - 逐项净化、去重、按字母排序。
 * - 若原始数据损坏（非数组），返回空数组。
 *
 * 注意：返回的数组是**全新实例**，调用方可安全修改而不影响存储。
 */
export function loadFileExtensionHistory() {
    const rawHistory = loadFromLocalStorage(STORAGE_KEYS.FILE_EXTENSION_HISTORY, []);
    if (!Array.isArray(rawHistory)) return [];

    const sanitizedSet = new Set();
    for (let i = 0; i < rawHistory.length; i++) {
        const sanitized = sanitizeFileExtension(rawHistory[i]);
        if (sanitized) {
            sanitizedSet.add(sanitized);
        }
    }

    return Array.from(sanitizedSet).sort(function(a, b) {
        // 使用 localeCompare 按字母排序，sensitivity: 'base' 忽略大小写差异，
        // 数字部分按自然顺序排列（例如 'e10' 排在 'e2' 之后）。
        return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
    });
}

/**
 * 将历史后缀列表写回 localStorage。
 * 写回前再次去重、排序、截断到上限。
 */
export function saveFileExtensionHistory(historyArray) {
    if (!Array.isArray(historyArray)) {
        saveToLocalStorage(STORAGE_KEYS.FILE_EXTENSION_HISTORY, []);
        return;
    }

    const sanitizedSet = new Set();
    for (let i = 0; i < historyArray.length; i++) {
        const sanitized = sanitizeFileExtension(historyArray[i]);
        if (sanitized) {
            sanitizedSet.add(sanitized);
        }
    }

    const sortedHistory = Array.from(sanitizedSet).sort(function(a, b) {
        return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
    });

    // 截断到上限；超出部分按字母顺序移除末位。
    const limitedHistory = sortedHistory.slice(0, CONFIG.FILE_EXTENSION_HISTORY_MAX);
    saveToLocalStorage(STORAGE_KEYS.FILE_EXTENSION_HISTORY, limitedHistory);
}

/**
 * 将新的后缀加入历史记录。若已存在则忽略。
 *
 * @param {string} extensionText 用户输入的后缀（未净化也可）
 */
export function addToFileExtensionHistory(extensionText) {
    const sanitized = sanitizeFileExtension(extensionText);
    if (!sanitized) return;

    const currentHistory = loadFileExtensionHistory();
    if (currentHistory.indexOf(sanitized) !== -1) {
        // 已经存在，不重复添加。
        return;
    }
    currentHistory.push(sanitized);
    saveFileExtensionHistory(currentHistory);
}

/**
 * 从历史记录中移除指定后缀。以备将来使用（当前未在 UI 中暴露）。
 */
export function removeFromFileExtensionHistory(extensionText) {
    const sanitized = sanitizeFileExtension(extensionText);
    if (!sanitized) return;

    const currentHistory = loadFileExtensionHistory();
    const filteredHistory = currentHistory.filter(function(item) {
        return item !== sanitized;
    });
    if (filteredHistory.length !== currentHistory.length) {
        saveFileExtensionHistory(filteredHistory);
    }
}

// ==================== 自定义文件后缀：下拉渲染 ====================

/**
 * 渲染历史后缀下拉列表。
 *
 * v8.3.1 变更：新增可选参数 filterText。
 *   - 若 filterText 为 undefined / null / 空字符串：显示全部历史项。
 *   - 否则：仅显示小写形式包含 filterText 小写形式的历史项。
 *   - 过滤后列表为空则隐藏下拉，避免空面板遮挡视线。
 *
 * - 当前输入值对应的选项标记为 .active。
 */
function renderFileExtensionDropdown(filterText) {
    if (!DOM.fileExtensionDropdown) return;

    const historyList = loadFileExtensionHistory();
    const dropdownElement = DOM.fileExtensionDropdown;
    dropdownElement.innerHTML = '';

    // ---- v8.3.1：按输入值过滤 ----
    const normalizedFilter = (typeof filterText === 'string') ? filterText.toLowerCase() : '';
    const filteredHistoryList = normalizedFilter
        ? historyList.filter(function(item) {
            return item.toLowerCase().indexOf(normalizedFilter) !== -1;
        })
        : historyList;

    if (filteredHistoryList.length === 0) {
        dropdownElement.style.display = 'none';
        if (DOM.fileExtensionInput) {
            DOM.fileExtensionInput.setAttribute('aria-expanded', 'false');
        }
        return;
    }

    const currentValue = getCustomFileExtension();

    for (let i = 0; i < filteredHistoryList.length; i++) {
        const extensionValue = filteredHistoryList[i];
        const itemElement = document.createElement('div');
        itemElement.className = 'file-extension-dropdown-item';
        itemElement.textContent = extensionValue;
        itemElement.setAttribute('role', 'option');
        itemElement.setAttribute('data-value', extensionValue);
        if (extensionValue === currentValue) {
            itemElement.classList.add('active');
            itemElement.setAttribute('aria-selected', 'true');
        } else {
            itemElement.setAttribute('aria-selected', 'false');
        }

        // 使用 mousedown 而非 click：
        //   mousedown 早于 blur 触发，且 event.preventDefault() 会阻止输入框失焦，
        //   从而避免"点击选项时下拉框先隐藏、导致 click 丢失"的时序问题。
        itemElement.addEventListener('mousedown', function(event) {
            event.preventDefault();
            const selectedValue = this.getAttribute('data-value') || '';
            if (DOM.fileExtensionInput) {
                DOM.fileExtensionInput.value = selectedValue;
            }
            saveToLocalStorage(STORAGE_KEYS.FILE_EXTENSION, selectedValue);
            updateFileExtensionPlaceholder();
            hideFileExtensionDropdown();
            if (DOM.fileExtensionInput) {
                DOM.fileExtensionInput.focus();
            }
        });

        dropdownElement.appendChild(itemElement);
    }

    dropdownElement.style.display = 'block';
    if (DOM.fileExtensionInput) {
        DOM.fileExtensionInput.setAttribute('aria-expanded', 'true');
    }
}

/**
 * 显示历史后缀下拉列表。
 *
 * v8.3.1 变更：新增可选参数 filterText。
 *   - 不传或传空字符串：显示全部（用于 focus / click）。
 *   - 传输入值：按输入值过滤（用于 input）。
 */
export function showFileExtensionDropdown(filterText) {
    const filter = (typeof filterText === 'string') ? filterText : '';
    renderFileExtensionDropdown(filter);
}

/**
 * 隐藏历史后缀下拉列表。
 */
export function hideFileExtensionDropdown() {
    if (DOM.fileExtensionDropdown) {
        DOM.fileExtensionDropdown.style.display = 'none';
    }
    if (DOM.fileExtensionInput) {
        DOM.fileExtensionInput.setAttribute('aria-expanded', 'false');
    }
}

// ==================== 自定义文件后缀：提示文本 ====================

/**
 * 更新输入框的占位符与提示文本，使其反映当前语言的自动默认后缀。
 * 在任何语言切换后调用（main.js 初始化、ui.js 语言切换事件）。
 */
export function updateFileExtensionPlaceholder() {
    if (!DOM.fileExtensionInput) return;
    const autoExtension = LANGUAGE_EXTENSIONS[EditorState.currentLanguage] || 'txt';
    const customExtension = getCustomFileExtension();
    const hasCustomValue = customExtension !== '';
    DOM.fileExtensionInput.placeholder = autoExtension;
    DOM.fileExtensionInput.title = hasCustomValue
        ? '当前自定义后缀：.' + customExtension + '（清空则按语言自动使用 .' + autoExtension + '；点击输入框可选择历史后缀）'
        : '自定义保存文件后缀，留空则按语言自动使用 .' + autoExtension + '（点击输入框可选择历史后缀）';
}

// ==================== 自定义文件后缀：初始化 ====================

// v8.3.1：幂等保护标志。防止 initializeFileExtensionInput 被重复调用
// 导致全局 mousedown 监听器重复注册。
let isFileExtensionInputInitialized = false;

// v8.3.1：Escape 抑制标志。用户按 Escape 取消编辑时，不应把当前值记入
// 历史（Escape 语义为"取消"，不是"确认"）。keydown 中置为 true，
// blur 事件读取后立即复位。
let suppressNextBlurHistory = false;

/**
 * 初始化自定义文件后缀输入框：
 *   1. 从 localStorage 恢复上次保存的后缀
 *   2. 绑定 input / change / focus / click / blur / keydown 事件
 *   3. 注册全局 mousedown（仅一次）用于点击外部关闭下拉
 *
 * 必须由 main.js 在语言恢复后调用，以便占位符正确反映当前语言。
 *
 * v8.3.1：本函数带幂等保护，重复调用会直接返回。
 */
export function initializeFileExtensionInput() {
    if (!DOM.fileExtensionInput) return;
    if (isFileExtensionInputInitialized) return;
    isFileExtensionInputInitialized = true;

    // ---- 1. 恢复持久化值 ----
    const savedExtension = loadFromLocalStorage(STORAGE_KEYS.FILE_EXTENSION, '');
    const sanitizedSavedExtension = sanitizeFileExtension(savedExtension);
    DOM.fileExtensionInput.value = sanitizedSavedExtension;
    if (sanitizedSavedExtension !== savedExtension) {
        saveToLocalStorage(STORAGE_KEYS.FILE_EXTENSION, sanitizedSavedExtension);
    }

    updateFileExtensionPlaceholder();

    // ---- 2. input 事件：实时净化 + 持久化 + 刷新提示 + 过滤显示下拉 ----
    DOM.fileExtensionInput.addEventListener('input', function() {
        const rawValue = this.value;
        const sanitizedValue = sanitizeFileExtension(rawValue);
        if (rawValue !== sanitizedValue) {
            const cursorPosition = this.selectionStart;
            this.value = sanitizedValue;
            const newCursorPosition = Math.min(cursorPosition, sanitizedValue.length);
            try {
                this.setSelectionRange(newCursorPosition, newCursorPosition);
            } catch (selectionError) {
                // 某些浏览器在 input 事件期间设置选区可能失败，忽略即可
            }
        }
        saveToLocalStorage(STORAGE_KEYS.FILE_EXTENSION, this.value);
        updateFileExtensionPlaceholder();
        // v8.3.1：输入时保留下拉，按输入值过滤显示历史项。
        // 若过滤后为空，renderFileExtensionDropdown 会自动隐藏下拉。
        showFileExtensionDropdown(this.value);
    });

    // ---- 3. change 事件：失焦时再次净化并写入历史 ----
    DOM.fileExtensionInput.addEventListener('change', function() {
        const sanitizedValue = sanitizeFileExtension(this.value);
        if (this.value !== sanitizedValue) {
            this.value = sanitizedValue;
        }
        saveToLocalStorage(STORAGE_KEYS.FILE_EXTENSION, sanitizedValue);
        if (sanitizedValue) {
            addToFileExtensionHistory(sanitizedValue);
        }
        updateFileExtensionPlaceholder();
    });

    // ---- 4. focus / click 事件：弹出全部历史下拉列表 ----
    // 同时绑定 focus 与 click：focus 覆盖键盘 Tab 进入的场景，
    // click 覆盖已聚焦后再次点击输入框的场景。
    // v8.3.1：均不传过滤参数，显示全部历史项。
    DOM.fileExtensionInput.addEventListener('focus', function() {
        showFileExtensionDropdown();
    });
    DOM.fileExtensionInput.addEventListener('click', function() {
        showFileExtensionDropdown();
    });

    // ---- 5. blur 事件：将当前值写入历史，并隐藏下拉 ----
    // v8.3.1：若 suppressNextBlurHistory 标志为 true（用户按了 Escape），
    // 跳过历史写入，直接复位标志并隐藏下拉。
    DOM.fileExtensionInput.addEventListener('blur', function() {
        if (suppressNextBlurHistory) {
            suppressNextBlurHistory = false;
            hideFileExtensionDropdown();
            return;
        }
        const currentValue = sanitizeFileExtension(this.value);
        if (currentValue) {
            addToFileExtensionHistory(currentValue);
        }
        hideFileExtensionDropdown();
    });

    // ---- 6. keydown 事件：Escape 隐藏下拉；Enter 提交并失焦 ----
    DOM.fileExtensionInput.addEventListener('keydown', function(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            // v8.3.1：置位抑制标志，让紧随其后的 blur 跳过历史写入。
            suppressNextBlurHistory = true;
            hideFileExtensionDropdown();
            this.blur();
            return;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            // 主动触发一次 change 逻辑：净化 + 记录历史
            const sanitizedValue = sanitizeFileExtension(this.value);
            if (this.value !== sanitizedValue) {
                this.value = sanitizedValue;
            }
            saveToLocalStorage(STORAGE_KEYS.FILE_EXTENSION, sanitizedValue);
            if (sanitizedValue) {
                addToFileExtensionHistory(sanitizedValue);
            }
            updateFileExtensionPlaceholder();
            this.blur();
            return;
        }
    });

    // ---- 7. 全局 mousedown：点击输入框与下拉列表之外的区域时关闭 ----
    // 由于本函数带幂等保护，此监听器在整个会话中仅注册一次。
    document.addEventListener('mousedown', function(event) {
        if (!DOM.fileExtensionInput) return;
        const wrapperElement = document.getElementById('fileExtensionWrapper');
        if (!wrapperElement) return;
        if (!wrapperElement.contains(event.target)) {
            hideFileExtensionDropdown();
        }
    });
}

// ==================== 下载 ====================

async function handleDownloadClick() {
    const currentCode = DOM.codeEditor.value;
    if (!currentCode.trim()) {
        showToast('⚠️ 编辑器为空，无法下载', true);
        return;
    }

    // ---- 决定使用的文件后缀：自定义优先 ----
    const languageDefaultExtension = LANGUAGE_EXTENSIONS[EditorState.currentLanguage] || 'txt';
    const customExtension = getCustomFileExtension();
    const fileExtension = customExtension || languageDefaultExtension;
    // MIME 自适应：自定义后缀与语言默认后缀一致时沿用语言对应 MIME，
    // 否则使用 text/plain，避免浏览器按错误类型处理文件。
    const mimeType = (fileExtension === languageDefaultExtension)
        ? (MIME_TYPES[EditorState.currentLanguage] || 'text/plain')
        : 'text/plain';

    // 无论是否真的下载，都把当前后缀记入历史，方便下次快速选择。
    if (customExtension) {
        addToFileExtensionHistory(customExtension);
    }

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
            const userInputFilename = prompt('请输入文件名（无需后缀，将自动使用 .' + fileExtension + '）:', lastFilename);
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
    const userInputFilename = prompt('请输入文件名（无需后缀，将自动使用 .' + fileExtension + '）:', lastFilename);
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