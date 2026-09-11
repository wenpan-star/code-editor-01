/**
 * ============================================================================
 * settings-io.js — 设置导出 / 导入
 * ============================================================================
 *
 * 一键将编辑器所有持久化设置导出为 JSON 文件，或从 JSON 文件恢复。
 *
 * 【v8.6.1 更新】
 *   导入成功后置位 EditorState.skipBeforeUnload = true，
 *   让 ui.js 的 beforeunload 处理器放行 location.reload()，
 *   避免"用户已同意 → 又弹原生确认框"的二次确认体验问题。
 *
 * 【v8.6.0 基础能力】
 *   · 绕过 saveToLocalStorage 静默吞错，直接操作 localStorage 并
 *     逐项写入 + 回读双重校验
 *   · 文件大小限制（≤ 5MB），避免大文件 readAsText 爆内存
 *   · UTF-8 BOM 剥离，兼容 Windows 记事本保存的 JSON
 *   · 通过 DOM.settingsIOWrapper 显式 id 判定外部点击
 *   · setupSettingsIOEvents 幂等保护
 *   · 逐项类型 / 范围校验（SETTINGS_VALUE_VALIDATORS）
 *   · 更严格的 _meta 校验
 *   · 键盘可访问性（↓ / Enter / Space / ↑↓ / Escape / Tab）
 *   · 导入覆盖确认 + 未保存代码提醒
 *   · 文件名时间戳 YYYYMMDD-HHMMSS
 *   · iOS 触屏兼容（pointerdown）
 *   · 全失败不刷新
 *
 * 导出覆盖范围（全部来源于 localStorage）：
 *   · 主题 / 字体大小 / 缩进（尺寸与字符）
 *   · 语言 / 编码 / Java 版本
 *   · 自动换行 / 高亮开关 / 折叠范围
 *   · 查找替换弹窗位置 / 尺寸 / textarea 手工高度
 *   · 查找替换输入内容与选项（大小写 / 全词 / 正则）
 *   · 每语言后缀映射 / 历史后缀列表 / 下载文件名默认值
 *   · stdin 缓存内容
 *
 * 有意不包含：
 *   · 编辑器代码内容（CODE_CACHE / IndexedDB）——由自动保存机制独立管理
 *   · DIRTY_FLAG —— 运行时状态，页面重启后即清
 *   · 目录句柄（FileSystemDirectoryHandle 无法 JSON 序列化）
 * ============================================================================
 */

import {
    CONFIG,
    STORAGE_KEYS,
    SETTINGS_EXPORTABLE_KEYS
} from './config.js';
import { DOM } from './dom.js';
import { showToast } from './toast.js';
import { loadFromLocalStorage } from './util.js';
import { EditorState } from './state.js';

// ==================== 模块级常量 ====================

// 设置文件标识（写入 _meta.type，导入时校验）
const SETTINGS_FILE_TYPE = 'code-editor-settings';

// 设置文件版本（写入 _meta.version，供未来兼容性判断）
const SETTINGS_FILE_VERSION = 1;

// ==================== 模块级状态 ====================

// 幂等保护：防止 setupSettingsIOEvents 被重复调用导致监听器累积
let isSettingsIOInitialized = false;

// ==================== 下拉菜单显示 / 隐藏 ====================

function isSettingsDropdownVisible() {
    if (!DOM.settingsIODropdown) return false;
    return DOM.settingsIODropdown.style.display !== 'none';
}

function showSettingsDropdown() {
    if (!DOM.settingsIODropdown) return;
    DOM.settingsIODropdown.style.display = 'block';
    if (DOM.btnSettingsIO) {
        DOM.btnSettingsIO.setAttribute('aria-expanded', 'true');
    }
}

function hideSettingsDropdown() {
    if (!DOM.settingsIODropdown) return;
    DOM.settingsIODropdown.style.display = 'none';
    if (DOM.btnSettingsIO) {
        DOM.btnSettingsIO.setAttribute('aria-expanded', 'false');
    }
}

function toggleSettingsDropdown() {
    if (!DOM.settingsIODropdown) return;
    if (isSettingsDropdownVisible()) {
        hideSettingsDropdown();
    } else {
        showSettingsDropdown();
    }
}

