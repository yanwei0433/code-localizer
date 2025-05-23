// 词汇表管理器，处理词汇表的加载、保存和合并等核心功能
import * as vscode from 'vscode';
import { Vocabulary, TempVocabulary, VocabularyStorageLocation, ContributionItem, VocabularyEntry, VocabularyEntryType } from '../types';
import { 
    loadVocabularyFromFile, 
    saveVocabularyToFile, 
    getVocabularyPath, 
    fileExists 
} from './vocabulary-storage';
import { queueTranslationContribution } from '../contribution/contribution-manager';
import { getStem, isSameWordRoot } from '../extraction/extractor'; // 导入词根相关函数

/**
 * 查找词汇表中的条目，支持忽略大小写匹配
 * @param vocabulary 词汇表对象
 * @param originalText 要查找的原文
 * @param itemType 可选，词条类型
 * @param ignoreCase 是否忽略大小写
 * @returns 找到的条目索引，未找到返回-1
 */
export function findVocabularyEntryIndex(
    vocabulary: Vocabulary, 
    originalText: string, 
    itemType?: VocabularyEntryType,
    ignoreCase: boolean = true
): number {
    if (!vocabulary || !vocabulary.entries || !originalText) {
        return -1;
    }
    
    // 1. 首先尝试精确匹配（区分大小写）
    let entryIndex = vocabulary.entries.findIndex(entry => {
        const typeMatches = !itemType || entry.type === itemType;
        return typeMatches && entry.original === originalText;
    });
    
    // 2. 如果精确匹配失败且允许忽略大小写，则尝试不区分大小写匹配
    if (entryIndex === -1 && ignoreCase) {
        const lowerCaseText = originalText.toLowerCase();
        entryIndex = vocabulary.entries.findIndex(entry => {
            const typeMatches = !itemType || entry.type === itemType;
            return typeMatches && entry.original.toLowerCase() === lowerCaseText;
        });
        
        // 记录忽略大小写匹配成功的日志
        if (entryIndex !== -1) {
            console.log(`[CodeLocalizer] 忽略大小写匹配成功: "${originalText}" 匹配到词汇表中的 "${vocabulary.entries[entryIndex].original}"`);
        }
    }
    
    // 3. 如果仍然没有匹配，尝试简化内容匹配（去除非字母字符）
    if (entryIndex === -1 && ignoreCase) {
        // 简化搜索文本 - 只保留字母，转换为小写
        const simplifiedSearchText = originalText.replace(/[^a-zA-Z]/g, '').toLowerCase();
        if (simplifiedSearchText.length >= 3) { // 只处理长度足够的简化文本
            entryIndex = vocabulary.entries.findIndex(entry => {
                if (!itemType || entry.type === itemType) {
                    const simplifiedEntryText = entry.original.replace(/[^a-zA-Z]/g, '').toLowerCase();
                    return simplifiedEntryText === simplifiedSearchText;
                }
                return false;
            });
            
            if (entryIndex !== -1) {
                console.log(`[CodeLocalizer] 简化内容匹配成功: "${originalText}" 匹配到词汇表中的 "${vocabulary.entries[entryIndex].original}"`);
            }
        }
    }
    
    // 4. 最后尝试词根匹配，如果先前的匹配都失败
    if (entryIndex === -1 && ignoreCase) {
        const stemText = getStem(originalText.toLowerCase());
        if (stemText.length >= 3) { // 只处理长度足够的词根
            entryIndex = vocabulary.entries.findIndex(entry => {
                if (!itemType || entry.type === itemType) {
                    const entryStem = getStem(entry.original.toLowerCase());
                    return entryStem === stemText;
                }
                return false;
            });
            
            if (entryIndex !== -1) {
                console.log(`[CodeLocalizer] 词根匹配成功: "${originalText}" (词根:"${stemText}") 匹配到词汇表中的 "${vocabulary.entries[entryIndex].original}" (词根:"${getStem(vocabulary.entries[entryIndex].original.toLowerCase())}")`);
            }
        }
    }
    
    return entryIndex;
}

