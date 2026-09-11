/**
 * ============================================================================
 * file-io.js — 文件导入 / 下载 / 拖拽 / 后缀联动 / 历史下拉
 * ============================================================================
 *
 * 本模块职责：
 *   1. 导入：读取 ArrayBuffer → BOM 检测 → UTF-8 有效性检测 → 解码 → 设置内容
 *   2. 导出：编码文本 → 优先写入已选目录（File System Access API）
 *           → 否则触发浏览器下载
 *   3. 拖拽：监听 editorWrapper 的 dragover / drop
 *   4. 后缀联动：语言切换时后缀自动跟随；前 5 语言默认后缀只读（HTML 可编辑）；
 *      每语言独立保存后缀（EditorState.languageExtensionMap）。
 *   5. 历史下拉：HTML / TXT 语言显示；单击项 = 选择；单击 × = 删除。
 *
 * 【v8.5.6 变更】
 *   清理 suppressNextBlurHistory 死代码。
 *   v8.5.5 已将历史记录入口统一到 change 事件；blur 事件不再调用
 *   addToFileExtensionHistory。此时 suppressNextBlurHistory 标志的检查
 *   已无意义——两个分支都只调用 hideFileExtensionDropdown()。
 *   本版删除：
 *     - 模块级变量 suppressNextBlurHistory 声明；
 *     - blur 事件中的标志检查分支；
 *     - keydown Escape 分支中的标志置位语句。
 *   对外行为完全一致。
 *
 * 【v8.5.5 保留】
 *   1. 导入文件后后缀自动跟随语言：由 editor-api.js 的 switchLanguage
 *      内部回调自动处理（无需本模块改动）。
 *   2. updateFileExtensionPlaceholder 的 HTML 分支 title 更新为
 *      反映"可点击选择历史后缀"。
 *   3. blur 事件移除 addToFileExtensionHistory 调用，避免 HTML 默认值
 *      'html' 在用户仅聚焦后失焦时被误加入历史。
 *
 * 【v8.5.4 修复】
 *   空字符串旧 FILE_EXTENSION 键清理：改用 localStorage.getItem(...) !== null
 *   判断键的存在性，无论值是否为空，只要键存在即执行迁移与清理。
 *
 * 【v8.5.1 保留修复】
 *   移除死代码 persistCurrentLanguageExtension。
 *
 * 【v8.5.0 保留】
 *   - 语言切换自动跟随后缀（JS→js / HTML→html / CSS→css / PY→py / JV→java / TXT→自由）
 *   - 前 5 语言后缀只读（HTML 除外）
 *   - 新增 TXT 语言（纯文本模式）
 *   - 历史下拉显示于 HTML / TXT 语言
 *   - 每语言独立保存后缀
 *   - 移除右键菜单，改用下拉项右侧 × 删除按钮
 *   - 旧数据兼容：v8.4.1 的 editor-file-extension-v8 单一值迁移为 TXT 初始后缀
 *
 * 【v8.4.x 及更早保留】
 *   - showDirectoryPicker 自动使用上次保存目录作为 startIn
 *   - 输入净化 / initializeFileExtensionInput 幂等保护
 *   - IndexedDB 连接在 finally 中关闭
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
    AUTO_EXTENSION_BY_LANGUAGE,
    LANGUAGE_ALLOW_CUSTOM_EXTENSION,
    LANGUAGE_SHOW_HISTORY_DROPDOWN,
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
    clearDirectoryHandle,
    loadDirectoryHandleForStartIn
} from './storage.js';

// ==================== 模块级标志 ====================

// 输入净化标志：程序化修改 value 期间置位，防止二次 input 事件重复处理。
let isSanitizingFileExtension = false;

// 幂等保护标志：防止 initializeFileExtensionInput 被重复调用。
let isFileExtensionInputInitialized = false;

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
            // v8.5.5：switchLanguage 内部已通过回调自动调用
            // updateFileExtensionForLanguage，后缀框会自动跟随语言。
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

// ==================== 后缀：净化与读取 ====================

/**
 * 净化后缀字符串。
 *   - 去除首尾空白
 *   - 去除所有前导点号
 *   - 移除非字母 / 数字 / 连字符 / 下划线字符
 *   - 统一转小写
 *   - 截断到 CONFIG.FILE_EXTENSION_MAX_LENGTH
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
 * 从输入框读取当前后缀（已净化）。
 */
