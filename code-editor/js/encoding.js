/**
 * ============================================================================
 * encoding.js — 编码检测 / 解码 / 编码
 * ============================================================================
 *
 * 本模块职责：
 *   1. 支持的编码：UTF-8 / UTF-8 BOM / Windows-1252（ANSI 1252）
 *   2. UTF-8 字节流有效性检测（isValidUTF8）
 *   3. Windows-1252 编码（含代理对处理）
 *   4. 统一编码入口（encodeTextToBytes / decodeTextFromBytes）
 *   5. UI 集成（编码显示 / 下拉框事件绑定）
 *
 * 编码精简：
 *   移除以下编码及其相关函数：
 *     - UTF-16 LE  →  删除 encodeTextToUTF16LE
 *     - UTF-16 BE  →  删除 encodeTextToUTF16BE
 *     - GB18030    →  删除 createGB18030MapWorker / getGB18030EncodingMap /
 *                     encodeTextToGB18030WithMap / encodeTextToGB18030Sync
 *     - 西(1252/ISO-8859-1)  →  删除 encodeTextToBytes 中的 iso-8859-1 分支
 *
 *   同时移除：
 *     - detectBOMEncoding 中的 UTF-16 LE / BE BOM 检测
 *     - stripBOMFromArrayBuffer 中的 UTF-16 LE / BE 剥离逻辑
 *     - decodeTextFromBytes 中的 utf-16le / utf-16be / gb18030 / iso-8859-1 映射
 *
 *   保留：
 *     - isValidUTF8（导入文件时判断字节流是否为有效 UTF-8）
 *     - encodeTextToWindows1252（含代理对处理，使用 util.js 的
 *       isHighSurrogate / isLowSurrogate）
 *
 *   兼容性：
 *     若运行时传入被移除的编码值，encodeTextToBytes 的 switch 会走
 *     default 分支用 UTF-8 编码；decodeTextFromBytes 的映射表也会回退
 *     到 utf-8。不会抛错。
 *
 * 依赖：
 *   - state.js / config.js / util.js / dom.js / toast.js
 * ============================================================================
 */

import { EditorState } from './state.js';
import { STORAGE_KEYS, ENCODING_DISPLAY_NAMES } from './config.js';
import { saveToLocalStorage, loadFromLocalStorage, isHighSurrogate, isLowSurrogate } from './util.js';
import { DOM } from './dom.js';
import { showToast } from './toast.js';

// ==================== BOM 检测与剥离 ====================

/**
 * 检测字节流开头的 BOM。
 * 仅保留 UTF-8 BOM 检测。
 */
export function detectBOMEncoding(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return 'utf-8-bom';
    return null;
}

/**
 * 剥离指定编码的 BOM。
 * 仅处理 UTF-8 BOM。
 */
export function stripBOMFromArrayBuffer(arrayBuffer, encoding) {
    const bytes = new Uint8Array(arrayBuffer);
    let bomLength = 0;
    if (encoding === 'utf-8-bom' && bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) bomLength = 3;
    if (bomLength === 0) return arrayBuffer;
    return arrayBuffer.slice(bomLength);
}

/**
 * 检查字节流是否为有效 UTF-8。
 * 用于导入文件时，在「自动检测」模式下判断字节流是否符合 UTF-8 规范；
 * 若不符合，提示用户可能是其他编码。
 */
export function isValidUTF8(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    let i = 0;
    while (i < bytes.length) {
        const byte1 = bytes[i];
        if (byte1 <= 0x7F) {
            i += 1;
        } else if (byte1 >= 0xC2 && byte1 <= 0xDF) {
            if (i + 1 >= bytes.length) return false;
            const byte2 = bytes[i + 1];
            if ((byte2 & 0xC0) !== 0x80) return false;
            i += 2;
        } else if (byte1 >= 0xE0 && byte1 <= 0xEF) {
            if (i + 2 >= bytes.length) return false;
            const byte2 = bytes[i + 1];
            const byte3 = bytes[i + 2];
            if ((byte2 & 0xC0) !== 0x80 || (byte3 & 0xC0) !== 0x80) return false;
            if (byte1 === 0xE0 && byte2 < 0xA0) return false;
            if (byte1 === 0xED && byte2 > 0x9F) return false;
            i += 3;
        } else if (byte1 >= 0xF0 && byte1 <= 0xF4) {
            if (i + 3 >= bytes.length) return false;
            const byte2 = bytes[i + 1];
            const byte3 = bytes[i + 2];
            const byte4 = bytes[i + 3];
            if ((byte2 & 0xC0) !== 0x80 || (byte3 & 0xC0) !== 0x80 || (byte4 & 0xC0) !== 0x80) return false;
            if (byte1 === 0xF0 && byte2 < 0x90) return false;
            if (byte1 === 0xF4 && byte2 > 0x8F) return false;
            i += 4;
        } else {
            return false;
        }
    }
    return true;
}

// ==================== Windows-1252 编码 ====================