/**
 * 创建大小写不敏感的查找映射
 * @param vocabulary 词汇表对象
 * @param itemType 可选，条目类型
 * @returns 小写原文到条目索引的映射
 */
export function createCaseInsensitiveEntryMap(
    vocabulary: Vocabulary,
    itemType?: VocabularyEntryType
): Map<string, number> {
    const lowerCaseEntryMap = new Map<string, number>();
    
    if (!vocabulary || !vocabulary.entries) {
        return lowerCaseEntryMap;
    }
    
    vocabulary.entries.forEach((entry, index) => {
        if (!itemType || entry.type === itemType) {
            const lowerCaseKey = entry.original.toLowerCase();
            lowerCaseEntryMap.set(lowerCaseKey, index);
        }
    });
    
    return lowerCaseEntryMap;
}

/**
 * 创建默认的词汇表
 * @param targetLanguage 目标语言
 */
export function createDefaultVocabulary(targetLanguage: string = 'zh-CN'): Vocabulary {
    const vocab: Vocabulary = {
        target_language: targetLanguage,
        meta: {
            name: "Code Localizer 核心词汇表",
            version: "0.2.0",
            description: "基本默认词汇表（自动生成，以Entries为核心）"
        },
        entries: [], // 初始化为空，由 initializeEntriesFromSeedDataIfNeeded 填充
    };
    
    initializeEntriesFromSeedDataIfNeeded(vocab); // 填充基础 entries
    
    return vocab;
}

/**
 * 如果词汇表的entries为空，则使用一组最小的核心系统词条对其进行初始化。
 * 这些词条的 source 应为 'system'。
 * @param vocabulary 词汇表对象
 */
export function initializeEntriesFromSeedDataIfNeeded(vocabulary: Vocabulary): void {
    if (!vocabulary) {
        console.error(`[CodeLocalizer] 词汇表为空，无法初始化entries`);
        return;
    }

    // 仅当 entries 不存在或为空时，才从种子数据进行初始化
    if (vocabulary.entries && vocabulary.entries.length > 0) {
        // console.log(`[CodeLocalizer] vocabulary.entries 已存在且不为空（${vocabulary.entries.length}条），跳过从种子数据初始化。`);
        return;
    }

    console.log(`[CodeLocalizer] vocabulary.entries 为空或未定义，开始从最基础的种子数据初始化...`);
    
    const newEntries: VocabularyEntry[] = [];
    const targetLang = vocabulary.target_language || 'zh-CN'; // 默认为中文

    // 定义一小组非常核心的、语言相关的默认系统词条
    // 注意：这里的翻译应根据 targetLang 动态调整，或提供一个更通用的机制
    // 为简化，暂时只硬编码一些英文和中文示例
    const coreSystemTerms: Array<{ original: string; zh: string; en: string; type: VocabularyEntryType }> = [
        { original: "function", zh: "函数", en: "function", type: 'identifier' },
        { original: "var", zh: "变量", en: "var", type: 'identifier' },
        { original: "const", zh: "常量", en: "const", type: 'identifier' },
        { original: "let", zh: "局部变量", en: "let", type: 'identifier' },
        { original: "if", zh: "如果", en: "if", type: 'identifier' },
        { original: "else", zh: "否则", en: "else", type: 'identifier' },
        { original: "for", zh: "循环", en: "for", type: 'identifier' },
        { original: "while", zh: "当...时循环", en: "while", type: 'identifier' },
        { original: "return", zh: "返回", en: "return", type: 'identifier' },
        { original: "class", zh: "类", en: "class", type: 'identifier' },
        { original: "true", zh: "真", en: "true", type: 'identifier' },
        { original: "false", zh: "假", en: "false", type: 'identifier' },
        { original: "null", zh: "空", en: "null", type: 'identifier' },
        { original: "import", zh: "导入", en: "import", type: 'identifier' },
        { original: "export", zh: "导出", en: "export", type: 'identifier' },
        // 可以添加一些非常通用的注释标记符的翻译规则，如果需要
        // { original: "TODO", zh: "待办", en: "TODO", type: 'comment', source: 'system'},
        // { original: "FIXME", zh: "修复", en: "FIXME", type: 'comment', source: 'system'}
    ];

    for (const term of coreSystemTerms) {
        let translatedText = term.en; // 默认为英文
        if (targetLang === 'zh-CN' && term.zh) {
            translatedText = term.zh;
        }
        // 对于其他语言，未来可以扩展这里的逻辑或从更完整的语言包加载

        newEntries.push({
            original: term.original,
            translated: translatedText,
            type: term.type,
            source: 'system' // 明确来源为系统
        });
    }
    
    vocabulary.entries = newEntries;
    
    console.log(`[CodeLocalizer] vocabulary.entries 最基础初始化完成，共 ${vocabulary.entries.length} 条，目标语言: ${targetLang}`);
}