export function getCustomFileExtension() {
    if (!DOM.fileExtensionInput) return '';
    return sanitizeFileExtension(DOM.fileExtensionInput.value);
}

// ==================== 后缀：历史记录管理 ====================

/**
 * 读取历史后缀列表。
 * 从 localStorage 读取原始数组，逐项净化、去重、按字母排序。
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
        return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
    });
}

/**
 * 将历史后缀列表写回 localStorage。
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

    const limitedHistory = sortedHistory.slice(0, CONFIG.FILE_EXTENSION_HISTORY_MAX);
    saveToLocalStorage(STORAGE_KEYS.FILE_EXTENSION_HISTORY, limitedHistory);
}

/**
 * 将新后缀加入历史记录。若已存在则忽略。
 */
export function addToFileExtensionHistory(extensionText) {
    const sanitized = sanitizeFileExtension(extensionText);
    if (!sanitized) return;

    const currentHistory = loadFileExtensionHistory();
    if (currentHistory.indexOf(sanitized) !== -1) {
        return;
    }
    currentHistory.push(sanitized);
    saveFileExtensionHistory(currentHistory);
}

/**
 * 从历史记录中移除指定后缀。
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

// ==================== 后缀：语言切换联动 ====================

/**
 * 语言切换时更新后缀框。
 *
 * 逻辑：
 *   1. 读取 EditorState.languageExtensionMap[language]；
 *      若未定义，使用 AUTO_EXTENSION_BY_LANGUAGE[language] 作为初值。
 *   2. 净化该值。
 *   3. 应用到输入框。
 *   4. 根据 LANGUAGE_ALLOW_CUSTOM_EXTENSION 设置 readOnly。
 *   5. 刷新 placeholder / title。
 *   6. 隐藏历史下拉（语言切换后不应保持打开）。
 *   7. 持久化映射。
 *
 * v8.5.5：由 editor-api.js 的 switchLanguage 通过回调自动调用，
 *         无需在调用方（ui.js / file-io.js）显式触发。
 */
export function updateFileExtensionForLanguage(language) {
    if (!DOM.fileExtensionInput) return;

    if (!EditorState.languageExtensionMap || typeof EditorState.languageExtensionMap !== 'object') {
        EditorState.languageExtensionMap = {};
    }

    // 若该语言无记录，用默认值
    if (EditorState.languageExtensionMap[language] === undefined) {
        EditorState.languageExtensionMap[language] = AUTO_EXTENSION_BY_LANGUAGE[language] || '';
    }

    // 净化（防止历史遗留非法值）
    const sanitizedValue = sanitizeFileExtension(EditorState.languageExtensionMap[language]);
    EditorState.languageExtensionMap[language] = sanitizedValue;

    // 应用到输入框
    DOM.fileExtensionInput.value = sanitizedValue;

    // 更新 readOnly（用 readOnly 而非 disabled，保留视觉与 hover 反馈）
    const allowCustom = LANGUAGE_ALLOW_CUSTOM_EXTENSION[language] === true;
    DOM.fileExtensionInput.readOnly = !allowCustom;

    // 刷新提示
    updateFileExtensionPlaceholder();

    // 隐藏历史下拉
    hideFileExtensionDropdown();

    // 持久化映射
    saveToLocalStorage(STORAGE_KEYS.LANGUAGE_EXTENSION_MAP, EditorState.languageExtensionMap);
}

// ==================== 后缀：下拉渲染（× 删除按钮） ====================

/**
 * 渲染历史后缀下拉列表。
 *
 * - 仅当 LANGUAGE_SHOW_HISTORY_DROPDOWN[currentLanguage] 为 true 时渲染。
 * - filterText 用于按输入过滤（小写包含匹配）。
 * - 每项结构：<span class="file-extension-dropdown-item-text">value</span>
 *             <span class="file-extension-dropdown-item-delete">×</span>
 * - 单击项 = 选择；单击 × = 删除。
 */