function focusFirstSettingsMenuItem() {
    if (!DOM.settingsIODropdown) return;
    const firstMenuItem = DOM.settingsIODropdown.querySelector('.settings-io-item');
    if (firstMenuItem) {
        firstMenuItem.focus();
    }
}

// ==================== 值校验规则表 ====================

/**
 * 校验规则表：storageKey → 校验函数。
 *
 * 返回 true 表示值格式合法，可以写入；false 表示跳过该项。
 * 未在表中定义的键（未来新增）宽松放行，避免阻塞主流程。
 *
 * 规则覆盖面：
 *   · 枚举型 —— theme / language / encoding / javaVersion 严格白名单
 *   · 数值型 —— fontSize / indentSize / 弹窗尺寸 / textarea 高度范围限定
 *   · 结构型 —— indent / modalPosition / modalSize / languageExtensionMap
 *               要求对象且字段类型正确
 *   · 数组型 —— foldedRanges / fileExtensionHistory 要求元素结构合法
 *   · 字符串型 —— 限制长度上限，避免恶意超长字符串挤爆 localStorage
 */
const SETTINGS_VALUE_VALIDATORS = {
    [STORAGE_KEYS.THEME]: function(value) {
        return typeof value === 'string'
            && ['dark', 'light', 'ink', 'cream'].indexOf(value) !== -1;
    },
    [STORAGE_KEYS.INDENT]: function(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
        if (typeof value.size !== 'number' || !isFinite(value.size)) return false;
        if (value.size < 1 || value.size > 16) return false;
        if (value.character !== ' ' && value.character !== '\t') return false;
        return true;
    },
    [STORAGE_KEYS.FONT_SIZE]: function(value) {
        return typeof value === 'number' && isFinite(value)
            && value >= 10 && value <= 30;
    },
    [STORAGE_KEYS.LANGUAGE]: function(value) {
        return typeof value === 'string'
            && ['js', 'html', 'css', 'python', 'java', 'txt'].indexOf(value) !== -1;
    },
    [STORAGE_KEYS.WRAP_ENABLED]: function(value) {
        return typeof value === 'boolean';
    },
    [STORAGE_KEYS.HIGHLIGHT_ENABLED]: function(value) {
        return typeof value === 'boolean';
    },
    [STORAGE_KEYS.ENCODING]: function(value) {
        return typeof value === 'string'
            && ['auto', 'utf-8', 'utf-8-bom', 'windows-1252'].indexOf(value) !== -1;
    },
    [STORAGE_KEYS.JAVA_VERSION]: function(value) {
        return typeof value === 'string'
            && ['21.0.2', '17.0.6', '15.0.2'].indexOf(value) !== -1;
    },
    [STORAGE_KEYS.FOLDED_RANGES]: function(value) {
        if (!Array.isArray(value)) return false;
        for (let index = 0; index < value.length; index++) {
            const range = value[index];
            if (!range || typeof range !== 'object') return false;
            if (typeof range.startLine !== 'number' || !isFinite(range.startLine)) return false;
            if (typeof range.endLine !== 'number' || !isFinite(range.endLine)) return false;
            if (range.startLine < 0 || range.endLine < range.startLine) return false;
        }
        return true;
    },
    [STORAGE_KEYS.STDIN_CACHE]: function(value) {
        return typeof value === 'string';
    },
    [STORAGE_KEYS.REPLACE_FIND]: function(value) {
        return typeof value === 'string';
    },
    [STORAGE_KEYS.REPLACE_WITH]: function(value) {
        return typeof value === 'string';
    },
    [STORAGE_KEYS.REPLACE_CASE_SENSITIVE]: function(value) {
        return typeof value === 'boolean';
    },
    [STORAGE_KEYS.REPLACE_WHOLE_WORD]: function(value) {
        return typeof value === 'boolean';
    },
    [STORAGE_KEYS.REPLACE_USE_REGEX]: function(value) {
        return typeof value === 'boolean';
    },
    [STORAGE_KEYS.REPLACE_MODAL_POSITION]: function(value) {
        if (value === null) return true;
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
        if (typeof value.left !== 'number' || !isFinite(value.left)) return false;
        if (typeof value.top !== 'number' || !isFinite(value.top)) return false;
        return true;
    },
    [STORAGE_KEYS.REPLACE_MODAL_SIZE]: function(value) {
        if (value === null) return true;
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
        if (typeof value.width !== 'number' || !isFinite(value.width)) return false;
        if (typeof value.height !== 'number' || !isFinite(value.height)) return false;
        if (value.width < 100 || value.height < 100) return false;
        return true;
    },
    [STORAGE_KEYS.REPLACE_FIND_MANUAL_HEIGHT]: function(value) {
        if (value === null) return true;
        return typeof value === 'number' && isFinite(value)
            && value >= 60 && value <= 400;
    },
    [STORAGE_KEYS.REPLACE_WITH_MANUAL_HEIGHT]: function(value) {
        if (value === null) return true;
        return typeof value === 'number' && isFinite(value)
            && value >= 60 && value <= 400;
    },
    [STORAGE_KEYS.LAST_DOWNLOAD_FILENAME]: function(value) {
        return typeof value === 'string' && value.length <= 255;
    },
    [STORAGE_KEYS.FILE_EXTENSION_HISTORY]: function(value) {
        if (!Array.isArray(value)) return false;
        if (value.length > CONFIG.FILE_EXTENSION_HISTORY_MAX * 4) return false;
        for (let index = 0; index < value.length; index++) {
            const item = value[index];
            if (typeof item !== 'string') return false;
            if (item.length > CONFIG.FILE_EXTENSION_MAX_LENGTH) return false;
        }
        return true;
    },
    [STORAGE_KEYS.LANGUAGE_EXTENSION_MAP]: function(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
        const validLanguages = ['js', 'html', 'css', 'python', 'java', 'txt'];
        const keysOfValue = Object.keys(value);
        for (let index = 0; index < keysOfValue.length; index++) {
            const languageKey = keysOfValue[index];
            if (validLanguages.indexOf(languageKey) === -1) continue;
            const extensionValue = value[languageKey];
            if (typeof extensionValue !== 'string') return false;
            if (extensionValue.length > CONFIG.FILE_EXTENSION_MAX_LENGTH) return false;
        }
        return true;
    }
};

