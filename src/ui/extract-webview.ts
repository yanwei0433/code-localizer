// 提取结果WebView模块，负责显示提取结果的交互界面
import * as vscode from 'vscode';
import { TempVocabulary, Vocabulary, VocabularyEntryType } from '../types';
import { translateExtractedItems } from '../commands/extract-commands';
import { mergeTranslatedItemsToVocabulary, saveVocabulary } from '../vocabulary/vocabulary-manager';

/**
 * 格式化HTML中的特殊字符，防止XSS攻击
 * @param unsafe 不安全的字符串
 * @returns 安全的HTML字符串
 */
export function escapeHtml(unsafe: string): string {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * 创建并显示提取结果WebView
 * @param context VS Code扩展上下文
 * @param document 当前文档
 * @param vocabulary 词汇表
 * @param tempVocabulary 临时词汇表
 * @param identifiers 提取的标识符（如果为null则使用tempVocabulary中的内容）
 * @returns 创建的WebView面板
 */
export function showExtractResultsWebView(
    context: vscode.ExtensionContext,
    document: vscode.TextDocument | null,
    vocabulary: Vocabulary,
    tempVocabulary: TempVocabulary,
    identifiers: string[] | null = null
): vscode.WebviewPanel {
    // 确定要显示的标识符列表
    const newIdentifiers = identifiers || tempVocabulary.new_identifiers;
    
    // 创建WebView面板
    const panel = vscode.window.createWebviewPanel(
        'extractedItems',
        '已提取的标识符',
        vscode.ViewColumn.One,
        { enableScripts: true }
    );
    
    // 构建HTML内容
    panel.webview.html = generateWebViewHtml(newIdentifiers);
    
    // 处理WebView消息
    panel.webview.onDidReceiveMessage(
        async message => {
            switch (message.command) {
                case 'translate':
                    panel.dispose(); // 关闭当前面板
                    
                    // 处理已修改的内容
                    handleModifiedItems(newIdentifiers, tempVocabulary, message.modifiedIdentifiers, message.deletedItems);
                    
                    // 如果提供了文档，则执行翻译流程
                    if (document) {
                        await translateExtractedItems(document, context, vocabulary, tempVocabulary, newIdentifiers);
                    } else {
                        vscode.window.showInformationMessage('没有可翻译的文档。请先打开一个文件。');
                    }
                    break;
                case 'close':
                    // 处理已修改的内容
                    handleModifiedItems(newIdentifiers, tempVocabulary, message.modifiedIdentifiers, message.deletedItems);
                    
                    panel.dispose(); // 关闭面板
                    break;
                case 'modifyItem':
                    // 单个项目修改时，实时更新数据
                    if (message.type === 'identifier') {
                        const index = newIdentifiers.indexOf(message.original);
                        if (index !== -1) {
                            newIdentifiers[index] = message.new;
                            // 同时更新临时词汇表
                            const tempIndex = tempVocabulary.new_identifiers.indexOf(message.original);
                            if (tempIndex !== -1) {
                                tempVocabulary.new_identifiers[tempIndex] = message.new;
                            }
                        }
                    }
                    break;
                case 'deleteItem':
                    // 单个项目删除时，实时更新数据
                    if (message.type === 'identifier') {
                        const index = newIdentifiers.indexOf(message.value);
                        if (index !== -1) {
                            newIdentifiers.splice(index, 1);
                            // 同时更新临时词汇表
                            const tempIndex = tempVocabulary.new_identifiers.indexOf(message.value);
                            if (tempIndex !== -1) {
                                tempVocabulary.new_identifiers.splice(tempIndex, 1);
                            }
                        }
                    }
                    break;
                case 'batchDeleteItems':
                    // 批量删除项目
                    if (message.items && message.items.length > 0) {
                        message.items.forEach((item: { type: string; value: string }) => {
                            if (item.type === 'identifier') {
                                const index = newIdentifiers.indexOf(item.value);
                                if (index !== -1) {
                                    newIdentifiers.splice(index, 1);
                                    // 同时更新临时词汇表
                                    const tempIndex = tempVocabulary.new_identifiers.indexOf(item.value);
                                    if (tempIndex !== -1) {
                                        tempVocabulary.new_identifiers.splice(tempIndex, 1);
                                    }
                                }
                            }
                        });
                        
                        console.log(`[CodeLocalizer] 批量删除了 ${message.items.length} 个项目`);
                    }
                    break;
            }
        },
        undefined,
        context.subscriptions
    );
    
    return panel;
}

/**
 * 生成WebView的HTML内容
 * @param newIdentifiers 标识符数组
 * @returns HTML字符串
 */
function generateWebViewHtml(newIdentifiers: string[]): string {
    let html = `<!DOCTYPE html>
    <html lang="zh-CN">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
        <title>已提取的标识符</title>
        <style>
            :root {
                --vscode-background: var(--vscode-editor-background, #1e1e1e);
                --vscode-foreground: var(--vscode-editor-foreground, #d4d4d4);
                --vscode-button-background: var(--vscode-button-background, #0e639c);
                --vscode-button-foreground: var(--vscode-button-foreground, white);
                --vscode-button-hover-background: var(--vscode-button-hoverBackground, #1177bb);
                --vscode-list-hoverBackground: var(--vscode-list-hoverBackground, #2a2d2e);
                --vscode-input-background: var(--vscode-input-background, #3c3c3c);
                --vscode-input-foreground: var(--vscode-input-foreground, #cccccc);
                --vscode-input-border: var(--vscode-input-border, #3c3c3c);
                --vscode-border: var(--vscode-panel-border, #80808059);
                --vscode-accent: var(--vscode-focusBorder, #007fd4);
                --vscode-icon-color: var(--vscode-icon-foreground, #c5c5c5);
                --vscode-checkbox-background: var(--vscode-checkbox-background, #3c3c3c);
                --vscode-checkbox-foreground: var(--vscode-checkbox-foreground, #cccccc);
                --vscode-checkbox-border: var(--vscode-checkbox-border, #3c3c3c);
                
                /* 调整背景颜色，使用灰色系替代黑色系 */
                --custom-background: #3a3a3a;
                --custom-list-background: #424242;
                --custom-item-background: #4a4a4a;
                --custom-hover-background: #555555;
                --custom-border-color: #666666;
            }
            
            body { 
                font-family: var(--vscode-font-family, 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif); 
                padding: 20px; 
                background-color: var(--custom-background);
                color: #f0f0f0;
                line-height: 1.5;
                user-select: none; /* 防止无意中选中文本 */
            }
            
            h1 { 
                color: #ffffff; 
                font-size: 1.6em; 
                text-align: center;
                margin-bottom: 20px;
                padding-bottom: 10px;
                border-bottom: 1px solid var(--custom-border-color);
            }
            
            h2 { 
                color: #78b0fa; 
                font-size: 1.3em; 
                margin-top: 20px;
                display: flex;
                align-items: center;
            }
            
            h2::before {
                content: '';
                display: inline-block;
                width: 8px;
                height: 18px;
                background-color: #78b0fa;
                margin-right: 8px;
                border-radius: 2px;
            }
            
            .item-list { 
                max-height: 300px; 
                overflow-y: auto; 
                border: 1px solid var(--custom-border-color); 
                padding: 10px; 
                background-color: var(--custom-list-background);
                border-radius: 4px;
                box-shadow: 0 3px 8px rgba(0, 0, 0, 0.3);
            }
            
            .item { 
                padding: 8px 10px; 
                border-bottom: 1px solid var(--custom-border-color);
                font-family: var(--vscode-editor-font-family, 'Consolas', 'Courier New', monospace);
                display: flex;
                align-items: center;
                position: relative;
                background-color: var(--custom-item-background);
                margin-bottom: 4px;
                border-radius: 3px;
            }
            
            .item:last-child {
                border-bottom: none;
                margin-bottom: 0;
            }
            
            .item:hover {
                background-color: var(--custom-hover-background);
            }
            
            .item-checkbox {
                margin-right: 10px;
                cursor: pointer;
                appearance: none;
                -webkit-appearance: none;
                width: 16px;
                height: 16px;
                border: 1px solid var(--vscode-checkbox-border);
                background-color: var(--vscode-checkbox-background);
                border-radius: 3px;
                position: relative;
            }
            
            .item-checkbox:checked {
                background-color: var(--vscode-button-background);
                border-color: var(--vscode-button-background);
            }
            
            .item-checkbox:checked::after {
                content: '✓';
                position: absolute;
                color: var(--vscode-button-foreground);
                font-size: 12px;
                top: -1px;
                left: 2px;
            }
            
            .item-text {
                flex-grow: 1;
                cursor: text;
                padding: 2px 5px;
                border-radius: 3px;
                user-select: text; /* 允许文本选择 */
                color: #ffffff; /* 提高文字对比度 */
            }
            
            .item-text.editing {
                background-color: #333333;
                color: #ffffff;
                border: 1px solid var(--vscode-accent);
                outline: none;
                padding: 2px 5px;
            }
            
            .item-actions {
                display: flex;
                gap: 8px;
                opacity: 0.5;
                transition: opacity 0.2s;
            }
            
            .item:hover .item-actions {
                opacity: 1;
            }
            
            .action-btn {
                background: none;
                border: none;
                color: var(--vscode-icon-color);
                cursor: pointer;
                font-size: 14px;
                padding: 2px 6px;
                border-radius: 3px;
                outline: none;
            }
            
            .action-btn:hover {
                background-color: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
            }
            
            .delete-btn:hover {
                background-color: #d32f2f;
            }
            
            .count { 
                font-weight: bold; 
                color: white;
                background-color: #0078d4;
                padding: 2px 8px;
                border-radius: 10px;
                font-size: 0.9em;
                margin-left: 8px;
            }
            
            .button-container { 
                margin-top: 20px; 
                display: flex; 
                gap: 10px; 
                justify-content: center; 
            }
            
            button { 
                padding: 8px 20px; 
                background-color: #0078d4; 
                color: white; 
                border: none; 
                cursor: pointer; 
                border-radius: 4px;
                font-size: 14px;
                transition: all 0.3s;
            }
            
            button:hover { 
                background-color: #106ebe; 
            }
            
            .secondary { 
                background-color: #5a5a5a; 
                color: white;
                border: 1px solid #666666;
            }
            
            .secondary:hover { 
                background-color: #6e6e6e; 
            }
            
            .empty-state {
                padding: 20px;
                text-align: center;
                color: var(--vscode-descriptionForeground);
                font-style: italic;
            }
            
            .header-actions {
                display: flex;
                align-items: center;
                margin-left: auto;
                gap: 10px;
            }
            
            .select-all-container {
                display: flex;
                align-items: center;
                margin-right: 10px;
                cursor: pointer;
                background-color: #585858;
                padding: 3px 8px;
                border-radius: 3px;
                color: #ffffff;
            }
            
            .select-all-container:hover {
                background-color: #666666;
            }
            
            .select-all-checkbox {
                margin-right: 5px;
                cursor: pointer;
                appearance: none;
                -webkit-appearance: none;
                width: 16px;
                height: 16px;
                border: 1px solid var(--vscode-checkbox-border);
                background-color: var(--vscode-checkbox-background);
                border-radius: 3px;
                position: relative;
            }
            
            .select-all-checkbox:checked {
                background-color: var(--vscode-button-background);
                border-color: var(--vscode-button-background);
            }
            
            .select-all-checkbox:checked::after {
                content: '✓';
                position: absolute;
                color: var(--vscode-button-foreground);
                font-size: 12px;
                top: -1px;
                left: 2px;
            }
            
            .batch-delete-btn {
                background-color: #cc3333;
                color: white;
                border: none;
                cursor: pointer;
                padding: 4px 10px;
                border-radius: 3px;
                font-size: 12px;
                opacity: 0.9;
                transition: opacity 0.3s;
            }
            
            .batch-delete-btn:hover {
                opacity: 1;
            }
            
            .batch-delete-btn:disabled {
                background-color: #888;
                cursor: not-allowed;
                opacity: 0.3;
            }
        </style>
    </head>
    <body>
        <h1>已提取的内容</h1>`;
    
    if (newIdentifiers.length > 0) {
        html += `
        <h2>
            标识符 (<span class="count">${newIdentifiers.length}</span>)
            <div class="header-actions">
                <label class="select-all-container">
                    <input type="checkbox" id="select-all-checkbox" class="select-all-checkbox">
                    <span>全选</span>
                </label>
                <button id="batch-delete-btn" class="batch-delete-btn" disabled>批量删除</button>
            </div>
        </h2>
        <div class="item-list" id="identifiers-list">
            ${newIdentifiers.map((id, index) => `
            <div class="item" data-index="${index}" data-type="identifier" data-value="${escapeHtml(id)}">
                <input type="checkbox" class="item-checkbox">
                <div class="item-text" contenteditable="false" data-original="${escapeHtml(id)}">${escapeHtml(id)}</div>
                <div class="item-actions">
                    <button class="action-btn edit-btn" title="编辑">✏️</button>
                    <button class="action-btn delete-btn" title="删除">🗑️</button>
                </div>
            </div>`).join('')}
        </div>`;
    } else {
        html += `
        <h2>标识符 (<span class="count">0</span>)</h2>
        <div class="item-list">
            <div class="empty-state">未找到标识符</div>
        </div>`;
    }
    
    // 添加按钮区域
    html += `
    <div class="button-container">
        <button id="translate-btn">翻译</button>
        <button id="close-btn" class="secondary">关闭</button>
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        // 当前编辑的元素
        let currentEditingElement = null;
        
        // 跟踪修改过的数据
        const modifiedIdentifiers = {};
        const deletedItems = {
            identifiers: []
        };
        
        // 编辑功能
        document.addEventListener('click', function(event) {
            // 处理编辑按钮点击
            if (event.target.classList.contains('edit-btn')) {
                const item = event.target.closest('.item');
                const textElement = item.querySelector('.item-text');
                
                // 如果当前有其他正在编辑的元素，先保存它
                if (currentEditingElement && currentEditingElement !== textElement) {
                    saveEditing(currentEditingElement);
                }
                
                // 进入编辑模式
                textElement.contentEditable = "true";
                textElement.classList.add('editing');
                textElement.focus();
                
                // 为了确保光标位于文本末尾
                const range = document.createRange();
                range.selectNodeContents(textElement);
                range.collapse(false);
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
                
                currentEditingElement = textElement;
                
                // 更改编辑按钮显示为保存
                event.target.textContent = "💾";
                event.target.title = "保存";
                event.target.classList.add('save-btn');
                event.target.classList.remove('edit-btn');
                return;
            }
            
            // 处理保存按钮点击
            if (event.target.classList.contains('save-btn')) {
                const item = event.target.closest('.item');
                const textElement = item.querySelector('.item-text');
                
                saveEditing(textElement);
                
                // 恢复按钮状态
                event.target.textContent = "✏️";
                event.target.title = "编辑";
                event.target.classList.add('edit-btn');
                event.target.classList.remove('save-btn');
                return;
            }
            
            // 处理删除按钮点击
            if (event.target.classList.contains('delete-btn')) {
                const item = event.target.closest('.item');
                const type = item.getAttribute('data-type');
                const index = parseInt(item.getAttribute('data-index'));
                const value = item.getAttribute('data-value');
                
                // 添加到已删除项目列表
                if (type === 'identifier') {
                    deletedItems.identifiers.push(value);
                }
                
                // 从UI中移除
                item.remove();
                
                // 更新计数器
                updateCounter(type);
                
                // 通知VS Code删除了项目
                vscode.postMessage({
                    command: 'deleteItem',
                    type: type,
                    value: value
                });
                return;
            }
            
            // 如果点击了其他区域，且有编辑中的元素，保存它
            if (currentEditingElement && !event.target.contains(currentEditingElement)) {
                saveEditing(currentEditingElement);
                
                // 找到对应的按钮并恢复状态
                const item = currentEditingElement.closest('.item');
                const saveBtn = item.querySelector('.save-btn');
                if (saveBtn) {
                    saveBtn.textContent = "✏️";
                    saveBtn.title = "编辑";
                    saveBtn.classList.add('edit-btn');
                    saveBtn.classList.remove('save-btn');
                }
            }
        });
        
        // 处理全选checkbox的变化
        document.addEventListener('change', function(event) {
            if (event.target.id === 'select-all-checkbox') {
                const isChecked = event.target.checked;
                const checkboxes = document.querySelectorAll('.item-checkbox');
                
                // 设置所有复选框状态
                checkboxes.forEach(checkbox => {
                    checkbox.checked = isChecked;
                });
                
                // 更新批量删除按钮状态
                updateBatchDeleteButton();
            } else if (event.target.classList.contains('item-checkbox')) {
                // 单个复选框状态变化，更新批量删除按钮
                updateBatchDeleteButton();
                
                // 检查是否需要更新"全选"复选框状态
                updateSelectAllCheckbox();
            }
        });
        
        // 更新批量删除按钮状态
        function updateBatchDeleteButton() {
            const checkedItems = document.querySelectorAll('.item-checkbox:checked');
            const batchDeleteBtn = document.getElementById('batch-delete-btn');
            
            if (checkedItems.length > 0) {
                batchDeleteBtn.disabled = false;
            } else {
                batchDeleteBtn.disabled = true;
            }
        }
        
        // 更新"全选"复选框状态
        function updateSelectAllCheckbox() {
            const allCheckboxes = document.querySelectorAll('.item-checkbox');
            const checkedCheckboxes = document.querySelectorAll('.item-checkbox:checked');
            const selectAllCheckbox = document.getElementById('select-all-checkbox');
            
            if (allCheckboxes.length === checkedCheckboxes.length && allCheckboxes.length > 0) {
                selectAllCheckbox.checked = true;
                selectAllCheckbox.indeterminate = false;
            } else if (checkedCheckboxes.length === 0) {
                selectAllCheckbox.checked = false;
                selectAllCheckbox.indeterminate = false;
            } else {
                selectAllCheckbox.indeterminate = true;
            }
        }
        
        // 处理批量删除按钮点击
        document.addEventListener('click', function(event) {
            if (event.target.id === 'batch-delete-btn') {
                const checkedItems = document.querySelectorAll('.item-checkbox:checked');
                const itemsToDelete = [];
                
                // 收集要删除的项
                checkedItems.forEach(checkbox => {
                    const item = checkbox.closest('.item');
                    const type = item.getAttribute('data-type');
                    const value = item.getAttribute('data-value');
                    
                    itemsToDelete.push({
                        type: type,
                        value: value
                    });
                    
                    // 添加到已删除项目列表
                    if (type === 'identifier') {
                        deletedItems.identifiers.push(value);
                    }
                });
                
                // 从UI中移除所有选中项
                checkedItems.forEach(checkbox => {
                    const item = checkbox.closest('.item');
                    item.remove();
                });
                
                // 更新计数器
                updateCounter('identifier');
                
                // 通知VS Code批量删除了项目
                vscode.postMessage({
                    command: 'batchDeleteItems',
                    items: itemsToDelete
                });
                
                // 更新批量删除按钮状态
                updateBatchDeleteButton();
                
                // 更新全选复选框状态
                updateSelectAllCheckbox();
            }
        });
        
        // 按下ESC键取消编辑, Enter键保存编辑
        document.addEventListener('keydown', function(event) {
            if (!currentEditingElement) return;
            
            if (event.key === 'Escape') {
                // 取消编辑，恢复原始值
                const originalValue = currentEditingElement.getAttribute('data-original');
                currentEditingElement.textContent = originalValue;
                
                exitEditMode();
                event.preventDefault();
            } else if (event.key === 'Enter' && !event.shiftKey) {
                // 保存编辑
                saveEditing(currentEditingElement);
                event.preventDefault();
            }
        });
        
        // 保存编辑
        function saveEditing(element) {
            if (!element) return;
            
            const newValue = element.textContent.trim();
            const originalValue = element.getAttribute('data-original');
            const item = element.closest('.item');
            const type = item.getAttribute('data-type');
            
            // 只有在值变化时才记录修改
            if (newValue !== originalValue) {
                if (type === 'identifier') {
                    modifiedIdentifiers[originalValue] = newValue;
                }
                
                // 更新数据属性
                item.setAttribute('data-value', newValue);
                
                // 通知VS Code值已修改
                vscode.postMessage({
                    command: 'modifyItem',
                    type: type,
                    original: originalValue,
                    new: newValue
                });
            }
            
            exitEditMode();
        }
        
        // 退出编辑模式
        function exitEditMode() {
            if (!currentEditingElement) return;
            
            currentEditingElement.contentEditable = "false";
            currentEditingElement.classList.remove('editing');
            
            const item = currentEditingElement.closest('.item');
            const saveBtn = item.querySelector('.save-btn');
            if (saveBtn) {
                saveBtn.textContent = "✏️";
                saveBtn.title = "编辑";
                saveBtn.classList.add('edit-btn');
                saveBtn.classList.remove('save-btn');
            }
            
            currentEditingElement = null;
        }
        
        // 更新计数器
        function updateCounter(type) {
            const listElement = document.getElementById(type === 'identifier' ? 'identifiers-list' : 'comments-list');
            if (!listElement) return;
            
            const items = listElement.querySelectorAll('.item');
            const counter = listElement.previousElementSibling.querySelector('.count');
            counter.textContent = items.length;
            
            // 如果没有条目了，显示空状态
            if (items.length === 0) {
                const emptyState = document.createElement('div');
                emptyState.className = 'empty-state';
                emptyState.textContent = type === 'identifier' ? '未找到标识符' : '未找到注释';
                listElement.appendChild(emptyState);
            }
        }
        
        // 翻译按钮
        document.getElementById('translate-btn').addEventListener('click', () => {
            // 在转到翻译前，确保所有编辑都保存了
            if (currentEditingElement) {
                saveEditing(currentEditingElement);
            }
            
            vscode.postMessage({ 
                command: 'translate',
                modifiedIdentifiers,
                deletedItems
            });
        });
        
        // 关闭按钮
        document.getElementById('close-btn').addEventListener('click', () => {
            // 在关闭前，确保所有编辑都保存了
            if (currentEditingElement) {
                saveEditing(currentEditingElement);
            }
            
            vscode.postMessage({ 
                command: 'close',
                modifiedIdentifiers,
                deletedItems
            });
        });
    </script>
    </body>
    </html>`;
    
    return html;
}

/**
 * 处理用户修改过的项目
 * @param identifiers 标识符数组
 * @param tempVocabulary 临时词汇表
 * @param modifiedIdentifiers 修改后的标识符映射
 * @param deletedItems 已删除的项目
 */
function handleModifiedItems(
    identifiers: string[],
    tempVocabulary: TempVocabulary,
    modifiedIdentifiers: Record<string, string>,
    deletedItems: { identifiers: string[] }
): void {
    // 我们已经在实时事件处理中更新了数组，这里只需要记录日志
    if (modifiedIdentifiers && Object.keys(modifiedIdentifiers).length > 0) {
        console.log(`[CodeLocalizer] 用户修改了 ${Object.keys(modifiedIdentifiers).length} 个标识符`);
    }
    
    if (deletedItems) {
        if (deletedItems.identifiers && deletedItems.identifiers.length > 0) {
            console.log(`[CodeLocalizer] 用户删除了 ${deletedItems.identifiers.length} 个标识符`);
        }
    }
}

/**
 * 创建并显示翻译结果WebView
 * @param context VS Code扩展上下文
 * @param document 当前文档
 * @param vocabulary 词汇表
 * @param translationResults 翻译结果数组，包含原文、译文和类型
 * @returns 创建的WebView面板
 */
export function showTranslationResultsWebView(
    context: vscode.ExtensionContext,
    document: vscode.TextDocument | null,
    vocabulary: Vocabulary,
    translationResults: Array<{ original: string, translated: string, type: VocabularyEntryType }>
): vscode.WebviewPanel {
    // 创建WebView面板
    const panel = vscode.window.createWebviewPanel(
        'translationResults',
        '翻译结果',
        vscode.ViewColumn.One,
        { enableScripts: true }
    );
    
    // 构建HTML内容
    panel.webview.html = generateTranslationWebViewHtml(translationResults);
    
    // 跟踪修改后的翻译结果
    const modifiedTranslations = new Map<string, string>();
    const deletedTranslations = new Set<string>();
    
    // 处理WebView消息
    panel.webview.onDidReceiveMessage(
        async message => {
            switch (message.command) {
                case 'merge':
                    panel.dispose(); // 关闭当前面板
                    
                    // 处理修改和删除
                    if (message.modifiedTranslations) {
                        Object.entries(message.modifiedTranslations).forEach(([original, translated]) => {
                            modifiedTranslations.set(original, translated as string);
                        });
                    }
                    
                    if (message.deletedItems && message.deletedItems.length > 0) {
                        message.deletedItems.forEach((item: string) => {
                            deletedTranslations.add(item);
                        });
                    }
                    
                    // 准备合并到词汇表的数据
                    const translationsToMerge: Record<string, string> = {};
                    
                    translationResults.forEach(item => {
                        const original = item.original;
                        
                        // 跳过被删除的项
                        if (deletedTranslations.has(original)) {
                            return;
                        }
                        
                        // 使用修改后的翻译，或原始翻译
                        const translatedText = modifiedTranslations.has(original) 
                            ? modifiedTranslations.get(original)! 
                            : item.translated;
                        
                        // 只有翻译与原文不同时才添加
                        if (translatedText !== original) {
                            translationsToMerge[original] = translatedText;
                        }
                    });
                    
                    // 合并到词汇表
                    if (Object.keys(translationsToMerge).length > 0) {
                        await mergeTranslatedItemsToVocabulary(vocabulary, translationsToMerge, 'identifier', 'llm');
                        await saveVocabulary(context, vocabulary);
                        vscode.window.showInformationMessage(`Code Localizer: 已成功合并 ${Object.keys(translationsToMerge).length} 个翻译到词汇表。`);
                    } else {
                        vscode.window.showInformationMessage('Code Localizer: 没有翻译被合并到词汇表。');
                    }
                    break;
                    
                case 'close':
                    panel.dispose(); // 关闭面板
                    vscode.window.showInformationMessage('Code Localizer: 翻译结果未合并。');
                    break;
                    
                case 'modifyItem':
                    // 单个项目修改时，记录修改
                    if (message.original && message.new) {
                        modifiedTranslations.set(message.original, message.new);
                    }
                    break;
                    
                case 'deleteItem':
                    // 单个项目删除时，记录删除
                    if (message.value) {
                        deletedTranslations.add(message.value);
                    }
                    break;
                    
                case 'batchDeleteItems':
                    // 批量删除项目
                    if (message.items && message.items.length > 0) {
                        message.items.forEach((item: string) => {
                            deletedTranslations.add(item);
                        });
                        
                        console.log(`[CodeLocalizer] 批量删除了 ${message.items.length} 个翻译项目`);
                    }
                    break;
            }
        },
        undefined,
        context.subscriptions
    );
    
    return panel;
}

/**
 * 生成翻译结果WebView的HTML内容
 * @param translationResults 翻译结果数组
 * @returns HTML字符串
 */
function generateTranslationWebViewHtml(
    translationResults: Array<{ original: string, translated: string, type: VocabularyEntryType }>
): string {
    let html = `<!DOCTYPE html>
    <html lang="zh-CN">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
        <title>翻译结果</title>
        <style>
            :root {
                --vscode-background: var(--vscode-editor-background, #1e1e1e);
                --vscode-foreground: var(--vscode-editor-foreground, #d4d4d4);
                --vscode-button-background: var(--vscode-button-background, #0e639c);
                --vscode-button-foreground: var(--vscode-button-foreground, white);
                --vscode-button-hover-background: var(--vscode-button-hoverBackground, #1177bb);
                --vscode-list-hoverBackground: var(--vscode-list-hoverBackground, #2a2d2e);
                --vscode-input-background: var(--vscode-input-background, #3c3c3c);
                --vscode-input-foreground: var(--vscode-input-foreground, #cccccc);
                --vscode-input-border: var(--vscode-input-border, #3c3c3c);
                --vscode-border: var(--vscode-panel-border, #80808059);
                --vscode-accent: var(--vscode-focusBorder, #007fd4);
                --vscode-icon-color: var(--vscode-icon-foreground, #c5c5c5);
                --vscode-checkbox-background: var(--vscode-checkbox-background, #3c3c3c);
                --vscode-checkbox-foreground: var(--vscode-checkbox-foreground, #cccccc);
                --vscode-checkbox-border: var(--vscode-checkbox-border, #3c3c3c);
                
                /* 调整背景颜色，使用灰色系替代黑色系 */
                --custom-background: #3a3a3a;
                --custom-list-background: #424242;
                --custom-item-background: #4a4a4a;
                --custom-hover-background: #555555;
                --custom-border-color: #666666;
            }
            
            body { 
                font-family: var(--vscode-font-family, 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif); 
                padding: 20px; 
                background-color: var(--custom-background);
                color: #f0f0f0;
                line-height: 1.5;
                user-select: none; /* 防止无意中选中文本 */
            }
            
            h1 { 
                color: #ffffff; 
                font-size: 1.6em; 
                text-align: center;
                margin-bottom: 20px;
                padding-bottom: 10px;
                border-bottom: 1px solid var(--custom-border-color);
            }
            
            h2 { 
                color: #78b0fa; 
                font-size: 1.3em; 
                margin-top: 20px;
                display: flex;
                align-items: center;
            }
            
            h2::before {
                content: '';
                display: inline-block;
                width: 8px;
                height: 18px;
                background-color: #78b0fa;
                margin-right: 8px;
                border-radius: 2px;
            }
            
            .item-list { 
                max-height: 300px; 
                overflow-y: auto; 
                border: 1px solid var(--custom-border-color); 
                padding: 10px; 
                background-color: var(--custom-list-background);
                border-radius: 4px;
                box-shadow: 0 3px 8px rgba(0, 0, 0, 0.3);
            }
            
            .item { 
                padding: 8px 10px; 
                border-bottom: 1px solid var(--custom-border-color);
                font-family: var(--vscode-editor-font-family, 'Consolas', 'Courier New', monospace);
                display: flex;
                align-items: center;
                position: relative;
                background-color: var(--custom-item-background);
                margin-bottom: 4px;
                border-radius: 3px;
            }
            
            .item:last-child {
                border-bottom: none;
                margin-bottom: 0;
            }
            
            .item:hover {
                background-color: var(--custom-hover-background);
            }
            
            .item-checkbox {
                margin-right: 10px;
                cursor: pointer;
                appearance: none;
                -webkit-appearance: none;
                width: 16px;
                height: 16px;
                border: 1px solid var(--vscode-checkbox-border);
                background-color: var(--vscode-checkbox-background);
                border-radius: 3px;
                position: relative;
            }
            
            .item-checkbox:checked {
                background-color: var(--vscode-button-background);
                border-color: var(--vscode-button-background);
            }
            
            .item-checkbox:checked::after {
                content: '✓';
                position: absolute;
                color: var(--vscode-button-foreground);
                font-size: 12px;
                top: -1px;
                left: 2px;
            }
            
            .translation-pair {
                flex-grow: 1;
                display: flex;
                flex-direction: column;
                gap: 4px;
                padding: 2px 5px;
            }
            
            .original-text {
                color: #cccccc;
                font-size: 0.9em;
            }
            
            .translated-text {
                color: #ffffff;
                font-weight: bold;
                cursor: text;
                padding: 2px 0;
                border-radius: 3px;
                user-select: text; /* 允许文本选择 */
            }
            
            .translated-text.editing {
                background-color: #333333;
                color: #ffffff;
                border: 1px solid var(--vscode-accent);
                outline: none;
                padding: 2px 5px;
            }
            
            .item-actions {
                display: flex;
                gap: 8px;
                opacity: 0.5;
                transition: opacity 0.2s;
            }
            
            .item:hover .item-actions {
                opacity: 1;
            }
            
            .action-btn {
                background: none;
                border: none;
                color: var(--vscode-icon-color);
                cursor: pointer;
                font-size: 14px;
                padding: 2px 6px;
                border-radius: 3px;
                outline: none;
            }
            
            .action-btn:hover {
                background-color: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
            }
            
            .delete-btn:hover {
                background-color: #d32f2f;
            }
            
            .count { 
                font-weight: bold; 
                color: white;
                background-color: #0078d4;
                padding: 2px 8px;
                border-radius: 10px;
                font-size: 0.9em;
                margin-left: 8px;
            }
            
            .button-container { 
                margin-top: 20px; 
                display: flex; 
                gap: 10px; 
                justify-content: center; 
            }
            
            button { 
                padding: 8px 20px; 
                background-color: #0078d4; 
                color: white; 
                border: none; 
                cursor: pointer; 
                border-radius: 4px;
                font-size: 14px;
                transition: all 0.3s;
            }
            
            button:hover { 
                background-color: #106ebe; 
            }
            
            .secondary { 
                background-color: #5a5a5a; 
                color: white;
                border: 1px solid #666666;
            }
            
            .secondary:hover { 
                background-color: #6e6e6e; 
            }
            
            .empty-state {
                padding: 20px;
                text-align: center;
                color: var(--vscode-descriptionForeground);
                font-style: italic;
            }
            
            .header-actions {
                display: flex;
                align-items: center;
                margin-left: auto;
                gap: 10px;
            }
            
            .select-all-container {
                display: flex;
                align-items: center;
                margin-right: 10px;
                cursor: pointer;
                background-color: #585858;
                padding: 3px 8px;
                border-radius: 3px;
                color: #ffffff;
            }
            
            .select-all-container:hover {
                background-color: #666666;
            }
            
            .select-all-checkbox {
                margin-right: 5px;
                cursor: pointer;
                appearance: none;
                -webkit-appearance: none;
                width: 16px;
                height: 16px;
                border: 1px solid var(--vscode-checkbox-border);
                background-color: var(--vscode-checkbox-background);
                border-radius: 3px;
                position: relative;
            }
            
            .select-all-checkbox:checked {
                background-color: var(--vscode-button-background);
                border-color: var(--vscode-button-background);
            }
            
            .select-all-checkbox:checked::after {
                content: '✓';
                position: absolute;
                color: var(--vscode-button-foreground);
                font-size: 12px;
                top: -1px;
                left: 2px;
            }
            
            .batch-delete-btn {
                background-color: #cc3333;
                color: white;
                border: none;
                cursor: pointer;
                padding: 4px 10px;
                border-radius: 3px;
                font-size: 12px;
                opacity: 0.9;
                transition: opacity 0.3s;
            }
            
            .batch-delete-btn:hover {
                opacity: 1;
            }
            
            .batch-delete-btn:disabled {
                background-color: #888;
                cursor: not-allowed;
                opacity: 0.3;
            }
        </style>
    </head>
    <body>
        <h1>翻译结果</h1>`;
    
    const identifierResults = translationResults.filter(item => item.type === 'identifier');
    
    if (identifierResults.length > 0) {
        html += `
        <h2>
            标识符翻译 (<span class="count">${identifierResults.length}</span>)
            <div class="header-actions">
                <label class="select-all-container">
                    <input type="checkbox" id="select-all-checkbox" class="select-all-checkbox">
                    <span>全选</span>
                </label>
                <button id="batch-delete-btn" class="batch-delete-btn" disabled>批量删除</button>
            </div>
        </h2>
        <div class="item-list" id="identifiers-list">
            ${identifierResults.map((item, index) => `
            <div class="item" data-index="${index}" data-value="${escapeHtml(item.original)}">
                <input type="checkbox" class="item-checkbox">
                <div class="translation-pair">
                    <div class="original-text">${escapeHtml(item.original)}</div>
                    <div class="translated-text" contenteditable="false" data-original="${escapeHtml(item.translated)}">${escapeHtml(item.translated)}</div>
                </div>
                <div class="item-actions">
                    <button class="action-btn edit-btn" title="编辑译文">✏️</button>
                    <button class="action-btn delete-btn" title="删除">🗑️</button>
                </div>
            </div>`).join('')}
        </div>`;
    } else {
        html += `
        <h2>标识符翻译 (<span class="count">0</span>)</h2>
        <div class="item-list">
            <div class="empty-state">没有可用的翻译结果</div>
        </div>`;
    }
    
    // 添加按钮区域
    html += `
    <div class="button-container">
        <button id="merge-btn">合并到词汇表</button>
        <button id="close-btn" class="secondary">关闭</button>
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        
        // 当前编辑的元素
        let currentEditingElement = null;
        
        // 跟踪修改过的数据
        const modifiedTranslations = {};
        const deletedItems = [];
        
        // 编辑功能
        document.addEventListener('click', function(event) {
            // 处理编辑按钮点击
            if (event.target.classList.contains('edit-btn')) {
                const item = event.target.closest('.item');
                const textElement = item.querySelector('.translated-text');
                
                // 如果当前有其他正在编辑的元素，先保存它
                if (currentEditingElement && currentEditingElement !== textElement) {
                    saveEditing(currentEditingElement);
                }
                
                // 进入编辑模式
                textElement.contentEditable = "true";
                textElement.classList.add('editing');
                textElement.focus();
                
                // 为了确保光标位于文本末尾
                const range = document.createRange();
                range.selectNodeContents(textElement);
                range.collapse(false);
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
                
                currentEditingElement = textElement;
                
                // 更改编辑按钮显示为保存
                event.target.textContent = "💾";
                event.target.title = "保存";
                event.target.classList.add('save-btn');
                event.target.classList.remove('edit-btn');
                return;
            }
            
            // 处理保存按钮点击
            if (event.target.classList.contains('save-btn')) {
                const textElement = event.target.closest('.item').querySelector('.translated-text');
                saveEditing(textElement);
                
                // 恢复按钮状态
                event.target.textContent = "✏️";
                event.target.title = "编辑译文";
                event.target.classList.add('edit-btn');
                event.target.classList.remove('save-btn');
                return;
            }
            
            // 处理删除按钮点击
            if (event.target.classList.contains('delete-btn')) {
                const item = event.target.closest('.item');
                const value = item.getAttribute('data-value');
                
                // 添加到已删除项目列表
                deletedItems.push(value);
                
                // 从UI中移除
                item.remove();
                
                // 更新计数器
                updateCounter();
                
                // 通知VS Code删除了项目
                vscode.postMessage({
                    command: 'deleteItem',
                    value: value
                });
                return;
            }
            
            // 如果点击了其他区域，且有编辑中的元素，保存它
            if (currentEditingElement && !event.target.contains(currentEditingElement)) {
                saveEditing(currentEditingElement);
                
                // 找到对应的按钮并恢复状态
                const item = currentEditingElement.closest('.item');
                const saveBtn = item.querySelector('.save-btn');
                if (saveBtn) {
                    saveBtn.textContent = "✏️";
                    saveBtn.title = "编辑译文";
                    saveBtn.classList.add('edit-btn');
                    saveBtn.classList.remove('save-btn');
                }
            }
        });
        
        // 处理全选checkbox的变化
        document.addEventListener('change', function(event) {
            if (event.target.id === 'select-all-checkbox') {
                const isChecked = event.target.checked;
                const checkboxes = document.querySelectorAll('.item-checkbox');
                
                // 设置所有复选框状态
                checkboxes.forEach(checkbox => {
                    checkbox.checked = isChecked;
                });
                
                // 更新批量删除按钮状态
                updateBatchDeleteButton();
            } else if (event.target.classList.contains('item-checkbox')) {
                // 单个复选框状态变化，更新批量删除按钮
                updateBatchDeleteButton();
                
                // 检查是否需要更新"全选"复选框状态
                updateSelectAllCheckbox();
            }
        });
        
        // 更新批量删除按钮状态
        function updateBatchDeleteButton() {
            const checkedItems = document.querySelectorAll('.item-checkbox:checked');
            const batchDeleteBtn = document.getElementById('batch-delete-btn');
            
            if (checkedItems.length > 0) {
                batchDeleteBtn.disabled = false;
            } else {
                batchDeleteBtn.disabled = true;
            }
        }
        
        // 更新"全选"复选框状态
        function updateSelectAllCheckbox() {
            const allCheckboxes = document.querySelectorAll('.item-checkbox');
            const checkedCheckboxes = document.querySelectorAll('.item-checkbox:checked');
            const selectAllCheckbox = document.getElementById('select-all-checkbox');
            
            if (allCheckboxes.length === checkedCheckboxes.length && allCheckboxes.length > 0) {
                selectAllCheckbox.checked = true;
                selectAllCheckbox.indeterminate = false;
            } else if (checkedCheckboxes.length === 0) {
                selectAllCheckbox.checked = false;
                selectAllCheckbox.indeterminate = false;
            } else {
                selectAllCheckbox.indeterminate = true;
            }
        }
        
        // 处理批量删除按钮点击
        document.addEventListener('click', function(event) {
            if (event.target.id === 'batch-delete-btn') {
                const checkedItems = document.querySelectorAll('.item-checkbox:checked');
                const itemsToDelete = [];
                
                // 收集要删除的项
                checkedItems.forEach(checkbox => {
                    const item = checkbox.closest('.item');
                    const value = item.getAttribute('data-value');
                    itemsToDelete.push(value);
                    
                    // 添加到已删除项目列表
                    deletedItems.push(value);
                });
                
                // 从UI中移除所有选中项
                checkedItems.forEach(checkbox => {
                    const item = checkbox.closest('.item');
                    item.remove();
                });
                
                // 更新计数器
                updateCounter();
                
                // 通知VS Code批量删除了项目
                vscode.postMessage({
                    command: 'batchDeleteItems',
                    items: itemsToDelete
                });
                
                // 更新批量删除按钮状态
                updateBatchDeleteButton();
                
                // 更新全选复选框状态
                updateSelectAllCheckbox();
            }
        });
        
        // 按下ESC键取消编辑, Enter键保存编辑
        document.addEventListener('keydown', function(event) {
            if (!currentEditingElement) return;
            
            if (event.key === 'Escape') {
                // 取消编辑，恢复原始值
                const originalValue = currentEditingElement.getAttribute('data-original');
                currentEditingElement.textContent = originalValue;
                
                exitEditMode();
                event.preventDefault();
            } else if (event.key === 'Enter' && !event.shiftKey) {
                // 保存编辑
                saveEditing(currentEditingElement);
                event.preventDefault();
            }
        });
        
        // 保存编辑
        function saveEditing(element) {
            if (!element) return;
            
            const newValue = element.textContent.trim();
            const originalValue = element.getAttribute('data-original');
            const item = element.closest('.item');
            const itemOriginal = item.getAttribute('data-value');
            
            // 只有在值变化时才记录修改
            if (newValue !== originalValue) {
                modifiedTranslations[itemOriginal] = newValue;
                
                // 通知VS Code值已修改
                vscode.postMessage({
                    command: 'modifyItem',
                    original: itemOriginal,
                    new: newValue
                });
            }
            
            exitEditMode();
        }
        
        // 退出编辑模式
        function exitEditMode() {
            if (!currentEditingElement) return;
            
            currentEditingElement.contentEditable = "false";
            currentEditingElement.classList.remove('editing');
            
            const item = currentEditingElement.closest('.item');
            const saveBtn = item.querySelector('.save-btn');
            if (saveBtn) {
                saveBtn.textContent = "✏️";
                saveBtn.title = "编辑译文";
                saveBtn.classList.add('edit-btn');
                saveBtn.classList.remove('save-btn');
            }
            
            currentEditingElement = null;
        }
        
        // 更新计数器
        function updateCounter() {
            const listElement = document.getElementById('identifiers-list');
            if (!listElement) return;
            
            const items = listElement.querySelectorAll('.item');
            const counter = listElement.previousElementSibling.querySelector('.count');
            counter.textContent = items.length;
            
            // 如果没有条目了，显示空状态
            if (items.length === 0) {
                const emptyState = document.createElement('div');
                emptyState.className = 'empty-state';
                emptyState.textContent = '没有可用的翻译结果';
                listElement.appendChild(emptyState);
            }
        }
        
        // 合并按钮
        document.getElementById('merge-btn').addEventListener('click', () => {
            // 在合并前，确保所有编辑都保存了
            if (currentEditingElement) {
                saveEditing(currentEditingElement);
            }
            
            vscode.postMessage({ 
                command: 'merge',
                modifiedTranslations,
                deletedItems
            });
        });
        
        // 关闭按钮
        document.getElementById('close-btn').addEventListener('click', () => {
            // 在关闭前，确保所有编辑都保存了
            if (currentEditingElement) {
                saveEditing(currentEditingElement);
            }
            
            vscode.postMessage({ 
                command: 'close'
            });
        });
    </script>
    </body>
    </html>`;
    
    return html;
} 