/**
 * 初始化临时词汇表
 * @returns 新的临时词汇表
 */
export function initTempVocabulary(): TempVocabulary {
    return {
        new_identifiers: []
    };
}

/**
 * 加载词汇表
 * @param context VS Code扩展上下文
 * @param targetLanguage 目标语言
 */
export async function loadVocabulary(
    context: vscode.ExtensionContext,
    targetLanguage: string = 'zh-CN'
): Promise<Vocabulary | null> {
    const hasWorkspaceFolders = !!(vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0);
    console.log(`[CodeLocalizer] 开始加载词汇表 - 目标语言: ${targetLanguage}, 工作区状态: ${hasWorkspaceFolders ? '有工作区' : '无工作区'}`);

    let projectVocabulary: Vocabulary | null = null;
    let globalVocabulary: Vocabulary | null = null;
    let extensionVocabulary: Vocabulary | null = null;

    // 1. 尝试从项目级别加载目标语言的词汇表
    if (hasWorkspaceFolders) {
        const projectVocabPath = await getVocabularyPath(context, VocabularyStorageLocation.PROJECT, targetLanguage);
        if (projectVocabPath) {
            console.log(`[CodeLocalizer] 尝试从项目路径加载词汇表: ${projectVocabPath.fsPath}`);
            projectVocabulary = await loadVocabularyFromFile(projectVocabPath);
            if (projectVocabulary) {
                console.log(`[CodeLocalizer] 成功从项目加载 ${targetLanguage} 词汇表。`);
                // 确保加载的词汇表的目标语言正确
                if (projectVocabulary.target_language !== targetLanguage) {
                    console.warn(`[CodeLocalizer] 项目词汇表 (${projectVocabPath.fsPath}) 的目标语言 (${projectVocabulary.target_language}) 与请求语言 (${targetLanguage}) 不符。将更新词汇表目标语言。`);
                    projectVocabulary.target_language = targetLanguage;
                    // 清空entries，因为语言不匹配，原entries可能无效
                    projectVocabulary.entries = []; 
                    initializeEntriesFromSeedDataIfNeeded(projectVocabulary); // 使用新的目标语言初始化种子数据
                }
            }
        }
    }

    // 2. 如果项目词汇表未加载或为空，则创建一个新的、对应目标语言的空词汇表结构作为基础
    if (!projectVocabulary) {
        console.log(`[CodeLocalizer] 未能从项目加载 ${targetLanguage} 词汇表，将创建新的内存词汇表作为基础。`);
        projectVocabulary = createDefaultVocabulary(targetLanguage);
        // 这个新创建的词汇表只在内存中，如果用户进行了操作，后续保存时会写入项目路径
    }

    // 3. 尝试加载全局用户词汇表 (对应目标语言)
    const globalVocabPath = await getVocabularyPath(context, VocabularyStorageLocation.GLOBAL, targetLanguage);
    if (globalVocabPath) {
        console.log(`[CodeLocalizer] 尝试从全局路径加载词汇表: ${globalVocabPath.fsPath}`);
        globalVocabulary = await loadVocabularyFromFile(globalVocabPath);
        if (globalVocabulary) {
            console.log(`[CodeLocalizer] 成功从全局加载 ${targetLanguage} 词汇表。`);
            // 确保语言匹配
            if (globalVocabulary.target_language !== targetLanguage) {
                 console.warn(`[CodeLocalizer] 全局词汇表的目标语言 (${globalVocabulary.target_language}) 与请求语言 (${targetLanguage}) 不符。将忽略此全局词汇表。`);
                 globalVocabulary = null;
            }
        }
    }

    // 4. 尝试加载扩展自带的核心词汇表 (对应目标语言，如果不存在则回退到中文作为种子词库)
    let coreLangToLoad = targetLanguage;
    let extensionVocabPath = await getVocabularyPath(context, VocabularyStorageLocation.EXTENSION, coreLangToLoad);
    if (extensionVocabPath && !(await fileExists(extensionVocabPath))) {
        console.log(`[CodeLocalizer] 未找到 ${coreLangToLoad} 的扩展核心词汇表，尝试回退到 zh-CN。`);
        coreLangToLoad = 'zh-CN'; // 回退到中文
        extensionVocabPath = await getVocabularyPath(context, VocabularyStorageLocation.EXTENSION, coreLangToLoad);
    }

    if (extensionVocabPath) {
        console.log(`[CodeLocalizer] 尝试从扩展路径加载核心词汇表: ${extensionVocabPath.fsPath} (实际加载语言: ${coreLangToLoad})`);
        extensionVocabulary = await loadVocabularyFromFile(extensionVocabPath);
        if (extensionVocabulary) {
            console.log(`[CodeLocalizer] 成功从扩展加载核心词汇表 (语言: ${coreLangToLoad})。`);
             // 如果加载的是回退的中文核心词库，但目标语言不是中文，则只使用其entries作为种子，不改变主词汇表的target_language
            if (coreLangToLoad === 'zh-CN' && targetLanguage !== 'zh-CN') {
                console.log(`[CodeLocalizer] 使用中文核心词汇表的entries作为 ${targetLanguage} 词汇表的种子数据。`);
            } else if (extensionVocabulary.target_language !== coreLangToLoad) {
                // 正常情况下，扩展核心词汇表的语言应该与其文件名一致
                console.warn(`[CodeLocalizer] 扩展核心词汇表 (${extensionVocabPath.fsPath}) 的目标语言 (${extensionVocabulary.target_language}) 与预期 (${coreLangToLoad}) 不符。将尝试调整。`);
                extensionVocabulary.target_language = coreLangToLoad;
            }
        }
    }

    // 5. 合并词汇表：基础是 projectVocabulary (新创建的或从文件加载的)
    let finalVocabulary = projectVocabulary; // projectVocabulary 已经是正确的目标语言

    // 合并全局词汇表 (如果存在且语言匹配)
    if (globalVocabulary) {
        console.log(`[CodeLocalizer] 合并全局 ${targetLanguage} 词汇表到主词汇表。`);
        finalVocabulary = mergeVocabularies(finalVocabulary, globalVocabulary, targetLanguage);
    }

    // 合并扩展核心词汇表的词条 (作为种子或补充)
    if (extensionVocabulary) {
        console.log(`[CodeLocalizer] 合并扩展核心词汇表 (语言: ${coreLangToLoad}) 的词条到主词汇表。`);
        // 特殊处理：如果核心词汇表是中文回退，而目标语言不是中文，
        // 我们需要将中文翻译调整为适合目标语言的占位符或英文原文，
        // 或者在 initializeEntriesFromSeedDataIfNeeded 中处理多语言种子。
        // 当前的 initializeEntriesFromSeedDataIfNeeded 已经会根据词汇表的 target_language 初始化种子，所以直接合并。
        finalVocabulary = mergeVocabularies(finalVocabulary, extensionVocabulary, targetLanguage, true);
    }
    
    // 确保最终词汇表的 entries 在合并后仍然基于新的 targetLanguage 初始化（如果之前为空）
    initializeEntriesFromSeedDataIfNeeded(finalVocabulary);

    console.log(`[CodeLocalizer] 词汇表加载与合并完成。最终目标语言: ${finalVocabulary.target_language}, 总条目数: ${finalVocabulary.entries.length}`);
    
    // 如果经过所有步骤，词汇表仍然是null（理论上不会，因为projectVocabulary会确保有实例），则返回一个全新的默认词汇表
    if (!finalVocabulary) {
        console.error("[CodeLocalizer] 严重错误：finalVocabulary为null，将返回全新的默认词汇表。");
        finalVocabulary = createDefaultVocabulary(targetLanguage);
    }

    // 首次加载或语言切换时，如果项目词汇表是新创建的，进行一次保存
    if (hasWorkspaceFolders && !(await fileExists(await getVocabularyPath(context, VocabularyStorageLocation.PROJECT, targetLanguage) as vscode.Uri))) {
        if (finalVocabulary.entries.length > 0) { // 只保存有内容的
             console.log(`[CodeLocalizer] 检测到项目词汇表 (${targetLanguage}) 是新创建的，将进行首次保存。`);
             await saveVocabulary(context, finalVocabulary, targetLanguage);
        }
    }

    return finalVocabulary;
}

