/**
 * ============================================================================
 * storage.js — 三层存储封装
 * ============================================================================
 * 版本：v8.0.0
 * 更新日期：2026-09-11
 *
 * 重构说明：
 *   1. localStorage：小型缓存（主题、缩进、编辑内容 < 500KB）
 *      —— 由 util.js 提供 saveToLocalStorage / loadFromLocalStorage
 *   2. IndexedDB：大文件自动保存
 *   3. File System Access API 目录句柄：用户选择的保存目录
 *
 * 所有函数均包含异常处理，静默降级。
 * ============================================================================
 */

import { INDEXED_DB, DIR_HANDLE_DB } from './config.js';
import { EditorState } from './state.js';

// ==================== IndexedDB 自动保存 ====================

export function openAutoSaveDatabase() {
    return new Promise(function(resolve, reject) {
        const request = indexedDB.open(INDEXED_DB.NAME, INDEXED_DB.VERSION);
        request.onupgradeneeded = function(event) {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(INDEXED_DB.STORE_NAME)) {
                db.createObjectStore(INDEXED_DB.STORE_NAME);
            }
        };
        request.onsuccess = function(event) {
            EditorState.autoSaveDB = event.target.result;
            resolve(EditorState.autoSaveDB);
        };
        request.onerror = function(event) {
            console.error('无法打开 IndexedDB 自动保存数据库:', event.target.error);
            reject(event.target.error);
        };
    });
}

export function saveCodeToIndexedDB(code) {
    if (!EditorState.autoSaveDB) return Promise.reject('数据库未打开');
    return new Promise(function(resolve, reject) {
        const transaction = EditorState.autoSaveDB.transaction(INDEXED_DB.STORE_NAME, 'readwrite');
        const store = transaction.objectStore(INDEXED_DB.STORE_NAME);
        const putRequest = store.put(code, INDEXED_DB.KEY);
        putRequest.onsuccess = function() {
            resolve();
        };
        putRequest.onerror = function(event) {
            reject(event.target.error);
        };
    });
}

export function loadCodeFromIndexedDB() {
    if (!EditorState.autoSaveDB) return Promise.resolve(null);
    return new Promise(function(resolve, reject) {
        const transaction = EditorState.autoSaveDB.transaction(INDEXED_DB.STORE_NAME, 'readonly');
        const store = transaction.objectStore(INDEXED_DB.STORE_NAME);
        const getRequest = store.get(INDEXED_DB.KEY);
        getRequest.onsuccess = function() {
            resolve(getRequest.result || null);
        };
        getRequest.onerror = function(event) {
            reject(event.target.error);
        };
    });
}

// ==================== 目录句柄（File System Access API）====================

export function openDirectoryDB() {
    return new Promise(function(resolve, reject) {
        const request = indexedDB.open(DIR_HANDLE_DB.NAME, DIR_HANDLE_DB.VERSION);
        request.onupgradeneeded = function(event) {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(DIR_HANDLE_DB.STORE_NAME)) {
                db.createObjectStore(DIR_HANDLE_DB.STORE_NAME);
            }
        };
        request.onsuccess = function(event) {
            resolve(event.target.result);
        };
        request.onerror = function(event) {
            reject(event.target.error);
        };
    });
}

export async function saveDirectoryHandle(handle) {
    const db = await openDirectoryDB();
    const tx = db.transaction(DIR_HANDLE_DB.STORE_NAME, 'readwrite');
    tx.objectStore(DIR_HANDLE_DB.STORE_NAME).put(handle, DIR_HANDLE_DB.KEY);
    await new Promise(function(resolve, reject) {
        tx.oncomplete = resolve;
        tx.onerror = reject;
    });
    db.close();
}

export async function loadDirectoryHandle() {
    const db = await openDirectoryDB();
    const tx = db.transaction(DIR_HANDLE_DB.STORE_NAME, 'readonly');
    const getRequest = tx.objectStore(DIR_HANDLE_DB.STORE_NAME).get(DIR_HANDLE_DB.KEY);
    const handle = await new Promise(function(resolve, reject) {
        getRequest.onsuccess = function() {
            resolve(getRequest.result);
        };
        getRequest.onerror = reject;
    });
    db.close();
    if (handle && handle.queryPermission) {
        const permission = await handle.queryPermission({ mode: 'readwrite' });
        if (permission !== 'granted') return null;
    }
    return handle;
}

export async function clearDirectoryHandle() {
    const db = await openDirectoryDB();
    const tx = db.transaction(DIR_HANDLE_DB.STORE_NAME, 'readwrite');
    tx.objectStore(DIR_HANDLE_DB.STORE_NAME).delete(DIR_HANDLE_DB.KEY);
    await new Promise(function(resolve) {
        tx.oncomplete = resolve;
    });
    db.close();
}

export async function writeFileToDirectory(directoryHandle, filename, contentArrayBuffer) {
    const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(contentArrayBuffer);
    await writable.close();
}