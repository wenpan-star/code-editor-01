/**
 * ============================================================================
 * encoding.js — 编码检测 / 解码 / 编码
 * ============================================================================
 * 版本：v8.0.3（遗留问题补完版）
 * 更新日期：2026-09-11
 *
 * 重构说明：
 *   1. 支持编码：UTF-8 / UTF-8 BOM / UTF-16 LE / UTF-16 BE / GB18030 /
 *      Windows-1252 / ISO-8859-1
 *   2. UTF-16 手写编解码（正确处理代理对）
 *   3. GB18030 编码映射表通过 Web Worker 构建
 *   4. v7.7.0 修复：GB18030 Worker 超时后终止并允许重建
 *   5. v7.7.0 新增：isValidUTF8 字节流有效性检测
 *
 * v8.0.3 修复（问题 C）：
 *   getGB18030EncodingMap 的 Promise 复位由 executor 内部同步赋值
 *   改为 promise.finally 处理。
 *
 *   原 v8.0.2 实现里，同步 reject 路径（Worker 创建失败 / postMessage
 *   抛错）会在 executor 内部同步执行
 *     EditorState.gb18030EncodingMapPromise = null;
 *   但随后外部的
 *     EditorState.gb18030EncodingMapPromise = promise;
 *   会覆盖掉这个 null，导致 gb18030EncodingMapPromise 指向一个已
 *   rejected 的 Promise，下次调用 getGB18030EncodingMap 时会直接返回
 *   这个 rejected Promise，Worker 永远无法重建。
 *
 *   修正为：先构造 Promise 并赋给 gb18030EncodingMapPromise，
 *   再用 finally 在 Promise 结算后统一复位为 null（若当前仍指向自己），
 *   无论同步 reject 还是异步 reject / resolve 都能正确处理。
 *
 *   异步路径（setTimeout 超时回调）原本就正常，本次修复不影响其行为。
 *
 * 依赖：
 *   - state.js / config.js / util.js / dom.js / toast.js
 * ============================================================================
 */

import { EditorState } from './state.js';
import { STORAGE_KEYS, ENCODING_DISPLAY_NAMES, CONFIG } from './config.js';
import { saveToLocalStorage, loadFromLocalStorage, isHighSurrogate, isLowSurrogate } from './util.js';
import { DOM } from './dom.js';
import { showToast } from './toast.js';

// ==================== BOM 检测与剥离 ====================

export function detectBOMEncoding(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return 'utf-8-bom';
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) return 'utf-16le';
    if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) return 'utf-16be';
    return null;
}

export function stripBOMFromArrayBuffer(arrayBuffer, encoding) {
    const bytes = new Uint8Array(arrayBuffer);
    let bomLength = 0;
    if (encoding === 'utf-8-bom' && bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) bomLength = 3;
    else if (encoding === 'utf-16le' && bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) bomLength = 2;
    else if (encoding === 'utf-16be' && bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) bomLength = 2;
    if (bomLength === 0) return arrayBuffer;
    return arrayBuffer.slice(bomLength);
}