/**
 * 合并两个词汇表 (source合并到target)
 * @param target 主词汇表 (以此为基础)
 * @param source 要合并的源词汇表
 * @param expectedTargetLanguage 期望的目标语言，用于校验和调整
 * @param mergeAsSeed 对于扩展核心词汇表，如果条目已存在于target中，不覆盖，除非original相同但translated为空
 * @returns 合并后的词汇表
 */
function mergeVocabularies(
    target: Vocabulary,
    source: Vocabulary | null,
    expectedTargetLanguage: string,
    mergeAsSeed: boolean = false
): Vocabulary {
    if (!source || !source.entries || source.entries.length === 0) {
        return target;
    }

    // 确保目标词汇表是正确的语言
    if (target.target_language !== expectedTargetLanguage) {
        target.target_language = expectedTargetLanguage;
        // 如果语言不匹配，target的entries可能也需要重新评估或清空并用种子填充
        target.entries = []; 
        initializeEntriesFromSeedDataIfNeeded(target);
    }

    for (const sourceEntry of source.entries) {
        const existingEntryIndex = findVocabularyEntryIndex(target, sourceEntry.original, sourceEntry.type);

        if (existingEntryIndex !== -1) {
            // 条目已存在于目标词汇表中
            if (mergeAsSeed) {
                // 如果是作为种子合并，且目标中该条目的翻译为空，则使用种子的翻译
                if (!target.entries[existingEntryIndex].translated && sourceEntry.translated) {
                    target.entries[existingEntryIndex].translated = sourceEntry.translated;
                    target.entries[existingEntryIndex].source = sourceEntry.source || 'system'; // 更新source
                }
                // 否则，作为种子合并时，不覆盖已有的翻译
            } else {
                // 非种子合并，如果sourceEntry有翻译，则用sourceEntry覆盖（除非sourceEntry的翻译为空）
                if (sourceEntry.translated) { 
                    target.entries[existingEntryIndex].translated = sourceEntry.translated;
                    target.entries[existingEntryIndex].source = sourceEntry.source || target.entries[existingEntryIndex].source; // 保留或更新source
                }
            }
        } else {
            // 条目不存在，直接添加
            target.entries.push({ ...sourceEntry });
        }
    }
    return target;
}

