/**
 * ============================================================================
 * state.js — 全局状态对象
 * ============================================================================
 *
 * 【v8.6.1 新增】
 *   skipBeforeUnload：设置导入成功后由 settings-io.js 置位，
 *     让 ui.js 的 beforeunload 处理器跳过"未保存代码"二次确认，
 *     避免 location.reload() 触发浏览器原生弹窗。
 *
 * 【v8.5.0 新增】
 *   languageExtensionMap：每语言独立保存的后缀值。
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

    // ---- Worker（查找替换搜索）----
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

    // ---- 文件名 ----
    currentFileName: '在线代码编辑器',

    // ---- Java 版本 ----
    javaVersion: '21.0.2',

    // ---- v8.5.0 新增：每语言独立后缀 ----
    // 结构：{ js: 'js', html: 'html', css: 'css', python: 'py', java: 'java', txt: '' }
    // 初始化时从 localStorage 恢复，切换语言时读写，修改后整体持久化。
    languageExtensionMap: {},

    // ---- 内部编辑器更新标志 ----
    internalEditorUpdate: false,

    // ---- v8.6.1 新增：设置导入后跳过 beforeunload 未保存检查 ----
    // 用户已在 settings-io.js 的覆盖确认中明确同意丢弃未保存代码，
    // 若 location.reload() 再次被 beforeunload 拦截，会造成二次确认困扰。
    // settings-io.js 在写入成功后置位，ui.js 的 beforeunload 处理器
    // 检测到该标志后直接放行，不触发 event.preventDefault。
    skipBeforeUnload: false
};