/**
 * v7.7.0 新增：检查字节流是否为有效 UTF-8。
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

// ==================== UTF-16 手写编码 ====================

export function encodeTextToUTF16LE(text) {
    const byteArrays = [];
    byteArrays.push(new Uint8Array([0xFF, 0xFE]));
    let totalLength = 2;
    for (let i = 0; i < text.length; i++) {
        const codeUnit = text.charCodeAt(i);
        if (isHighSurrogate(codeUnit) && i + 1 < text.length) {
            const nextCodeUnit = text.charCodeAt(i + 1);
            if (isLowSurrogate(nextCodeUnit)) {
                const bytes = new Uint8Array(4);
                bytes[0] = codeUnit & 0xFF;
                bytes[1] = (codeUnit >> 8) & 0xFF;
                bytes[2] = nextCodeUnit & 0xFF;
                bytes[3] = (nextCodeUnit >> 8) & 0xFF;
                byteArrays.push(bytes);
                totalLength += 4;
                i++;
                continue;
            }
        }
        const bytes = new Uint8Array(2);
        bytes[0] = codeUnit & 0xFF;
        bytes[1] = (codeUnit >> 8) & 0xFF;
        byteArrays.push(bytes);
        totalLength += 2;
    }
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const byteArray of byteArrays) {
        result.set(byteArray, offset);
        offset += byteArray.length;
    }
    return result;
}

export function encodeTextToUTF16BE(text) {
    const byteArrays = [];
    byteArrays.push(new Uint8Array([0xFE, 0xFF]));
    let totalLength = 2;
    for (let i = 0; i < text.length; i++) {
        const codeUnit = text.charCodeAt(i);
        if (isHighSurrogate(codeUnit) && i + 1 < text.length) {
            const nextCodeUnit = text.charCodeAt(i + 1);
            if (isLowSurrogate(nextCodeUnit)) {
                const bytes = new Uint8Array(4);
                bytes[0] = (codeUnit >> 8) & 0xFF;
                bytes[1] = codeUnit & 0xFF;
                bytes[2] = (nextCodeUnit >> 8) & 0xFF;
                bytes[3] = nextCodeUnit & 0xFF;
                byteArrays.push(bytes);
                totalLength += 4;
                i++;
                continue;
            }
        }
        const bytes = new Uint8Array(2);
        bytes[0] = (codeUnit >> 8) & 0xFF;
        bytes[1] = codeUnit & 0xFF;
        byteArrays.push(bytes);
        totalLength += 2;
    }
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const byteArray of byteArrays) {
        result.set(byteArray, offset);
        offset += byteArray.length;
    }
    return result;
}

// ==================== Windows-1252 编码 ====================

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

// ==================== GB18030 编码（Worker 构建映射表） ====================

export function createGB18030MapWorker() {
    if (EditorState.gb18030MapWorker) {
        EditorState.gb18030MapWorker.terminate();
        EditorState.gb18030MapWorker = null;
    }
    const workerScript = `
        self.onmessage = function(event) {
            if (event.data.type === 'buildMap') {
                try {
                    const textDecoder = new TextDecoder('gb18030');
                    const encodingMap = {};
                    for (let firstByte = 0x81; firstByte <= 0xFE; firstByte++) {
                        for (let secondByte = 0x40; secondByte <= 0xFE; secondByte++) {
                            if (secondByte === 0x7F) continue;
                            const byteArray = new Uint8Array([firstByte, secondByte]);
                            const decodedCharacter = textDecoder.decode(byteArray);
                            if (decodedCharacter.length === 1 && !encodingMap[decodedCharacter]) {
                                encodingMap[decodedCharacter] = [firstByte, secondByte];
                            }
                        }
                    }
                    self.postMessage({ type: 'mapBuilt', map: encodingMap });
                } catch (mapError) {
                    self.postMessage({ type: 'mapError', error: mapError.message });
                }
            }
        };
    `;
    const blob = new Blob([workerScript], { type: 'application/javascript' });
    EditorState.gb18030MapWorker = new Worker(URL.createObjectURL(blob));
    EditorState.gb18030MapWorker.onmessage = function(event) {
        const data = event.data;
        if (data.type === 'mapBuilt') {
            EditorState.gb18030EncodingMap = data.map;
            EditorState.gb18030MapBuilding = false;
            console.log('%c📄 GB18030 编码映射表已在 Worker 中构建完成', 'color:#89b4fa;');
        } else if (data.type === 'mapError') {
            EditorState.gb18030MapBuilding = false;
            console.warn('GB18030 编码映射表构建失败:', data.error);
        }
    };
    EditorState.gb18030MapWorker.onerror = function(event) {
        EditorState.gb18030MapBuilding = false;
        console.warn('GB18030 Worker 错误:', event.message);
    };
}

/**
 * v7.7.0：超时后终止 Worker 并重置 Promise，下次调用可重新构建。
 *
 * v8.0.3 修复（问题 C）：
 *   - 用 try/catch 包住 Worker 创建与 postMessage，异常时清理定时器并 reject。
 *   - Worker 为 null 时直接 reject，避免后续 postMessage 抛错。
 *   - 超时回调里同时清理 setInterval，防止"双重定时器泄漏"。
 *   - Promise 复位不再在 executor 内部同步赋值（会被外部覆盖），
 *     改为 finally 在结算后统一处理，允许下次调用重建。
 */