/**
 * 保存词汇表到所有位置
 * @param context VS Code扩展上下文
 * @param vocabulary 词汇表对象
 * @param language 目标语言
 */
export async function saveVocabulary(
    context: vscode.ExtensionContext, 
    vocabulary: Vocabulary, 
    language?: string // language 参数可选，优先使用 vocabulary.target_language
): Promise<void> {
    const targetLanguage = language || vocabulary.target_language;
    if (!targetLanguage) {
        console.error("[CodeLocalizer] 保存词汇表失败：目标语言未知。");
        return;
    }

    const location = (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) 
        ? VocabularyStorageLocation.PROJECT 
        : VocabularyStorageLocation.GLOBAL;

    const filePath = await getVocabularyPath(context, location, targetLanguage);

    if (filePath) {
        const vocabularyToSave: Partial<Vocabulary> = {
            target_language: vocabulary.target_language,
            meta: vocabulary.meta,
            entries: vocabulary.entries
        };
        // 不应包含 system_vocabulary, user_defined_identifiers, user_defined_comments 等废弃字段

        await saveVocabularyToFile(filePath, vocabularyToSave as Vocabulary); // 类型断言
        console.log(`[CodeLocalizer] 词汇表已保存到 ${filePath}`);
    } else {
        console.error(`[CodeLocalizer] 无法获取词汇表保存路径，位置: ${location}, 语言: ${targetLanguage}`);
    }
}

