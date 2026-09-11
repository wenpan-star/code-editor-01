/**
 * ============================================================================
 * dom.js — DOM 元素引用集中收集
 * ============================================================================
 *
 * 所有模块通过 `import { DOM } from './dom.js'` 获取元素引用。
 * index.html 中 `<script type="module">` 默认延迟执行，
 * 因此本模块执行时 DOM 已完全可用。
 *
 * 【v8.6.0 更新】
 *   新增设置导出 / 导入相关的 4 个引用：
 *     · btnSettingsIO        齿轮按钮
 *     · settingsIOWrapper    按钮 + 下拉菜单的外层容器
 *     · settingsIODropdown   下拉菜单容器
 *     · settingsFileInput    隐藏的 <input type="file">
 *   若运行的是旧版 index.html（无这些元素），此处取值为 null，
 *   settings-io.js 内部已对空值做防御处理。
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

    // ---- v8.6.0 新增：设置导出 / 导入 ----
    btnSettingsIO: getById('btnSettingsIO'),
    settingsIOWrapper: getById('settingsIOWrapper'),
    settingsIODropdown: getById('settingsIODropdown'),
    settingsFileInput: getById('settingsFileInput'),

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

    // ---- 语言下拉框 ----
    langSelect: getById('languageSelect'),

    // ---- 自定义文件后缀输入框及历史下拉列表 ----
    fileExtensionInput: getById('fileExtensionInput'),
    fileExtensionDropdown: getById('fileExtensionDropdown'),

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