function renderFileExtensionDropdown(filterText) {
    if (!DOM.fileExtensionDropdown) return;

    // 仅允许显示历史下拉的语言才渲染（v8.5.5：HTML / TXT 都允许）
    const currentLang = EditorState.currentLanguage;
    if (!LANGUAGE_SHOW_HISTORY_DROPDOWN[currentLang]) {
        DOM.fileExtensionDropdown.style.display = 'none';
        if (DOM.fileExtensionInput) {
            DOM.fileExtensionInput.setAttribute('aria-expanded', 'false');
        }
        return;
    }

    const historyList = loadFileExtensionHistory();
    const dropdownElement = DOM.fileExtensionDropdown;
    dropdownElement.innerHTML = '';

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
        itemElement.setAttribute('role', 'option');
        itemElement.setAttribute('data-value', extensionValue);

        // 文本部分
        const textElement = document.createElement('span');
        textElement.className = 'file-extension-dropdown-item-text';
        textElement.textContent = extensionValue;
        itemElement.appendChild(textElement);

        // × 删除按钮
        const deleteButtonElement = document.createElement('span');
        deleteButtonElement.className = 'file-extension-dropdown-item-delete';
        deleteButtonElement.textContent = '×';
        deleteButtonElement.title = '删除该历史后缀';
        deleteButtonElement.addEventListener('mousedown', function(event) {
            // 用 mousedown 而非 click：避免与项自身的 mousedown 冲突。
            event.preventDefault();
            event.stopPropagation();
            removeFromFileExtensionHistory(extensionValue);
            // 刷新下拉，保持输入框当前值的过滤状态
            const currentInputValue = DOM.fileExtensionInput ? DOM.fileExtensionInput.value : '';
            showFileExtensionDropdown(currentInputValue);
        });
        itemElement.appendChild(deleteButtonElement);

        if (extensionValue === currentValue) {
            itemElement.classList.add('active');
            itemElement.setAttribute('aria-selected', 'true');
        } else {
            itemElement.setAttribute('aria-selected', 'false');
        }

        // 项本身的点击（选择）
        itemElement.addEventListener('mousedown', function(event) {
            // 若点击目标是 × 按钮，忽略（已由 × 按钮的 mousedown 处理）
            if (event.target === deleteButtonElement) return;

            event.preventDefault();
            event.stopPropagation();
            const selectedValue = this.getAttribute('data-value') || '';
            if (DOM.fileExtensionInput) {
                DOM.fileExtensionInput.value = selectedValue;
                DOM.fileExtensionInput.focus();
            }
            // 同步到 map
            if (!EditorState.languageExtensionMap || typeof EditorState.languageExtensionMap !== 'object') {
                EditorState.languageExtensionMap = {};
            }
            EditorState.languageExtensionMap[EditorState.currentLanguage] = selectedValue;
            saveToLocalStorage(STORAGE_KEYS.LANGUAGE_EXTENSION_MAP, EditorState.languageExtensionMap);
            updateFileExtensionPlaceholder();
            hideFileExtensionDropdown();
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
 * 前置条件：当前语言允许显示历史下拉（内部会二次检查）。
 */
export function showFileExtensionDropdown(filterText) {
    if (!DOM.fileExtensionInput) return;
    const currentLang = EditorState.currentLanguage;
    if (!LANGUAGE_SHOW_HISTORY_DROPDOWN[currentLang]) {
        hideFileExtensionDropdown();
        return;
    }
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

// ==================== 后缀：提示文本 ====================

/**
 * 更新输入框的 placeholder 与 title，使其反映当前语言的可用性。
 *
 * v8.5.5：HTML 的 title 更新为反映"可点击选择历史后缀"，
 *         与 HTML 现在支持历史下拉的新行为保持一致。
 */
export function updateFileExtensionPlaceholder() {
    if (!DOM.fileExtensionInput) return;
    const currentLang = EditorState.currentLanguage;
    const autoExtension = AUTO_EXTENSION_BY_LANGUAGE[currentLang] || '';
    const allowCustom = LANGUAGE_ALLOW_CUSTOM_EXTENSION[currentLang] === true;
    const showHistory = LANGUAGE_SHOW_HISTORY_DROPDOWN[currentLang] === true;

    if (!allowCustom) {
        // JS / CSS / PY / JV：后缀固定只读
        DOM.fileExtensionInput.placeholder = autoExtension;
        DOM.fileExtensionInput.title = '当前语言后缀固定为 .' + autoExtension;
    } else if (currentLang === 'txt') {
        // TXT：自由输入 + 历史下拉
        DOM.fileExtensionInput.placeholder = '后缀';
        DOM.fileExtensionInput.title = '输入自定义后缀（回车 / 失焦后记入历史；点击可选择历史后缀）';
    } else {
        // HTML：默认 html 但可修改；v8.5.5 起也支持历史下拉
        DOM.fileExtensionInput.placeholder = autoExtension;
        DOM.fileExtensionInput.title = showHistory
            ? '默认 .' + autoExtension + '（可修改；点击可选择历史后缀）'
            : '默认 .' + autoExtension + '（可修改）';
    }
}

// ==================== 后缀：初始化 ====================

/**
 * 初始化自定义文件后缀输入框。
 *
 * 步骤：
 *   1. 从 localStorage 恢复 languageExtensionMap。
 *   2. 兼容 v8.4.1：将 FILE_EXTENSION 单一值迁移为 TXT 语言的初始值。
 *      v8.5.4：检测「键是否存在」而非「值是否非空」，空字符串旧值也清理。
 *   3. 补齐所有语言的初始值。
 *   4. 应用到输入框（通过 updateFileExtensionForLanguage）。
 *   5. 绑定 input / change / focus / click / blur / keydown 事件。
 *   6. 注册全局 mousedown / keydown 用于外部点击关闭。
 *
 * 幂等保护：重复调用直接返回。
 */
export function initializeFileExtensionInput() {
    if (!DOM.fileExtensionInput) return;
    if (isFileExtensionInputInitialized) return;
    isFileExtensionInputInitialized = true;

    // ---- 1. 恢复映射 ----
    const savedMap = loadFromLocalStorage(STORAGE_KEYS.LANGUAGE_EXTENSION_MAP, null);
    if (savedMap && typeof savedMap === 'object' && !Array.isArray(savedMap)) {
        EditorState.languageExtensionMap = savedMap;
    } else {
        EditorState.languageExtensionMap = {};
    }

    // ---- 2. 兼容 v8.4.1：将单一后缀值迁移为 TXT 语言的初始值 ----
    // v8.5.4：改用 localStorage.getItem(...) !== null 判断「键的存在性」，
    //          与值的语义解耦 —— 无论旧值是否为空字符串，只要键存在即
    //          执行迁移与清理，避免空字符串场景下遗留 localStorage 键。
    let oldFileExtensionKeyExists = false;
    try {
        oldFileExtensionKeyExists = localStorage.getItem(STORAGE_KEYS.FILE_EXTENSION) !== null;
    } catch (readError) {
        // localStorage 不可用时静默忽略（键视为不存在）
    }
    if (oldFileExtensionKeyExists) {
        // 迁移：仅当旧值非空且 TXT 尚未记录时才写入。
        const oldSingleExtension = loadFromLocalStorage(STORAGE_KEYS.FILE_EXTENSION, '');
        if (oldSingleExtension && !EditorState.languageExtensionMap.txt) {
            const sanitizedOld = sanitizeFileExtension(oldSingleExtension);
            if (sanitizedOld) {
                EditorState.languageExtensionMap.txt = sanitizedOld;
            }
        }
        // 清理旧键（无论值是否为空字符串）。
        try {
            localStorage.removeItem(STORAGE_KEYS.FILE_EXTENSION);
        } catch (removeError) {
            // localStorage 不可用时静默忽略
        }
    }

    // ---- 3. 补齐所有语言 ----
    const allLanguages = ['js', 'html', 'css', 'python', 'java', 'txt'];
    for (let i = 0; i < allLanguages.length; i++) {
        const lang = allLanguages[i];
        if (EditorState.languageExtensionMap[lang] === undefined) {
            EditorState.languageExtensionMap[lang] = AUTO_EXTENSION_BY_LANGUAGE[lang] || '';
        }
    }

    // ---- 4. 应用到输入框 ----
    updateFileExtensionForLanguage(EditorState.currentLanguage);

    // ---- 5. input 事件 ----
    DOM.fileExtensionInput.addEventListener('input', function() {
        if (isSanitizingFileExtension) return;

        const rawValue = this.value;
        const sanitizedValue = sanitizeFileExtension(rawValue);
        if (rawValue !== sanitizedValue) {
            // 精确计算光标位置（对「光标前子串」独立净化）
            const cursorPosition = this.selectionStart;
            const rawBeforeCursor = rawValue.slice(0, cursorPosition);
            const sanitizedBeforeCursor = sanitizeFileExtension(rawBeforeCursor);
            const newCursorPosition = sanitizedBeforeCursor.length;

            isSanitizingFileExtension = true;
            try {
                this.value = sanitizedValue;
                try {
                    this.setSelectionRange(newCursorPosition, newCursorPosition);
                } catch (selectionError) {
                    // 忽略
                }
            } finally {
                isSanitizingFileExtension = false;
            }
        }

        // 更新 map
        if (!EditorState.languageExtensionMap || typeof EditorState.languageExtensionMap !== 'object') {
            EditorState.languageExtensionMap = {};
        }
        EditorState.languageExtensionMap[EditorState.currentLanguage] = this.value;
        saveToLocalStorage(STORAGE_KEYS.LANGUAGE_EXTENSION_MAP, EditorState.languageExtensionMap);

        updateFileExtensionPlaceholder();

        // HTML / TXT 语言显示历史下拉
        if (LANGUAGE_SHOW_HISTORY_DROPDOWN[EditorState.currentLanguage]) {
            showFileExtensionDropdown(this.value);
        }
    });

    // ---- 6. change 事件 ----
    // v8.5.5：历史记录**唯一**入口（enter 键也作为补充入口）。
    // 该事件在用户修改后缀且随后失焦时触发，此时才视为"使用了该后缀"。
    DOM.fileExtensionInput.addEventListener('change', function() {
        const sanitizedValue = sanitizeFileExtension(this.value);
        if (this.value !== sanitizedValue) {
            this.value = sanitizedValue;
        }
        if (!EditorState.languageExtensionMap || typeof EditorState.languageExtensionMap !== 'object') {
            EditorState.languageExtensionMap = {};
        }
        EditorState.languageExtensionMap[EditorState.currentLanguage] = sanitizedValue;
        saveToLocalStorage(STORAGE_KEYS.LANGUAGE_EXTENSION_MAP, EditorState.languageExtensionMap);

        // HTML / TXT 语言把后缀写入历史
        if (LANGUAGE_SHOW_HISTORY_DROPDOWN[EditorState.currentLanguage] && sanitizedValue) {
            addToFileExtensionHistory(sanitizedValue);
        }
        updateFileExtensionPlaceholder();
    });

    // ---- 7. focus / click ----
    DOM.fileExtensionInput.addEventListener('focus', function() {
        if (LANGUAGE_SHOW_HISTORY_DROPDOWN[EditorState.currentLanguage]) {
            showFileExtensionDropdown();
        }
    });
    DOM.fileExtensionInput.addEventListener('click', function() {
        if (LANGUAGE_SHOW_HISTORY_DROPDOWN[EditorState.currentLanguage]) {
            showFileExtensionDropdown();
        }
    });

    // ---- 8. blur ----
    // v8.5.6：简化为仅隐藏下拉。
    //   v8.5.5 已移除此处的 addToFileExtensionHistory 调用，历史记录
    //   由 change 事件与 Enter 键统一负责。suppressNextBlurHistory 标志
    //   因两个分支行为一致而失去意义，本版一并清理。
    DOM.fileExtensionInput.addEventListener('blur', function() {
        hideFileExtensionDropdown();
    });

    // ---- 9. keydown ----
    DOM.fileExtensionInput.addEventListener('keydown', function(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            // v8.5.6：无需再置位 suppressNextBlurHistory 标志。
            hideFileExtensionDropdown();
            this.blur();
            return;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            const sanitizedValue = sanitizeFileExtension(this.value);
            if (this.value !== sanitizedValue) {
                this.value = sanitizedValue;
            }
            if (!EditorState.languageExtensionMap || typeof EditorState.languageExtensionMap !== 'object') {
                EditorState.languageExtensionMap = {};
            }
            EditorState.languageExtensionMap[EditorState.currentLanguage] = sanitizedValue;
            saveToLocalStorage(STORAGE_KEYS.LANGUAGE_EXTENSION_MAP, EditorState.languageExtensionMap);

            if (LANGUAGE_SHOW_HISTORY_DROPDOWN[EditorState.currentLanguage] && sanitizedValue) {
                addToFileExtensionHistory(sanitizedValue);
            }
            updateFileExtensionPlaceholder();
            this.blur();
            return;
        }
    });

    // ---- 10. 全局 mousedown ----
    document.addEventListener('mousedown', function(event) {
        if (!DOM.fileExtensionInput) return;
        const wrapperElement = document.getElementById('fileExtensionWrapper');
        if (!wrapperElement) return;
        if (!wrapperElement.contains(event.target)) {
            hideFileExtensionDropdown();
        }
    });

    // ---- 11. 全局 keydown（Escape 关闭下拉） ----
    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape') {
            if (DOM.fileExtensionDropdown && DOM.fileExtensionDropdown.style.display !== 'none') {
                hideFileExtensionDropdown();
            }
        }
    });
}

