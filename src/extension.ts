// 扩展主入口文件
import * as vscode from 'vscode';
import { Vocabulary, TempVocabulary } from './types';
import { loadVocabulary, initTempVocabulary, initializeEntriesFromSeedDataIfNeeded } from './vocabulary/vocabulary-manager';
import { getTargetLanguage } from './config/config-manager';
import { registerCommands } from './commands/command-register';
import { collectAndPrepareTranslatableItems } from './extraction/extractor';
import { processContributionQueue } from './contribution/contribution-manager';
import { applyMotherTongueDecorations, refreshAllDecorations, clearAllDecorations } from './ui/decorator-manager';
import * as fs from 'fs';
import * as path from 'path';

// 全局变量
let currentVocabulary: Vocabulary | null = null;
let currentTempVocabulary: TempVocabulary | null = null;
let isExtractionEnabled: boolean = true; // 新增：控制是否允许提取功能的标志
let globalExtensionContext: vscode.ExtensionContext | null = null;

/**
 * 扩展激活函数
 * @param context 扩展上下文
 */
export async function activate(context: vscode.ExtensionContext) {
    try {
        console.log('[CodeLocalizer] 扩展 "code-localizer-demo" 正在激活...');
        
        // 保存全局扩展上下文
        globalExtensionContext = context;
        
        // 记录全局存储信息
        console.log(`[CodeLocalizer] globalStorageUri 可用: ${context.globalStorageUri ? '是' : '否'}`);
        if (context.globalStorageUri) {
            console.log(`[CodeLocalizer] globalStorageUri 路径: ${context.globalStorageUri.fsPath}`);
        }
        
        // 检查工作区状态
        const hasWorkspaceFolders = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0;
        if (!hasWorkspaceFolders) {
            console.log("[CodeLocalizer] 无工作区文件夹打开，将使用扩展目录和全局存储进行词汇表管理。");
        } else {
            console.log(`[CodeLocalizer] 已找到工作区文件夹: ${vscode.workspace.workspaceFolders!.map(f => f.uri.fsPath).join(', ')}`);
        }

        // 确定目标语言
        const targetLang = getTargetLanguage();
        console.log(`[CodeLocalizer] 目标语言确定为: ${targetLang}`);
        
        // 列出当前目录下的所有词汇表文件，用于调试
        console.log(`[CodeLocalizer Debug] 扩展目录路径: ${context.extensionUri.fsPath}`);
        console.log(`[CodeLocalizer Debug] 当前工作目录: ${process.cwd()}`);
        
        try {
            const files = fs.readdirSync(process.cwd());
            const vocabFiles = files.filter(f => f.startsWith('loc_core_vocabulary_'));
            console.log(`[CodeLocalizer Debug] 找到词汇表文件: ${vocabFiles.join(', ')}`);
            
            // 检查目标语言的词汇表文件是否存在
            const targetVocabFile = `loc_core_vocabulary_${targetLang}.json`;
            if (vocabFiles.includes(targetVocabFile)) {
                console.log(`[CodeLocalizer Debug] 目标语言词汇表文件存在: ${targetVocabFile}`);
                // 确认文件是否可读
                try {
                    const stat = fs.statSync(path.join(process.cwd(), targetVocabFile));
                    console.log(`[CodeLocalizer Debug] 词汇表文件大小: ${stat.size} 字节`);
                    
                    // 直接加载词汇表文件进行测试
                    try {
                        const fileContent = fs.readFileSync(path.join(process.cwd(), targetVocabFile), 'utf-8');
                        const loadedVocab = JSON.parse(fileContent);
                        console.log(`[CodeLocalizer Debug] 直接加载词汇表成功，包含 ${Object.keys(loadedVocab.system_vocabulary).length} 个系统词汇项`);
                    } catch (readErr) {
                        console.error(`[CodeLocalizer Debug] 直接读取词汇表失败: ${readErr}`);
                    }
                } catch (statErr) {
                    console.error(`[CodeLocalizer Debug] 无法获取词汇表文件信息: ${statErr}`);
                }
            } else {
                console.warn(`[CodeLocalizer Debug] 未找到目标语言词汇表文件: ${targetVocabFile}`);
            }
        } catch (fsErr) {
            console.error(`[CodeLocalizer Debug] 检查词汇表文件时出错: ${fsErr}`);
        }
        
        // 加载词汇表
        console.log(`[CodeLocalizer] 开始加载词汇表...`);
        try {
            currentVocabulary = await loadVocabulary(context);
            
            if (!currentVocabulary) {
                console.error("[CodeLocalizer] 严重错误: 词汇表加载失败。扩展可能无法正常工作。");
                
                // 尝试手动加载默认词汇表
                try {
                    const defaultVocabPath = path.join(process.cwd(), `loc_core_vocabulary_zh-CN.json`);
                    console.log(`[CodeLocalizer] 尝试手动加载默认词汇表: ${defaultVocabPath}`);
                    
                    if (fs.existsSync(defaultVocabPath)) {
                        const vocabData = fs.readFileSync(defaultVocabPath, 'utf-8');
                        try {
                            currentVocabulary = JSON.parse(vocabData);
                            console.log(`[CodeLocalizer] 成功手动加载默认词汇表`);
                            // @ts-ignore 
                            initializeEntriesFromSeedDataIfNeeded(currentVocabulary);
                        } catch (parseErr) {
                            console.error(`[CodeLocalizer] 解析词汇表文件失败: ${parseErr}`);
                            vscode.window.showErrorMessage(`Code Localizer: 词汇表文件格式错误。`);
                        }
                    } else {
                        console.error(`[CodeLocalizer] 默认词汇表文件不存在`);
                    }
                } catch (manualErr) {
                    console.error(`[CodeLocalizer] 手动加载词汇表时出错: ${manualErr}`);
                }
                
                if (!currentVocabulary) {
                    vscode.window.showErrorMessage("Code Localizer: 无法加载词汇表。请重新安装扩展。");
                    return;
                }
            }
        } catch (loadErr) {
            console.error(`[CodeLocalizer] 加载词汇表过程中发生错误: ${loadErr}`);
            vscode.window.showErrorMessage(`Code Localizer: 加载词汇表时出错: ${loadErr instanceof Error ? loadErr.message : String(loadErr)}`);
            return; // 出错时直接返回，避免继续执行
        }
        
        // 确保此时currentVocabulary一定不为null
        if (!currentVocabulary) {
            console.error("[CodeLocalizer] 严重错误: 词汇表仍然为null，无法继续。");
            vscode.window.showErrorMessage("Code Localizer: 词汇表初始化失败，扩展无法正常工作。");
            return;
        }
        
        console.log("[CodeLocalizer] 词汇表加载成功:", JSON.stringify(currentVocabulary.meta));
        
        // 如果加载了词汇表，设置正确的目标语言
        if (currentVocabulary.target_language !== targetLang) {
            console.log(`[CodeLocalizer] 更新词汇表目标语言，从 ${currentVocabulary.target_language} 到 ${targetLang}`);
            currentVocabulary.target_language = targetLang;
        }
        
        // 初始化临时词汇表
        currentTempVocabulary = initTempVocabulary();
        
        // 注册工作区文件夹变更事件处理
        const workspaceFoldersChangeDisposable = vscode.workspace.onDidChangeWorkspaceFolders(
            (event) => handleWorkspaceFoldersChanged(event, context)
        );
        context.subscriptions.push(workspaceFoldersChangeDisposable);

        // 注册命令
        if (currentVocabulary && currentTempVocabulary) {
            registerCommands(context, currentVocabulary, currentTempVocabulary);
            
            // 添加刷新所有文件装饰的命令
            const refreshAllCommand = vscode.commands.registerCommand('codeLocalizerDemo.refreshAllFiles', () => {
                if (currentVocabulary) {
                    vscode.window.showInformationMessage('正在刷新所有文件的母语翻译...');
                    refreshAllDecorations(currentVocabulary);
                }
            });
            context.subscriptions.push(refreshAllCommand);
        }

        // 注册母语显示相关的事件和命令
        registerMotherTongueDisplay(context);

        console.log('[CodeLocalizer] 扩展 "code-localizer-demo" 激活完成.');
    } catch (error) {
        console.error(`[CodeLocalizer] 扩展激活过程中发生严重错误:`, error);
        vscode.window.showErrorMessage(`Code Localizer: 扩展激活失败: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * 注册母语显示相关的事件和命令
 */
function registerMotherTongueDisplay(context: vscode.ExtensionContext): void {
    // 注册编辑器变化事件
    const activeEditorChangeDisposable = vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor && currentVocabulary) {
            // 使用void操作符忽略Promise
            void applyMotherTongueDecorations(editor, currentVocabulary);
            
            // 已修改：明确指定不要在编辑器变化时执行提取
            // 完全移除此处对handleOpenTextDocument的调用，避免任何可能的提取
        }
    });
    context.subscriptions.push(activeEditorChangeDisposable);

    // 注册编辑器可见性变化事件
    const visibleEditorsChangeDisposable = vscode.window.onDidChangeVisibleTextEditors(editors => {
        if (currentVocabulary) {
            editors.forEach(editor => {
                // 使用void操作符忽略Promise
                if (currentVocabulary) {
                    void applyMotherTongueDecorations(editor, currentVocabulary);
                    
                    // 已修改：明确指定不要在编辑器变化时执行提取
                    // 完全移除此处对handleOpenTextDocument的调用，避免任何可能的提取
                }
            });
        }
    });
    context.subscriptions.push(visibleEditorsChangeDisposable);

    // 注册文档内容变化事件
    const documentChangeDisposable = vscode.workspace.onDidChangeTextDocument(event => {
        // 文档内容变化时，重新应用装饰
        const editor = vscode.window.visibleTextEditors.find(
            editor => editor.document.uri.toString() === event.document.uri.toString()
        );
        if (editor && currentVocabulary) {
            // 添加延迟，避免频繁更新
            setTimeout(() => {
                if (currentVocabulary) {
                    // 使用void操作符忽略Promise
                    void applyMotherTongueDecorations(editor, currentVocabulary);
                    
                    // 不要在此处调用handleOpenTextDocument
                }
            }, 500);
        }
    });
    context.subscriptions.push(documentChangeDisposable);

    // 注册配置变化事件
    const configChangeDisposable = vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('codeLocalizerDemo.enableMotherTongueDisplay') ||
            event.affectsConfiguration('codeLocalizerDemo.motherTongueDisplayStyle') ||
            event.affectsConfiguration('codeLocalizerDemo.targetLanguage')) {
            
            if (currentVocabulary) {
                // 配置变化，可能需要重新生成entries
                if (event.affectsConfiguration('codeLocalizerDemo.targetLanguage')) {
                    const targetLang = getTargetLanguage();
                    currentVocabulary.target_language = targetLang;
                    currentVocabulary.entries = []; // 清空现有 entries
                    initializeEntriesFromSeedDataIfNeeded(currentVocabulary); // 使用新语言的种子数据重新初始化
                    console.log(`[CodeLocalizer] 目标语言配置更改为 ${targetLang}，词汇表已重置并重新初始化entries。`);
                }
                
                // 刷新所有编辑器
                const enableDisplay = vscode.workspace.getConfiguration('codeLocalizerDemo').get<boolean>('enableMotherTongueDisplay', true);
                if (enableDisplay) {
                    // 使用void操作符忽略Promise
                    void refreshAllDecorations(currentVocabulary);
                } else {
                    clearAllDecorations();
                }
            }
        }
    });
    context.subscriptions.push(configChangeDisposable);

    // 注册切换母语显示命令
    const toggleDisplayDisposable = vscode.commands.registerCommand('codeLocalizerDemo.toggleMotherTongueDisplay', async () => {
        const config = vscode.workspace.getConfiguration('codeLocalizerDemo');
        const currentEnabled = config.get<boolean>('enableMotherTongueDisplay', true);
        
        try {
            // 在切换母语显示时临时禁用提取功能
            isExtractionEnabled = false;
            
            // 如果临时词汇表被清空过，确保它在母语模式切换时仍然保持为空
            const wasCleared = context.workspaceState.get('tempVocabulary.cleared', false);
            if (wasCleared && currentTempVocabulary) {
                const outputChannel = vscode.window.createOutputChannel("Code Localizer Log", { log: true });
                outputChannel.appendLine(`[CodeLocalizer DEBUG] 母语显示切换: 发现临时词汇表曾被清空，确保它保持为空`);
                
                // 确保数组为空
                currentTempVocabulary.new_identifiers = [];
            }
            
            // 切换状态
            await config.update('enableMotherTongueDisplay', !currentEnabled, vscode.ConfigurationTarget.Global);
            
            if (!currentEnabled) {
                // 如果从禁用到启用，应用装饰
                vscode.window.showInformationMessage('已启用代码母语显示');
                if (currentVocabulary) {
                    // 使用void操作符忽略Promise
                    void refreshAllDecorations(currentVocabulary);
                }
            } else {
                // 如果从启用到禁用，清除所有装饰
                vscode.window.showInformationMessage('已禁用代码母语显示');
                clearAllDecorations();
            }
        } finally {
            // 确保在操作完成后恢复提取功能
            setTimeout(() => {
                isExtractionEnabled = true;
                console.log('[CodeLocalizer] 提取功能已恢复。');
            }, 1000); // 添加1秒延迟，确保所有事件都处理完毕
        }
    });
    context.subscriptions.push(toggleDisplayDisposable);

    // 注册刷新母语显示命令
    const refreshDisplayDisposable = vscode.commands.registerCommand('codeLocalizerDemo.refreshMotherTongueDisplay', async () => {
        if (currentVocabulary) {
            vscode.window.showInformationMessage('正在刷新代码母语显示...');
            
            try {
                // 在刷新母语显示时临时禁用提取功能
                isExtractionEnabled = false;
                
                // 重新加载词汇表
                const targetLang = getTargetLanguage();
                currentVocabulary = await loadVocabulary(context, targetLang);
                // 确保词汇表非空
                if (!currentVocabulary) {
                    vscode.window.showErrorMessage('词汇表加载失败，无法刷新显示');
                    return;
                }
                // 应用装饰
                void refreshAllDecorations(currentVocabulary);
                vscode.window.showInformationMessage('词汇表已重新加载，显示已刷新');
            } catch (error) {
                console.error('[CodeLocalizer] 刷新显示时出错:', error);
                vscode.window.showErrorMessage(`刷新显示失败: ${error instanceof Error ? error.message : String(error)}`);
            } finally {
                // 确保在操作完成后恢复提取功能
                setTimeout(() => {
                    isExtractionEnabled = true;
                    console.log('[CodeLocalizer] 提取功能已恢复。');
                }, 1000); // 添加1秒延迟，确保所有事件都处理完毕
            }
        }
    });
    context.subscriptions.push(refreshDisplayDisposable);

    // 初始应用装饰到所有可见编辑器
    if (currentVocabulary) {
        vscode.window.visibleTextEditors.forEach(editor => {
            // 使用void操作符忽略Promise
            if (currentVocabulary) {
                void applyMotherTongueDecorations(editor, currentVocabulary);
            }
        });
    }
}

/**
 * 扩展停用函数
 */
export function deactivate() {
    console.log('[CodeLocalizer] 扩展 "code-localizer-demo" 正在停用...');
    
    // 清除所有母语显示装饰
    clearAllDecorations();
    
    // 尝试处理剩余的贡献队列
    try {
        const extensionContext = globalExtensionContext;
        if (extensionContext) {
            console.log('[CodeLocalizer] 尝试在停用前处理贡献队列...');
            processContributionQueue(extensionContext).catch(err => 
                console.error('[CodeLocalizer] 处理贡献队列失败:', err)
            );
        }
    } catch (error) {
        console.error('[CodeLocalizer] 停用时处理贡献队列出错:', error);
    }
}

/**
 * 处理工作区文件夹变更事件
 * @param event 工作区文件夹变更事件
 * @param context 扩展上下文
 */
async function handleWorkspaceFoldersChanged(
    event: vscode.WorkspaceFoldersChangeEvent, 
    context: vscode.ExtensionContext
): Promise<void> {
    console.log(`[CodeLocalizer] 工作区文件夹已变更. 添加: ${event.added.length}, 移除: ${event.removed.length}`);
    
    // 如果工作区发生变化，重新加载词汇表
    currentVocabulary = await loadVocabulary(context);
    
    if (currentVocabulary) {
        vscode.window.showInformationMessage('Code Localizer: 工作区变更，已重新加载词汇表。');
    }
}

/**
 * 执行文档内容的提取
 * 该函数应该仅在用户显式调用提取命令时使用，不应自动执行
 * @param document 文本文档
 * @param context 扩展上下文
 * @returns 提取的结果
 */
export async function extractDocumentContent(
    document: vscode.TextDocument, 
    context: vscode.ExtensionContext
): Promise<{newIdentifiers: string[]}> {
    // 创建日志通道
    const outputChannel = vscode.window.createOutputChannel("Code Localizer Log", { log: true });
    outputChannel.appendLine(`[CodeLocalizer DEBUG] extractDocumentContent CALLED FOR: ${document.uri.fsPath} at ${new Date().toISOString()}`);
    
    // 跳过非文本文件或不支持的语言
    if (document.isUntitled || document.languageId === 'markdown' || document.languageId === 'plaintext') {
        return { newIdentifiers: [] };
    }
    
    console.log(`[CodeLocalizer] 开始提取文件内容: ${document.uri.fsPath} (${document.languageId})`);
    
    if (!currentVocabulary) {
        console.log(`[CodeLocalizer] 无法处理文件，词汇表未加载。`);
        return { newIdentifiers: [] };
    }
    
    // 提取标识符
    const { newIdentifiers } = await collectAndPrepareTranslatableItems(document, currentVocabulary, context);
    
    console.log(`[CodeLocalizer] 在文件中提取到 ${newIdentifiers.length} 个新标识符。`);
    outputChannel.appendLine(`[CodeLocalizer DEBUG] 从 ${document.uri.fsPath} 提取到: ${newIdentifiers.length} 个新标识符`);
    
    return { newIdentifiers };
}

/**
 * 更新临时词汇表
 * 将提取的内容添加到临时词汇表中
 * @param newIdentifiers 新标识符数组
 */
export function updateTempVocabulary(newIdentifiers: string[]): void {
    if (!currentTempVocabulary) {
        currentTempVocabulary = initTempVocabulary();
    }
    
    // 记录更新前的状态
    const originalTempIdentifiersCount = currentTempVocabulary.new_identifiers.length;
    
    // 添加到临时词汇表并去重
    currentTempVocabulary.new_identifiers = Array.from(new Set([...currentTempVocabulary.new_identifiers, ...newIdentifiers]));
    
    // 记录更新后的状态
    const newTempIdentifiersCount = currentTempVocabulary.new_identifiers.length;
    
    console.log(`[CodeLocalizer] 更新临时词汇表: 标识符 ${originalTempIdentifiersCount} -> ${newTempIdentifiersCount}`);
} 