/**
 * 清除词汇表
 * @param context VS Code扩展上下文
 * @param vocabulary 词汇表对象
 */
export async function clearVocabulary(context: vscode.ExtensionContext, vocabulary: Vocabulary): Promise<void> {
    // 清空 entries 数组
    vocabulary.entries = [];
    
    // 可选：如果希望保留系统默认词汇，则在清空后重新从种子数据初始化
    console.log('[CodeLocalizer] 清除词汇表后，重新从种子数据初始化entries以保留系统词汇...');
    initializeEntriesFromSeedDataIfNeeded(vocabulary); 
    
    await saveVocabulary(context, vocabulary, vocabulary.target_language);
    vscode.window.showInformationMessage('Code Localizer: 词汇表已清除 (Entries 已重置为系统默认)。');
}

/**
 * 合并临时词汇表到主词汇表
 * @param context VS Code扩展上下文
 * @param vocabulary 主词汇表
 * @param tempVocabulary 临时词汇表
 */
export async function mergeTranslatedItemsToVocabulary(
    vocabulary: Vocabulary, 
    translatedItems: Record<string, string>, 
    itemType: VocabularyEntryType,
    source: string = 'llm' // 默认来源为llm
): Promise<void> {
    if (!vocabulary || !translatedItems) {
        console.error("[CodeLocalizer] 合并翻译失败：词汇表或翻译项为空。");
        return;
    }

    let mergedCount = 0;
    let newCount = 0;

    for (const originalText in translatedItems) {
        // eslint-disable-next-line no-prototype-builtins
        if (translatedItems.hasOwnProperty(originalText)) {
            const translatedTextValue = translatedItems[originalText];
            if (!translatedTextValue || translatedTextValue.trim() === '') { // 跳过空翻译
                console.warn(`[CodeLocalizer] 跳过原文 "${originalText}" 的空翻译。`);
                continue;
            }

            // 使用改进后的辅助函数查找匹配的条目 - 支持大小写不敏感、简化内容和词根匹配
            const matchedIndex = findVocabularyEntryIndex(vocabulary, originalText, itemType, true);

            if (matchedIndex !== -1) {
                // 条目已存在，更新翻译和来源
                const existingEntry = vocabulary.entries[matchedIndex];
                
                // 记录匹配的类型，如果不是完全匹配
                if (existingEntry.original !== originalText) {
                    console.log(`[CodeLocalizer] 合并翻译时发现不同形式的相同单词: "${originalText}" 匹配到 "${existingEntry.original}"`);
                }
                
                if (existingEntry.translated !== translatedTextValue) {
                    existingEntry.translated = translatedTextValue;
                    existingEntry.source = source; // 更新来源
                    mergedCount++;
                }
            } else {
                // 条目不存在，添加新条目
                vocabulary.entries.push({
                    original: originalText,
                    translated: translatedTextValue,
                    type: itemType,
                    source: source
                });
                newCount++;
            }
        }
    }
    if (mergedCount > 0 || newCount > 0) {
        console.log(`[CodeLocalizer] 翻译合并完成：更新 ${mergedCount} 条，新增 ${newCount} 条。总 entries: ${vocabulary.entries.length}`);
    }
}