/**
 * 判定单个设置项的值是否合法。
 * 未在表中定义的键宽松放行；校验函数抛错时视为不合法。
 */
function isSettingValueValid(settingKey, settingValue) {
    const validatorFunction = SETTINGS_VALUE_VALIDATORS[settingKey];
    if (typeof validatorFunction !== 'function') {
        return true;
    }
    try {
        return validatorFunction(settingValue) === true;
    } catch (validationError) {
        console.warn('设置项校验异常:', settingKey, validationError);
        return false;
    }
}

// ==================== 辅助工具 ====================

/**
 * 剥离 UTF-8 BOM。
 * Windows 记事本 / 部分编辑器保存的 JSON 会带 BOM（U+FEFF），
 * 直接 JSON.parse 会抛错。此函数在解析前剥离。
 */
function stripByteOrderMark(text) {
    if (!text) return '';
    if (text.charCodeAt(0) === 0xFEFF) {
        return text.slice(1);
    }
    return text;
}

/**
 * 生成文件名时间戳：YYYYMMDD-HHMMSS。
 * 使用本地时间，便于用户识别。
 */
function buildTimestampForFilename(dateObject) {
    const year = dateObject.getFullYear();
    const month = String(dateObject.getMonth() + 1).padStart(2, '0');
    const day = String(dateObject.getDate()).padStart(2, '0');
    const hour = String(dateObject.getHours()).padStart(2, '0');
    const minute = String(dateObject.getMinutes()).padStart(2, '0');
    const second = String(dateObject.getSeconds()).padStart(2, '0');
    return year + month + day + '-' + hour + minute + second;
}

/**
 * 将任意值序列化为 localStorage 字符串。
 * 若传入的 value 已是非字符串（如对象、数组），JSON.stringify 会返回
 * 带引号的字符串字面量；若已是字符串，JSON.stringify 会加引号 ——
 * 与本项目 saveToLocalStorage 的既有行为完全一致，保证读回时
 * loadFromLocalStorage 的 JSON.parse 解析路径一致。
 */
function serializeSettingValue(settingValue) {
    return JSON.stringify(settingValue);
}

// ==================== 导出 ====================