// ==================== 目录选择辅助 ====================

/**
 * 封装 window.showDirectoryPicker，自动使用上次保存的目录句柄作为 startIn。
 *
 * 逻辑：
 *   1. 尝试通过 loadDirectoryHandleForStartIn() 读取上次保存的目录句柄
 *      （不做权限检查，仅取路径信息）。
 *   2. 若读取成功且句柄非空，则使用该句柄作为 startIn；
 *      否则回退到 'documents'。
 *   3. 调用 window.showDirectoryPicker。
 *   4. 若调用因句柄问题抛错（非用户主动取消 AbortError），
 *      自动重试一次并使用 'documents' 作为起始位置。
 *
 * 返回：
 *   - Promise<FileSystemDirectoryHandle>：用户选择的目录句柄
 *   - 若用户取消则抛出 AbortError（与原生一致）
 *   - 若其他错误则抛出原始错误
 */
async function showDirectoryPickerWithLastPosition(pickerMode) {
    const pickerOptions = { mode: pickerMode };
    try {
        const lastDirectoryHandle = await loadDirectoryHandleForStartIn();
        if (lastDirectoryHandle) {
            pickerOptions.startIn = lastDirectoryHandle;
        } else {
            pickerOptions.startIn = 'documents';
        }
    } catch (loadError) {
        pickerOptions.startIn = 'documents';
    }

    try {
        return await window.showDirectoryPicker(pickerOptions);
    } catch (firstError) {
        if (firstError && firstError.name === 'AbortError') {
            throw firstError;
        }
        if (pickerOptions.startIn !== 'documents') {
            try {
                return await window.showDirectoryPicker({ mode: pickerMode, startIn: 'documents' });
            } catch (secondError) {
                throw secondError;
            }
        }
        throw firstError;
    }
}