/**
 * 将文本编码为 Windows-1252（ANSI 1252）字节数组。
 * 映射规则：
 *   - 0x00–0x7F：直接对应
 *   - 0xA0–0xFF：直接对应
 *   - Windows-1252 特有字符（0x80–0x9F 区间的可打印字符）：按映射表转义
 *   - 其他（含代理对、无法映射字符）：替换为 '?'（0x3F）
 */
export function encodeTextToWindows1252(text) {
    const windows1252Mapping = {
        0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84,
        0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88,
        0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C,
        0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93,
        0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
        0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B,
        0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F
    };
    const byteArray = [];
    for (let i = 0; i < text.length; i++) {
        const charCode = text.charCodeAt(i);
        if (isHighSurrogate(charCode) && i + 1 < text.length) {
            const nextCodeUnit = text.charCodeAt(i + 1);
            if (isLowSurrogate(nextCodeUnit)) {
                byteArray.push(0x3F);
                i++;
                continue;
            }
        }
        if (charCode <= 0x7F) byteArray.push(charCode);
        else if (charCode >= 0xA0 && charCode <= 0xFF) byteArray.push(charCode);
        else if (windows1252Mapping[charCode] !== undefined) byteArray.push(windows1252Mapping[charCode]);
        else byteArray.push(0x3F);
    }
    return new Uint8Array(byteArray);
}

// ==================== 统一编码入口 ====================

/**
 * 将文本编码为字节数组。
 * 支持：utf-8 / utf-8-bom / windows-1252。
 * 其他编码（含被移除的 utf-16le / utf-16be / gb18030 / iso-8859-1）
 * 走 default 分支，用 UTF-8 安全降级。
 */
export function encodeTextToBytes(text, encoding) {
    switch (encoding) {
        case 'utf-8':
            return new TextEncoder().encode(text);
        case 'utf-8-bom': {
            const encoded = new TextEncoder().encode(text);
            const result = new Uint8Array(3 + encoded.length);
            result[0] = 0xEF;
            result[1] = 0xBB;
            result[2] = 0xBF;
            result.set(encoded, 3);
            return result;
        }
        case 'windows-1252':
            return encodeTextToWindows1252(text);
        default:
            return new TextEncoder().encode(text);
    }
}

/**
 * 从字节数组解码为文本。
 * 支持：utf-8 / utf-8-bom / windows-1252。
 * 被移除的编码会回退到 utf-8 解码器。
 */
export function decodeTextFromBytes(arrayBuffer, encoding) {
    const strippedBuffer = stripBOMFromArrayBuffer(arrayBuffer, encoding);
    const decoderEncodingMap = {
        'utf-8': 'utf-8',
        'utf-8-bom': 'utf-8',
        'windows-1252': 'windows-1252'
    };
    const decoderEncoding = decoderEncodingMap[encoding] || 'utf-8';
    try {
        const textDecoder = new TextDecoder(decoderEncoding);
        return textDecoder.decode(strippedBuffer);
    } catch (decodeError) {
        console.warn('编码解码失败，使用 UTF-8 回退:', decodeError);
        const fallbackDecoder = new TextDecoder('utf-8');
        return fallbackDecoder.decode(arrayBuffer);
    }
}

// ==================== UI 集成 ====================

export function updateEncodingDisplay(encoding) {
    const displayName = ENCODING_DISPLAY_NAMES[encoding] || encoding;
    DOM.encodingSelect.value = encoding;
    DOM.encodingStatus.textContent = '📄 ' + displayName;
    EditorState.currentEncoding = encoding;
    saveToLocalStorage(STORAGE_KEYS.ENCODING, encoding);
}

export function updateEncodingStatusOnly(encoding) {
    const displayName = ENCODING_DISPLAY_NAMES[encoding] || encoding;
    DOM.encodingStatus.textContent = '📄 ' + displayName;
    EditorState.currentFileEncoding = encoding;
}

export function initializeEncodingSettings() {
    const savedEncoding = loadFromLocalStorage(STORAGE_KEYS.ENCODING, 'auto');
    // 若旧版本 localStorage 保存了被移除的编码值（如 gb18030 / utf-16le），
    // ENCODING_DISPLAY_NAMES[savedEncoding] 为 undefined，回退到 'auto'。
    if (ENCODING_DISPLAY_NAMES[savedEncoding]) {
        updateEncodingDisplay(savedEncoding);
    } else {
        updateEncodingDisplay('auto');
    }
}

export function bindEncodingSelectEvents() {
    DOM.encodingSelect.addEventListener('change', function() {
        const selectedEncoding = this.value;
        updateEncodingDisplay(selectedEncoding);
        const actionHint = (selectedEncoding === 'auto')
            ? '导入时将自动检测编码'
            : '将影响后续导入导出的编码格式';
        showToast('编码格式已切换为 ' + ENCODING_DISPLAY_NAMES[selectedEncoding] + '，' + actionHint);
    });
}