export function exportAllSettings() {
    const exportedData = {};

    for (let index = 0; index < SETTINGS_EXPORTABLE_KEYS.length; index++) {
        const storageKey = SETTINGS_EXPORTABLE_KEYS[index];
        const storedValue = loadFromLocalStorage(storageKey, undefined);
        if (storedValue !== undefined) {
            exportedData[storageKey] = storedValue;
        }
    }

    const payloadObject = {
        _meta: {
            type: SETTINGS_FILE_TYPE,
            version: SETTINGS_FILE_VERSION,
            appVersion: CONFIG.APP_VERSION,
            exportedAt: new Date().toISOString()
        },
        data: exportedData
    };

    let serializedJson;
    try {
        serializedJson = JSON.stringify(payloadObject, null, 2);
    } catch (serializeError) {
        console.error('设置序列化失败:', serializeError);
        showToast('❌ 设置序列化失败（可能存在循环引用）', true);
        return;
    }

    const settingsBlob = new Blob(
        [serializedJson],
        { type: 'application/json;charset=utf-8' }
    );
    const downloadUrl = URL.createObjectURL(settingsBlob);
    const downloadLink = document.createElement('a');
    const timestampString = buildTimestampForFilename(new Date());
    downloadLink.href = downloadUrl;
    downloadLink.download = 'editor-settings-' + timestampString + '.json';
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    URL.revokeObjectURL(downloadUrl);

    const exportedCount = Object.keys(exportedData).length;
    showToast('📤 已导出 ' + exportedCount + ' 项设置');
}

// ==================== 导入 ====================

/**
 * 解析 JSON 文本并返回顶层对象。
 * 失败时返回 null，并在内部显示 Toast。
 */
function parseSettingsJsonText(jsonText) {
    let parsedPayload;
    try {
        parsedPayload = JSON.parse(jsonText);
    } catch (parseError) {
        console.warn('JSON 解析失败:', parseError);
        showToast('❌ 设置文件格式错误（非有效 JSON）', true);
        return null;
    }
    if (!parsedPayload || typeof parsedPayload !== 'object' || Array.isArray(parsedPayload)) {
        showToast('❌ 设置文件内容无效（顶层不是对象）', true);
        return null;
    }
    return parsedPayload;
}

/**
 * 校验 _meta 段。
 * 返回 true 表示继续导入，false 表示中止。
 * 若 _meta.type 缺失但 _meta 存在其他字段，弹确认让用户决定。
 */
function validateSettingsMeta(parsedPayload) {
    const metaObject = parsedPayload._meta;
    const hasMetaObject = metaObject
        && typeof metaObject === 'object'
        && !Array.isArray(metaObject);
    const hasMetaType = hasMetaObject && typeof metaObject.type === 'string';

    if (hasMetaObject && hasMetaType && metaObject.type !== SETTINGS_FILE_TYPE) {
        showToast('❌ 不是本编辑器的设置文件', true);
        return false;
    }
    if (!hasMetaType) {
        const proceedWithoutMeta = confirm(
            '该文件缺少编辑器标识信息，可能来自其他来源。\n' +
            '继续导入可能导致设置异常，是否继续？'
        );
        if (!proceedWithoutMeta) return false;
    }
    return true;
}

/**
 * 统计导入数据中与 SETTINGS_EXPORTABLE_KEYS 匹配的键数。
 */
function countMatchedSettingsKeys(importedData) {
    let totalMatchedCount = 0;
    for (let index = 0; index < SETTINGS_EXPORTABLE_KEYS.length; index++) {
        const storageKey = SETTINGS_EXPORTABLE_KEYS[index];
        if (Object.prototype.hasOwnProperty.call(importedData, storageKey)) {
            totalMatchedCount++;
        }
    }
    return totalMatchedCount;
}

/**
 * 覆盖确认 + 未保存代码提醒。
 * 返回 true 表示用户同意继续，false 表示中止。
 */
function confirmOverwriteSettings(totalMatchedCount) {
    const overwriteConfirmed = confirm(
        '导入将覆盖当前 ' + totalMatchedCount + ' 项设置（主题、字体、语言、编码等）。\n' +
        '建议先导出备份，是否继续？'
    );
    if (!overwriteConfirmed) return false;

    if (EditorState.codeModified) {
        const continueDespiteUnsaved = confirm(
            '当前编辑器有未保存的代码更改。\n' +
            '导入设置会刷新页面，未保存的代码可能丢失。\n' +
            '建议先按 Ctrl+S 保存。是否继续导入？'
        );
        if (!continueDespiteUnsaved) return false;
    }
    return true;
}