// ==================== 下载 ====================

async function handleDownloadClick() {
    const currentCode = DOM.codeEditor.value;
    if (!currentCode.trim()) {
        showToast('⚠️ 编辑器为空，无法下载', true);
        return;
    }

    // 决定使用的文件后缀：优先使用输入框的当前值（已跟随语言）
    const languageDefaultExtension = LANGUAGE_EXTENSIONS[EditorState.currentLanguage] || 'txt';
    let fileExtension = getCustomFileExtension();
    if (!fileExtension) {
        fileExtension = languageDefaultExtension;
    }
    const mimeType = (fileExtension === languageDefaultExtension)
        ? (MIME_TYPES[EditorState.currentLanguage] || 'text/plain')
        : 'text/plain';

    // HTML / TXT 语言把当前值作为历史写入
    if (LANGUAGE_SHOW_HISTORY_DROPDOWN[EditorState.currentLanguage] && fileExtension) {
        addToFileExtensionHistory(fileExtension);
    }

    let exportEncoding = EditorState.currentEncoding;
    if (exportEncoding === 'auto') {
        exportEncoding = 'utf-8';
        updateEncodingStatusOnly(exportEncoding);
        showToast('当前为自动检测，导出使用 UTF-8');
    }

    const encodedBytes = encodeTextToBytes(currentCode, exportEncoding);

    if (window.showDirectoryPicker) {
        try {
            let directoryHandle = await loadDirectoryHandle();
            if (!directoryHandle) {
                directoryHandle = await showDirectoryPickerWithLastPosition('readwrite');
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
        const directoryHandle = await showDirectoryPickerWithLastPosition('readwrite');
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