export function getGB18030EncodingMap() {
    if (EditorState.gb18030EncodingMap) return Promise.resolve(EditorState.gb18030EncodingMap);
    if (EditorState.gb18030EncodingMapPromise) return EditorState.gb18030EncodingMapPromise;

    const promise = new Promise(function(resolve, reject) {
        let timeoutId = null;
        let checkInterval = null;

        try {
            if (!EditorState.gb18030MapWorker) createGB18030MapWorker();
            if (!EditorState.gb18030MapWorker) {
                EditorState.gb18030MapBuilding = false;
                reject(new Error('GB18030 Worker 创建失败'));
                return;
            }

            EditorState.gb18030MapBuilding = true;

            timeoutId = setTimeout(function() {
                if (checkInterval) {
                    clearInterval(checkInterval);
                    checkInterval = null;
                }
                timeoutId = null;
                EditorState.gb18030MapBuilding = false;
                if (EditorState.gb18030MapWorker) {
                    EditorState.gb18030MapWorker.terminate();
                    EditorState.gb18030MapWorker = null;
                }
                reject(new Error('GB18030 映射表构建超时'));
            }, CONFIG.GB18030_MAP_BUILD_TIMEOUT_MS);

            checkInterval = setInterval(function() {
                if (EditorState.gb18030EncodingMap) {
                    clearInterval(checkInterval);
                    checkInterval = null;
                    clearTimeout(timeoutId);
                    timeoutId = null;
                    EditorState.gb18030MapBuilding = false;
                    resolve(EditorState.gb18030EncodingMap);
                }
            }, 100);

            EditorState.gb18030MapWorker.postMessage({ type: 'buildMap' });
        } catch (workerError) {
            if (checkInterval) clearInterval(checkInterval);
            if (timeoutId) clearTimeout(timeoutId);
            EditorState.gb18030MapBuilding = false;
            if (EditorState.gb18030MapWorker) {
                try {
                    EditorState.gb18030MapWorker.terminate();
                } catch (terminateError) {
                    // 忽略
                }
                EditorState.gb18030MapWorker = null;
            }
            reject(workerError);
        }
    });

    // v8.0.3 修复（问题 C）：先赋值，再用 finally 复位，
    // 保证同步 reject / 异步 reject / resolve 三条路径下
    // gb18030EncodingMapPromise 都能在结算后被清空。
    EditorState.gb18030EncodingMapPromise = promise;

    promise.finally(function() {
        if (EditorState.gb18030EncodingMapPromise === promise) {
            EditorState.gb18030EncodingMapPromise = null;
        }
    });

    return promise;
}

export function encodeTextToGB18030WithMap(text, encodingMap) {
    const byteArrays = [];
    let totalLength = 0;
    let unmappableCount = 0;

    for (let i = 0; i < text.length; i++) {
        const charCode = text.charCodeAt(i);
        if (isHighSurrogate(charCode) && i + 1 < text.length) {
            const nextCodeUnit = text.charCodeAt(i + 1);
            if (isLowSurrogate(nextCodeUnit)) {
                byteArrays.push(new Uint8Array([0x3F]));
                totalLength += 1;
                unmappableCount++;
                i++;
                continue;
            }
        }
        if (charCode <= 0x7F) {
            byteArrays.push(new Uint8Array([charCode]));
            totalLength += 1;
        } else if (encodingMap && encodingMap[text[i]]) {
            const mappedBytes = encodingMap[text[i]];
            byteArrays.push(new Uint8Array(mappedBytes));
            totalLength += mappedBytes.length;
        } else {
            byteArrays.push(new Uint8Array([0x3F]));
            totalLength += 1;
            unmappableCount++;
        }
    }

    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const byteArray of byteArrays) {
        result.set(byteArray, offset);
        offset += byteArray.length;
    }
    if (unmappableCount > 0) {
        showToast('⚠️ 有 ' + unmappableCount + ' 个字符无法映射到 GB18030，已用 ? 替代', true);
    }
    return result;
}

export function encodeTextToGB18030Sync(text) {
    if (EditorState.gb18030EncodingMap) {
        return encodeTextToGB18030WithMap(text, EditorState.gb18030EncodingMap);
    }
    showToast('⚠️ GB18030 映射表尚未就绪，请稍后重试', true);
    return new TextEncoder().encode(text);
}

// ==================== 统一编码入口 ====================

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
        case 'utf-16le':
            return encodeTextToUTF16LE(text);
        case 'utf-16be':
            return encodeTextToUTF16BE(text);
        case 'iso-8859-1': {
            const result = new Uint8Array(text.length);
            for (let i = 0; i < text.length; i++) {
                const charCode = text.charCodeAt(i);
                result[i] = charCode <= 0xFF ? charCode : 0x3F;
            }
            return result;
        }
        case 'windows-1252':
            return encodeTextToWindows1252(text);
        case 'gb18030':
            return encodeTextToGB18030Sync(text);
        default:
            return new TextEncoder().encode(text);
    }
}

export function decodeTextFromBytes(arrayBuffer, encoding) {
    const strippedBuffer = stripBOMFromArrayBuffer(arrayBuffer, encoding);
    const decoderEncodingMap = {
        'utf-8': 'utf-8',
        'utf-8-bom': 'utf-8',
        'utf-16le': 'utf-16le',
        'utf-16be': 'utf-16be',
        'gb18030': 'gb18030',
        'windows-1252': 'windows-1252',
        'iso-8859-1': 'iso-8859-1'
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
        if (selectedEncoding === 'gb18030') {
            getGB18030EncodingMap().then(function(encodingMap) {
                if (encodingMap) console.log('%c📄 GB18030 编码映射表已就绪', 'color:#89b4fa;');
            }).catch(function(error) {
                console.warn('GB18030 映射表获取失败:', error.message);
            });
        }
    });
}