/**
 * 逐项校验 + 写入 + 回读。
 * 返回 { appliedKeys, skippedKeys, failedKeys } 三个数组。
 */
function applySettingsToStorage(importedData) {
    const appliedKeys = [];
    const skippedKeys = [];
    const failedKeys = [];

    for (let index = 0; index < SETTINGS_EXPORTABLE_KEYS.length; index++) {
        const storageKey = SETTINGS_EXPORTABLE_KEYS[index];
        if (!Object.prototype.hasOwnProperty.call(importedData, storageKey)) continue;

        const settingValue = importedData[storageKey];

        if (!isSettingValueValid(storageKey, settingValue)) {
            skippedKeys.push(storageKey);
            continue;
        }

        try {
            const serializedValue = serializeSettingValue(settingValue);
            localStorage.setItem(storageKey, serializedValue);
            const readBackValue = localStorage.getItem(storageKey);
            if (readBackValue === null) {
                // 无痕模式 / 存储策略下可能出现"写入未持久化"
                throw new Error('写入未持久化');
            }
            appliedKeys.push(storageKey);
        } catch (writeError) {
            failedKeys.push(storageKey);
            console.warn('设置项写入失败:', storageKey, writeError);
        }
    }

    return {
        appliedKeys: appliedKeys,
        skippedKeys: skippedKeys,
        failedKeys: failedKeys
    };
}

/**
 * 汇总导入结果并通过 Toast 展示。
 * 返回是否至少有一项成功写入。
 */
function reportImportResult(appliedKeys, skippedKeys, failedKeys) {
    let resultMessage = '📥 已导入 ' + appliedKeys.length + ' 项设置';
    if (skippedKeys.length > 0) {
        resultMessage += '，跳过 ' + skippedKeys.length + ' 项（格式不兼容）';
    }
    if (failedKeys.length > 0) {
        resultMessage += '，失败 ' + failedKeys.length + ' 项（存储空间可能已满）';
    }

    const isErrorResult = failedKeys.length > 0 || appliedKeys.length === 0;

    if (appliedKeys.length > 0) {
        resultMessage += '，页面即将刷新...';
    } else {
        resultMessage += '。未刷新页面。';
    }

    showToast(resultMessage, isErrorResult);

    if (skippedKeys.length > 0) {
        console.warn('跳过的设置项:', skippedKeys);
    }
    if (failedKeys.length > 0) {
        console.warn('写入失败的设置项:', failedKeys);
    }

    return appliedKeys.length > 0;
}

/**
 * 主导入入口。
 * 由 DOM.settingsFileInput 的 change 事件调用，传入 File 对象。
 */
export function importAllSettingsFromFile(selectedFile) {
    if (!selectedFile) return;

    if (selectedFile.size > CONFIG.SETTINGS_FILE_MAX_SIZE) {
        const maxMegabytes = (CONFIG.SETTINGS_FILE_MAX_SIZE / (1024 * 1024)).toFixed(0);
        showToast('❌ 设置文件过大（最大 ' + maxMegabytes + 'MB）', true);
        return;
    }

    const settingsFileReader = new FileReader();

    settingsFileReader.onload = function(loadEvent) {
        let rawText = String(loadEvent.target.result || '');
        rawText = stripByteOrderMark(rawText);

        const parsedPayload = parseSettingsJsonText(rawText);
        if (!parsedPayload) return;

        const importedData = parsedPayload.data;
        if (!importedData || typeof importedData !== 'object' || Array.isArray(importedData)) {
            showToast('❌ 设置文件缺少 data 字段', true);
            return;
        }

        if (!validateSettingsMeta(parsedPayload)) return;

        const totalMatchedCount = countMatchedSettingsKeys(importedData);
        if (totalMatchedCount === 0) {
            showToast('⚠️ 设置文件中没有可导入的设置项', true);
            return;
        }

        if (!confirmOverwriteSettings(totalMatchedCount)) return;

        const result = applySettingsToStorage(importedData);
        const shouldReload = reportImportResult(
            result.appliedKeys,
            result.skippedKeys,
            result.failedKeys
        );

        if (!shouldReload) {
            return;
        }

        // v8.6.1：用户已在 confirmOverwriteSettings 中明确同意丢弃未保存代码，
        // 置位 skipBeforeUnload 让 ui.js 的 beforeunload 处理器放行，
        // 避免 location.reload() 触发浏览器原生二次确认框。
        // 该标志不持久化，页面刷新后自动重置为 false。
        EditorState.skipBeforeUnload = true;

        setTimeout(function() {
            window.location.reload();
        }, CONFIG.SETTINGS_RELOAD_DELAY_MS);
    };

    settingsFileReader.onerror = function() {
        showToast('❌ 设置文件读取失败', true);
    };

    settingsFileReader.readAsText(selectedFile, 'utf-8');
}

