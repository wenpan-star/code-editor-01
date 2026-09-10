/**
 * ============================================================================
 * state.js — 全局状态对象
 * ============================================================================
 * 版本：v8.0.2（深度审核修复版）
 * 更新日期：2026-09-11
 *
 * 重构说明：
 *   本模块从 v7.7.0 单文件主脚本提取 EditorState，保持字段与含义完全一致。
 *   所有跨模块共享的可变状态集中于此。
 *
 * v8.0.2 新增字段：
 *   - internalEditorUpdate：内部代码驱动的编辑器更新标志。
 *     当 setEditorContent 或 HistoryManager.applyState 主动派发 'input' 事件
 *     时，会临时置为 true，editor.js 的 handleEditorInput 检测到该标志后
 *     直接返回，避免 debouncedUpdate / triggerAutoSave 被重复触发导致
 *     fullUpdate 双调用（这是 v8.0.1 审核报告问题 5 的核心）。
 *
 *   该字段为内部瞬态标志，不持久化，不参与任何 UI 展示。
 * ============================================================================
 */

export const EditorState = {
    // ---- 语言 / 内容 ----
    currentLanguage: 'js',
    codeModified: false,
    originalCode: '',

    // ---- 搜索 ----
    searchMatchIndex: -1,
    lastSearchMatches: [],

    // ---- 编辑器外观 ----
    currentFontSize: 14,
    wordWrapEnabled: false,
    indentSize: 4,
    indentCharacter: ' ',
    theme: 'dark',
    highlightEnabled: true,
    userForcedHighlight: false,

    // ---- 大文件 ----
    largeFileThreshold: 300 * 1024,
    absoluteFileSizeLimit: 2 * 1024 * 1024,
    maxPasteSize: 1.5 * 1024 * 1024,
    largeFileActive: false,

    // ---- 定时器 ----
    autoSaveTimer: null,
    updateTimer: null,
    toastTimer: null,
    copyRestoreTimer: null,

    // ---- 拖拽（查找替换弹窗）----
    isDragging: false,
    dragOffsetX: 0,
    dragOffsetY: 0,
    isResizing: false,
    resizeDirection: null,
    resizeStartX: 0,
    resizeStartY: 0,
    startWidth: 0,
    startHeight: 0,
    startLeft: 0,
    startTop: 0,

    // ---- 焦点 ----
    lastFocusedElement: null,

    // ---- 数据库 ----
    autoSaveDB: null,

    // ---- Worker ----
    highlightWorker: null,
    highlightShadowRoot: null,
    highlightPreElement: null,
    workerMessageIdCounter: 0,
    workerCallbacksMap: new Map(),

    // ---- 折叠 ----
    foldedRanges: [],

    // ---- Java 运行 ----
    isRunning: false,
    outputPanelOpen: false,
    outputPanelHeight: 200,
    runAbortController: null,

    // ---- 编码 ----
    currentEncoding: 'auto',
    currentFileEncoding: 'auto',
    gb18030EncodingMap: null,
    gb18030EncodingMapPromise: null,
    gb18030MapBuilding: false,
    gb18030MapWorker: null,

    // ---- 文件名 ----
    currentFileName: '在线代码编辑器',

    // ---- Java 版本 ----
    javaVersion: '21.0.2',

    // ---- v8.0.2 新增：内部编辑器更新标志 ----
    // 由 editor-api.js 的 setEditorContent 与 history.js 的 dispatchEditorUpdate
    // 在主动派发 'input' 事件前后置位 / 复位。editor.js 的 handleEditorInput
    // 检测到该标志时直接返回，避免内部驱动的更新与显式 fullUpdate 叠加，
    // 造成行号 / 高亮 / 匹配计数等刷新逻辑被双调用。
    internalEditorUpdate: false
};