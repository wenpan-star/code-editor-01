/**
 * ============================================================================
 * dom.js — DOM 元素引用集中收集
 * ============================================================================
 *
 * 所有模块通过 `import { DOM } from './dom.js'` 获取元素引用。
 * index.html 中 `<script type="module">` 默认延迟执行，
 * 因此本模块执行时 DOM 已完全可用。
 *
 * 说明：
 *   - 语言选择由原来的 5 个 .lang-label 按钮改为单个 #languageSelect 下拉框，
 *     因此移除 langLabels 引用，新增 langSelect 引用。
 *   - 动态创建的元素（如 updateFileNameDisplay 中的 modifiedDot）
 *     需要在各模块使用处即时查询，不在此列。
 * ============================================================================
 */

function getById(id) {
    return document.getElementById(id);
}

export const DOM = {
    // ---- 编辑器 ----
    codeEditor: getById('codeEditor'),
    lineNumbers: getById('lineNumbers'),
    highlightHost: getById('highlightHost'),
    editorWrapper: getById('editorWrapper'),

    // ---- 工具栏按钮 ----
    btnCopy: getById('btnCopy'),
    btnUndo: getById('btnUndo'),
    btnRedo: getById('btnRedo'),
    btnClear: getById('btnClear'),
    btnSelectAll: getById('btnSelectAll'),
    btnToggleReplace: getById('btnToggleReplace'),
    btnFindNext: getById('btnFindNext'),
    btnReplaceOne: getById('btnReplaceOne'),
    btnReplaceAll: getById('btnReplaceAll'),
    btnTheme: getById('btnTheme'),
    btnHelp: getById('btnHelp'),
    btnImport: getById('btnImport'),
    btnDownload: getById('btnDownload'),
    btnChangeSaveDir: getById('btnChangeSaveDir'),
    btnWrap: getById('btnWrap'),
    btnRun: getById('btnRun'),

    // ---- 复制按钮图标 ----
    copyIcon: getById('copyIcon'),
    checkIcon: getById('checkIcon'),
    copyText: getById('copyText'),

    // ---- Toast ----
    toast: getById('toast'),

    // ---- 状态栏 ----
    lineCountEl: getById('lineCount'),
    charCountEl: getById('charCount'),
    cursorPosEl: getById('cursorPos'),
    langDisplay: getById('langDisplay'),
    encodingStatus: getById('encodingStatus'),
    indentIndicator: getById('indentIndicator'),
    highlightStatus: getById('highlightStatus'),
    highlightIcon: getById('highlightIcon'),
    highlightLabel: getById('highlightLabel'),
    autoSaveStatus: getById('autoSaveStatus'),
    fileNameDisplay: getById('fileNameDisplay'),

    // ---- 语言下拉框（v8.1.0：替代原 langLabels） ----
    langSelect: getById('languageSelect'),

    // ---- 查找替换弹窗 ----
    replaceModalOverlay: getById('replaceModalOverlay'),
    replaceModal: getById('replaceModal'),
    replaceModalHeader: getById('replaceModalHeader'),
    replaceModalClose: getById('replaceModalClose'),
    replaceFind: getById('replaceFind'),
    replaceWith: getById('replaceWith'),
    replaceCaseSensitive: getById('replaceCaseSensitive'),
    replaceWholeWord: getById('replaceWholeWord'),
    replaceUseRegex: getById('replaceUseRegex'),
    matchCountEl: getById('matchCount'),
    resizeHandleRight: getById('resizeHandleRight'),
    resizeHandleBottom: getById('resizeHandleBottom'),
    resizeHandleCorner: getById('resizeHandleCorner'),

    // ---- 帮助弹窗 ----
    helpModal: getById('helpModal'),
    btnCloseHelp: getById('btnCloseHelp'),

    // ---- 大文件弹窗 ----
    largeFileModal: getById('largeFileModal'),
    btnEnableHighlightModal: getById('btnEnableHighlightModal'),
    btnDismissLargeFileModal: getById('btnDismissLargeFileModal'),

    // ---- 文件输入 ----
    fileInput: getById('fileInput'),

    // ---- 编码 / Java 版本 ----
    encodingSelect: getById('encodingSelect'),
    javaVersionSelect: getById('javaVersionSelect'),

    // ---- 输出面板 ----
    outputPanel: getById('outputPanel'),
    outputPanelHeader: getById('outputPanelHeader'),
    outputPanelBody: getById('outputPanelBody'),
    outputContent: getById('outputContent'),
    outputStatus: getById('outputStatus'),
    btnClearOutput: getById('btnClearOutput'),
    stdinInput: getById('stdinInput')
};