// ==================== 事件绑定 ====================

/**
 * 绑定设置导出 / 导入模块的全部事件。
 *
 * 幂等：首次调用后 isSettingsIOInitialized = true，后续调用直接返回。
 */
export function setupSettingsIOEvents() {
    if (isSettingsIOInitialized) return;
    if (!DOM.btnSettingsIO || !DOM.settingsIODropdown) return;

    isSettingsIOInitialized = true;

    // ---- 1. 齿轮按钮点击：切换下拉菜单 ----
    DOM.btnSettingsIO.addEventListener('click', function(event) {
        event.stopPropagation();
        toggleSettingsDropdown();
    });

    // ---- 2. 齿轮按钮键盘：↓ / Enter / Space 打开并聚焦首项；Escape 关闭 ----
    DOM.btnSettingsIO.addEventListener('keydown', function(event) {
        if (event.key === 'Escape' && isSettingsDropdownVisible()) {
            event.preventDefault();
            hideSettingsDropdown();
            return;
        }
        if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            if (!isSettingsDropdownVisible()) {
                event.preventDefault();
                showSettingsDropdown();
                focusFirstSettingsMenuItem();
            }
        }
    });

    // ---- 3. 菜单项点击 ----
    DOM.settingsIODropdown.addEventListener('click', function(event) {
        const menuItem = event.target.closest('.settings-io-item');
        if (!menuItem) return;
        const actionName = menuItem.getAttribute('data-action');
        hideSettingsDropdown();
        if (actionName === 'export') {
            exportAllSettings();
        } else if (actionName === 'import') {
            if (DOM.settingsFileInput) {
                DOM.settingsFileInput.click();
            }
        }
    });

    // ---- 4. 菜单项键盘导航（↑↓ Enter Space Escape Tab） ----
    DOM.settingsIODropdown.addEventListener('keydown', function(event) {
        const menuItems = Array.from(
            DOM.settingsIODropdown.querySelectorAll('.settings-io-item')
        );
        if (menuItems.length === 0) return;

        const activeItem = document.activeElement;
        const activeIndex = menuItems.indexOf(activeItem);

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            const nextIndex = activeIndex < 0
                ? 0
                : (activeIndex + 1) % menuItems.length;
            menuItems[nextIndex].focus();
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            const previousIndex = activeIndex < 0
                ? menuItems.length - 1
                : (activeIndex - 1 + menuItems.length) % menuItems.length;
            menuItems[previousIndex].focus();
        } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (activeItem && menuItems.indexOf(activeItem) !== -1) {
                activeItem.click();
            }
        } else if (event.key === 'Escape') {
            event.preventDefault();
            hideSettingsDropdown();
            if (DOM.btnSettingsIO) DOM.btnSettingsIO.focus();
        } else if (event.key === 'Tab') {
            // 允许 Tab 自然移出菜单；同时关闭菜单
            hideSettingsDropdown();
        }
    });

    // ---- 5. 文件选择 ----
    if (DOM.settingsFileInput) {
        DOM.settingsFileInput.addEventListener('change', function(event) {
            const selectedFile = event.target.files[0];
            if (selectedFile) {
                importAllSettingsFromFile(selectedFile);
            }
            // 复位以便用户重复选择同一个文件
            event.target.value = '';
        });
    }

    // ---- 6. 外部点击关闭（pointerdown 兼顾鼠标与触屏，被动监听不阻塞滚动） ----
    document.addEventListener('pointerdown', function(event) {
        if (!isSettingsDropdownVisible()) return;
        const wrapperElement = DOM.settingsIOWrapper;
        if (wrapperElement && wrapperElement.contains(event.target)) return;
        hideSettingsDropdown();
    }, { passive: true });

    // ---- 7. 全局 Escape ----
    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape' && isSettingsDropdownVisible()) {
            hideSettingsDropdown();
        }
    });
}