/**
 * 旧的 mergeTranslationsToVocabulary 函数，其依赖 TempVocabulary 结构。
 * 此函数将被上面的 mergeTranslatedItemsToVocabulary 替代。
 * @deprecated 请使用 mergeTranslatedItemsToVocabulary。此函数现在仅记录警告，不执行任何实际的合并操作。
 */
export async function mergeTranslationsToVocabulary(
    context: vscode.ExtensionContext, 
    vocabulary: Vocabulary, 
    tempVocabulary: TempVocabulary
): Promise<void> {
    console.warn("[CodeLocalizer] 调用了已废弃的 mergeTranslationsToVocabulary。该函数已不再执行实际的合并操作。请更新调用代码以使用 mergeTranslatedItemsToVocabulary 函数处理 Record<string, string> 格式的翻译结果。");
    // 函数体已清空，因为其依赖的 TempVocabulary 字段已被移除。
}

/**
 * 从词汇表中获取翻译 (核心查询逻辑)
 * @param vocabulary 词汇表对象
 * @param originalText 待翻译的原文
 * @param itemType 可选，词条类型，用于更精确匹配
 * @returns 翻译后的文本，如果未找到则返回 undefined
 */
export function getTranslation(
    vocabulary: Vocabulary, 
    originalText: string, 
    itemType?: VocabularyEntryType
): string | undefined {
    if (!vocabulary || !vocabulary.entries) {
        return undefined;
    }

    // 使用改进后的辅助函数查找条目 - 它会尝试多种匹配策略，包括大小写不敏感、简化内容和词根匹配
    const matchedIndex = findVocabularyEntryIndex(vocabulary, originalText, itemType, true);
    
    if (matchedIndex !== -1) {
        // 找到匹配的翻译
        const translation = vocabulary.entries[matchedIndex].translated;
        
        // 非完全匹配的情况，记录一下用于调试
        if (vocabulary.entries[matchedIndex].original !== originalText) {
            console.log(`[CodeLocalizer] 获取翻译: 使用"${vocabulary.entries[matchedIndex].original}"的翻译"${translation}"用于"${originalText}"`);
        }
        
        return translation;
    }
    
    return undefined;
}

/**
 * 向词汇表添加或更新单个翻译条目
 * @param vocabulary 词汇表对象
 * @param entry 要添加或更新的词汇条目
 */
export function addOrUpdateTranslation(
    vocabulary: Vocabulary,
    entry: VocabularyEntry
): void {
    if (!vocabulary || !entry || !entry.original) {
        console.error("[CodeLocalizer] 添加或更新翻译失败：参数无效。");
        return;
    }
    if (!entry.source) { // 确保有source
        entry.source = 'user'; // 默认为用户添加
    }
    if (!entry.type) { // 确保有type
        // 尝试根据内容猜测，或默认为 identifier
        entry.type = entry.original.startsWith('//') || entry.original.startsWith('/*') ? 'comment' : 'identifier';
    }

    // 使用改进后的辅助函数查找条目
    const existingEntryIndex = findVocabularyEntryIndex(vocabulary, entry.original, entry.type, true);

    if (existingEntryIndex !== -1) {
        // 更新现有条目
        const existingEntry = vocabulary.entries[existingEntryIndex];
        
        // 检查是否匹配不同形式的相同单词
        if (existingEntry.original !== entry.original) {
            console.log(`[CodeLocalizer] 检测到不同形式的相同单词: "${entry.original}" 匹配到 "${existingEntry.original}"`);
            
            // 可选：保留更规范的形式（如果需要）
            // 这里可以添加保留哪种形式的逻辑，例如首字母大写的版本或最短版本
        }
        
        // 更新翻译和来源
        existingEntry.translated = entry.translated;
        existingEntry.source = entry.source;
        console.log(`[CodeLocalizer] 更新词条: "${existingEntry.original}" -> "${entry.translated}" (source: ${entry.source})`);
    } else {
        // 添加新条目
        vocabulary.entries.push(entry);
        console.log(`[CodeLocalizer] 添加新词条: "${entry.original}" -> "${entry.translated}" (source: ${entry.source})`);
    }
} 