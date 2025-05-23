// 提取器模块，负责从代码文件中提取标识符
import * as vscode from 'vscode';
import { Vocabulary, ExtractionResult, IdentifierType } from '../types';
import { 
    BlacklistData,
    loadBlacklist,
    getTermsSet,
    getIgnoreSet,
    getMeaningfulShortWordsSet,
    getPythonKeywordsSet,
    isHexColor
} from '../config/blacklist-manager';
import { getUserBlacklist } from '../config/config-manager';

/**
 * 从文档中收集并准备可翻译项
 * @param document 文本文档
 * @param vocabulary 词汇表
 * @param context VS Code扩展上下文
 */
export async function collectAndPrepareTranslatableItems(
    document: vscode.TextDocument, 
    vocabulary: Vocabulary | null,
    context?: vscode.ExtensionContext
): Promise<ExtractionResult> {
    if (!vocabulary) {
        console.warn("[CodeLocalizer] 词汇表未加载。无法收集项目。");
        vscode.window.showWarningMessage("Code Localizer: 词汇表不可用，无法处理文件。");
        return { newIdentifiers: [] };
    }

    // 如果提供了上下文，从JSON文件加载黑名单
    let blacklist: BlacklistData | null = null;
    if (context) {
        blacklist = await loadBlacklist(context);
    }
    
    const text = document.getText();
    console.log(`[CodeLocalizer] 开始分析文件: ${document.uri.fsPath}, 语言类型: ${document.languageId}, 文件大小: ${text.length}字节`);
    
    // 1. 提取标识符 - 注意extractIdentifiers内部已经有基本的去重(使用Map)
    const { identifiers, statistics, pythonKeywords, meaningfulShortWords } = await extractIdentifiers(text, blacklist);
    console.log(`[CodeLocalizer] 原始标识符匹配: 找到${statistics.totalCount}个匹配，处理后${identifiers.size}个唯一标识符`);
    
    // 2. 过滤和优先级排序
    const prioritizedIdentifiers = await prioritizeIdentifiers(identifiers, pythonKeywords, meaningfulShortWords, blacklist);
    
    // 3. 内部查重 - 使用Set确保数组元素唯一
    const uniqueIdentifiers = Array.from(new Set(prioritizedIdentifiers));
    
    // 记录内部查重结果
    if (uniqueIdentifiers.length < prioritizedIdentifiers.length) {
        console.log(`[CodeLocalizer] 内部查重: 从${prioritizedIdentifiers.length}个标识符中去除了${prioritizedIdentifiers.length - uniqueIdentifiers.length}个重复项`);
    }
    
    // 4. 与词汇表进行查重
    const { newIdentifiers, existingIds } = filterExistingIdentifiers(uniqueIdentifiers, vocabulary);
    
    // 5. 日志记录
    console.log(`[CodeLocalizer] 查重结果: 提取了${uniqueIdentifiers.length}个唯一标识符，其中${existingIds.size}个已存在于词汇表中，新增${newIdentifiers.length}个`);
    
    if (newIdentifiers.length === 0) {
        console.log(`[CodeLocalizer] 未发现新的可翻译项：所有标识符都已在词汇表中`);
    } else {
        if (newIdentifiers.length > 0) {
            console.log("[CodeLocalizer] 部分新标识符示例:", newIdentifiers.slice(0, 5));
        }
    }

    return { newIdentifiers };
}

/**
 * 从文本中提取标识符
 * @param text 源代码文本
 * @param blacklist 黑名单数据
 */
async function extractIdentifiers(text: string, blacklist: BlacklistData | null): Promise<{ 
    identifiers: Map<string, IdentifierType>, 
    statistics: { totalCount: number },
    pythonKeywords: Set<string>,
    meaningfulShortWords: Set<string>
}> {
    const identifiersMap = new Map<string, IdentifierType>();
    const identifierRegex = /[a-zA-Z_][a-zA-Z0-9_]*/g;
    let match;
    let totalCount = 0;
    
    // 从黑名单中获取过滤集合
    const technicalTermsBlacklist = blacklist ? getTermsSet(blacklist) : new Set<string>();
    const ignoreList = blacklist ? getIgnoreSet(blacklist) : new Set<string>();
    const meaningfulShortWords = blacklist ? getMeaningfulShortWordsSet(blacklist) : new Set<string>();
    const pythonKeywords = blacklist ? getPythonKeywordsSet(blacklist) : new Set<string>();
    
    // 添加URL检测，排除URL格式的标识符
    const urlRegex = /(https?:\/\/[^\s"']+)|([a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z0-9][-a-zA-Z0-9]*\.(com|org|net|edu|gov|io|dev)(\.[a-zA-Z]{2})?)/g;
    let urlMatches: string[] = [];
    let urlMatch;
    
    // 先识别所有URL，将它们存储在数组中
    while ((urlMatch = urlRegex.exec(text)) !== null) {
        urlMatches.push(urlMatch[0]);
    }
    
    // 首先提取所有原始标识符
    while ((match = identifierRegex.exec(text)) !== null) {
        const identifier = match[0];
        
        // 忽略单字母标识符、纯数字标识符或在忽略列表中的标识符
        if (
            identifier.length <= 1 || 
            /^\d+$/.test(identifier) || 
            ignoreList.has(identifier.toLowerCase())
        ) {
            continue;
        }
        
        // 跳过技术术语黑名单中的词（不区分大小写）
        if (technicalTermsBlacklist.has(identifier.toLowerCase())) {
            continue;
        }
        
        // 检查该标识符是否是URL的一部分，如果是则跳过
        let isPartOfUrl = false;
        for (const url of urlMatches) {
            if (url.includes(identifier)) {
                isPartOfUrl = true;
                break;
            }
        }
        
        if (isPartOfUrl) {
            continue; // 跳过URL的一部分
        }
        
        // 检测并跳过十六进制颜色代码
        if (isHexColor(identifier)) {
            continue;
        }

        // 特殊处理Python关键词
        if (pythonKeywords.has(identifier)) {
            // 将Python关键词标记为'original'，确保被提取
            identifiersMap.set(identifier, 'original');
            totalCount++;
            continue; // 不需要进一步拆分Python关键词
        }
        
        // 将原始标识符标记为'original'
        identifiersMap.set(identifier, 'original');
        totalCount++;
        
        // 处理下划线分隔的标识符
        if (identifier.includes('_')) {
            processUnderscoreIdentifier(identifier, identifiersMap, ignoreList, meaningfulShortWords);
        }
        
        // 处理驼峰命名法标识符
        if (/[a-z][A-Z]/.test(identifier) || /[A-Z]{2,}[a-z]/.test(identifier)) {
            processCamelCaseIdentifier(identifier, identifiersMap, ignoreList);
        }
    }
    
    return { identifiers: identifiersMap, statistics: { totalCount }, pythonKeywords, meaningfulShortWords };
}

/**
 * 处理下划线分隔的标识符
 * @param identifier 下划线分隔的标识符
 * @param identifiersMap 标识符映射
 * @param ignoreList 忽略列表
 * @param meaningfulShortWords 有意义的短词列表
 */
function processUnderscoreIdentifier(
    identifier: string, 
    identifiersMap: Map<string, IdentifierType>,
    ignoreList: Set<string>,
    meaningfulShortWords: Set<string>
): void {
    // 处理Python特殊方法格式 (__name__)
    if (/^__[a-zA-Z0-9]+__$/.test(identifier)) {
        // 提取中间部分 (不包括前后的双下划线)
        const coreName = identifier.slice(2, -2);
        if (coreName.length > 1 && !identifiersMap.has(coreName) && isLikelyMeaningfulIdentifier(coreName)) {
            identifiersMap.set(coreName, 'split');
        }
        // 确保原始方法名也被添加（用于检测Python特殊方法）
        if (identifier === '__init__' || identifier === '__str__' || identifier === '__repr__') {
            // 添加到标识符映射中，但标记为需要翻译
            identifiersMap.set(identifier, 'original');
        }
        return; // 已处理特殊格式，直接返回
    }
    
    // 特殊处理C++标识符
    processCppIdentifier(identifier, identifiersMap);
    
    // 对于其他带下划线的标识符
    // 使用正则替换连续的下划线为单个下划线，避免空字符串
    const normalizedId = identifier.replace(/_{2,}/g, '_');
    // 按下划线拆分
    const parts = normalizedId.split('_').filter(p => p.length > 0);
    
    // 添加有意义的部分
    for (const part of parts) {
        if (
            // 过滤逻辑
            (part.length >= 3 || meaningfulShortWords.has(part.toLowerCase())) && 
            !ignoreList.has(part.toLowerCase()) &&
            isLikelyMeaningfulIdentifier(part)
        ) {
            // 避免重复
            if (!identifiersMap.has(part)) {
                identifiersMap.set(part, 'split');
            }
        }
    }
}

/**
 * 特殊处理C++标识符
 * @param identifier 标识符
 * @param identifiersMap 标识符映射
 */
function processCppIdentifier(identifier: string, identifiersMap: Map<string, IdentifierType>): boolean {
    // 常见C++类型声明模式如size_t, uint32_t
    if (/^[a-z]+_t$/.test(identifier)) {
        // 添加不带_t的部分
        const basePart = identifier.substring(0, identifier.length - 2);
        if (basePart.length >= 3 && !identifiersMap.has(basePart)) {
            identifiersMap.set(basePart, 'split');
        }
        return true;
    }
    
    // 处理Get/Set方法模式如GetCount, SetValue
    if (/^(Get|Set)[A-Z][a-zA-Z0-9]*$/.test(identifier)) {
        // 提取前缀和主体部分
        const prefix = identifier.substring(0, 3).toLowerCase(); // get或set
        const body = identifier.substring(3);
        
        // 添加前缀
        if (!identifiersMap.has(prefix)) {
            identifiersMap.set(prefix, 'split');
        }
        
        // 处理驼峰式的主体部分
        processCamelCaseIdentifier(body, identifiersMap, new Set());
        return true;
    }
    
    // 处理m_前缀的成员变量
    if (/^m_[A-Z][a-zA-Z0-9]*$/.test(identifier)) {
        const body = identifier.substring(2);
        processCamelCaseIdentifier(body, identifiersMap, new Set());
        return true;
    }
    
    return false; // 不是特殊的C++标识符
}

/**
 * 处理驼峰式标识符
 * @param identifier 驼峰式标识符
 * @param identifiersMap 标识符映射
 * @param ignoreList 忽略列表
 */
function processCamelCaseIdentifier(
    identifier: string,
    identifiersMap: Map<string, IdentifierType>,
    ignoreList: Set<string>
): void {
    // 特殊处理常见的混合大小写模式(如itemInfo, userList等)
    if (/^[a-z]+[A-Z][a-z]+$/.test(identifier)) {
        // 尝试识别前缀部分(如item, user)
        const prefix = identifier.match(/^[a-z]+/)?.[0] || '';
        if (prefix.length >= 3 && !ignoreList.has(prefix.toLowerCase()) && isLikelyMeaningfulIdentifier(prefix)) {
            if (!identifiersMap.has(prefix)) {
                identifiersMap.set(prefix, 'split');
            }
        }
        
        // 尝试识别后缀部分(如Info, List)
        const suffix = identifier.match(/[A-Z][a-z]+$/)?.[0] || '';
        if (suffix.length >= 3 && !ignoreList.has(suffix.toLowerCase()) && isLikelyMeaningfulIdentifier(suffix)) {
            if (!identifiersMap.has(suffix)) {
                identifiersMap.set(suffix, 'split');
            }
        }
    }
    
    // 拆分驼峰标识符
    const parts = splitCamelCase(identifier);
    
    // 添加有意义的部分
    for (const part of parts) {
        if (
            part.length >= 3 && 
            !ignoreList.has(part.toLowerCase()) &&
            isLikelyMeaningfulIdentifier(part)
        ) {
            // 避免重复
            if (!identifiersMap.has(part)) {
                identifiersMap.set(part, 'split');
            }
        }
    }
}

/**
 * 拆分驼峰命名的标识符
 * @param identifier 驼峰命名标识符
 * @returns 拆分后的部分列表
 */
function splitCamelCase(identifier: string): string[] {
    // 处理特殊的驼峰模式
    let preprocessed = identifier;
    
    // 1. 处理连续的大写字母模式
    preprocessed = preprocessed.replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2');
    
    // 2. 处理小写后跟大写的模式
    preprocessed = preprocessed.replace(/([a-z])([A-Z])/g, '$1_$2');
    
    // 3. 处理数字与字母的边界（优化数字处理）
    preprocessed = preprocessed.replace(/([a-zA-Z])(\d+)([a-zA-Z])?/g, '$1_$2_$3'); // 改进：字母-数字-字母的模式，如item2Info
    preprocessed = preprocessed.replace(/([a-zA-Z])(\d+)/g, '$1_$2'); // 字母后跟数字
    preprocessed = preprocessed.replace(/(\d+)([a-zA-Z])/g, '$1_$2'); // 数字后跟字母
    
    // 4. 移除由上述替换引入的空部分
    preprocessed = preprocessed.replace(/_+/g, '_').replace(/^_|_$/g, '');
    
    // 5. 拆分
    const parts = preprocessed.split('_').filter(part => part.length > 0);
    
    // 处理大写缩写 (如 JSON, HTTP)
    const result: string[] = [];
    for (const part of parts) {
        // 处理纯数字部分，跳过单独的数字
        if (/^\d+$/.test(part)) {
            // 只添加可能有意义的数字，如年份
            if (part.length >= 4) {
                result.push(part);
            }
            continue;
        }
        
        if (/^[A-Z]{2,}$/.test(part)) {
            // 全大写部分，作为一个整体
            result.push(part);
        } else if (/^[A-Z]{2,}[a-z]+$/.test(part)) {
            // 处理如 "JSONObject" -> ["JSON", "Object"]
            const acronym = part.match(/^[A-Z]+/)?.[0] || '';
            const remainder = part.slice(acronym.length);
            if (acronym.length >= 2) {
                result.push(acronym);
                if (remainder.length > 0) {
                    result.push(remainder.charAt(0).toUpperCase() + remainder.slice(1));
                }
            } else {
                result.push(part);
            }
        } else {
            result.push(part);
        }
    }
    
    return result;
}

/**
 * 简单的词干提取函数，移除常见的后缀
 * @param word 需要提取词干的单词
 * @returns 提取的词干
 */
export function getStem(word: string): string {
    // 转换为小写
    let stem = word.toLowerCase();
    
    // 常见的英语后缀
    const suffixes = [
        'ing', 'ed', 'es', 's', 'er', 'ers', 'or', 'ors', 'ion', 'ions', 
        'tion', 'tions', 'ment', 'ments', 'ness', 'ity', 'ty', 'ies', 'able', 
        'ible', 'al', 'ial', 'ical', 'ful', 'ous', 'ious', 'ive', 'ative', 'itive'
    ];
    
    // 移除匹配的后缀
    for (const suffix of suffixes) {
        if (stem.endsWith(suffix) && stem.length > suffix.length + 2) {
            // 只有当移除后缀后单词长度仍然足够长时才移除
            stem = stem.substring(0, stem.length - suffix.length);
            // 只移除一个后缀，避免过度提取
            break;
        }
    }
    
    // 处理一些特殊情况的复数形式
    if (stem.endsWith('ie')) {
        stem = stem.substring(0, stem.length - 2) + 'y';
    }
    
    // 如果以y结尾的单词，其前一个字符是辅音，则保留y
    if (stem.endsWith('y') && stem.length > 2) {
        const beforeY = stem.charAt(stem.length - 2);
        if (!['a', 'e', 'i', 'o', 'u'].includes(beforeY)) {
            stem = stem.substring(0, stem.length - 1) + 'i';
        }
    }
    
    return stem;
}

/**
 * 检查两个单词是否可能是相同词根的变体
 * @param word1 第一个单词
 * @param word2 第二个单词
 * @returns 是否可能是相同词根
 */
export function isSameWordRoot(word1: string, word2: string): boolean {
    // 如果完全相同（不考虑大小写），则为相同词根
    if (word1.toLowerCase() === word2.toLowerCase()) {
        return true;
    }
    
    // 提取词干并比较
    const stem1 = getStem(word1);
    const stem2 = getStem(word2);
    
    return stem1 === stem2;
}

/**
 * 从标识符映射中优先选择哪些标识符
 * @param identifiersMap 标识符映射
 * @param pythonKeywords Python关键词集合
 * @param meaningfulShortWords 有意义的短词列表
 * @param blacklist 黑名单数据
 */
async function prioritizeIdentifiers(
    identifiersMap: Map<string, IdentifierType>,
    pythonKeywords: Set<string>,
    meaningfulShortWords: Set<string>,
    blacklist: BlacklistData | null
): Promise<string[]> {
    const finalIdentifiers = new Set<string>();   // 用于存储最终选择的标识符，保留其原始大小写
    
    // 获取黑名单集合
    const technicalTermsBlacklist = blacklist ? getTermsSet(blacklist) : new Set<string>();
    
    // 优先添加Python关键词和特殊方法
    for (const [id, type] of identifiersMap.entries()) {
        // 添加Python关键词
        if (pythonKeywords.has(id)) {
            finalIdentifiers.add(id);
        }
        
        // 提取Python特殊方法的核心部分（去掉双下划线）
        if (/^__[a-zA-Z0-9]+__$/.test(id)) {
            const coreName = id.slice(2, -2);
            if (coreName.length > 1 && isLikelyMeaningfulIdentifier(coreName)) {
                finalIdentifiers.add(coreName);
                // 某些特定的特殊方法，添加原始形式（带双下划线）
                if (id === '__init__' || id === '__str__' || id === '__repr__') {
                    finalIdentifiers.add(id);
                }
            }
        }
    }
    
    // 用于辅助添加标识符的函数
    const tryAddIdentifier = (id: string): boolean => {
        // 跳过技术术语黑名单中的词（不区分大小写）
        if (technicalTermsBlacklist.has(id.toLowerCase())) {
            return false;
        }
        
        // 跳过无效标识符，如单个字母加数字的组合(v2, x1)
        if (/^[a-zA-Z][0-9]+$/.test(id)) {
            return false;
        }
        
        // 如果标识符长度>=3才考虑添加，除非是有意义的短词列表中的词
        if (id.length >= 3 || meaningfulShortWords.has(id.toLowerCase())) {
            finalIdentifiers.add(id);
            return true;
        }
        return false;
    };

    // 第一阶段：仅处理拆分出的基本单词，这是核心部分
    for (const [id, type] of identifiersMap.entries()) {
        if (type === 'split') {
            tryAddIdentifier(id); 
        }
    }
    
    // 第二阶段：处理原始标识符，包括那些无法完全拆分的(如包含数字的标识符)
    for (const [id, type] of identifiersMap.entries()) {
        if (type === 'original') {
            // 处理Python dunder方法特例
            if (/^__[a-zA-Z0-9]+__$/.test(id)) {
                // 核心部分应该已在上面的循环中作为'split'类型处理过
                continue;
            }
            
            // 处理包含数字的复合标识符 (如user1, table3Column4, item2Info)
            if (/\d/.test(id)) {
                // 首先检查是否为无意义的版本标记，如v1, v2等
                if (/^[a-zA-Z][0-9]+$/.test(id)) {
                    continue; // 跳过类似v1, v2这样的标识符
                }
                
                // 改进：处理复杂的数字混合标识符
                const parts = splitCamelCase(id);
                let hasAddedAny = false;
                
                for (const part of parts) {
                    // 跳过纯数字部分
                    if (/^\d+$/.test(part)) {
                        continue;
                    }
                    
                    if (tryAddIdentifier(part)) {
                        hasAddedAny = true;
                    }
                }
                
                // 如果没有添加任何部分，或者整体有意义，则添加整体
                if (!hasAddedAny && isLikelyMeaningfulIdentifier(id) && id.length >= 3) {
                    tryAddIdentifier(id);
                }
                continue;
            }
            
            // 尝试拆分标识符
            const parts = id.includes('_') 
                ? id.split('_').filter(p => p.length > 0) 
                : splitCamelCase(id);
            
            // 只有当标识符无法拆分成有效部分时，才添加原始标识符
            // 例如像"user32"这种无法有效拆分的情况
            if (parts.length <= 1 || parts.every(part => part.length < 3 || !isLikelyMeaningfulIdentifier(part))) {
                tryAddIdentifier(id);
            }
        }
    }

    return Array.from(finalIdentifiers); // 将 Set 转换为数组返回
}

/**
 * 判断标识符是否可能是有意义的词汇
 * @param identifier 标识符
 */
function isLikelyMeaningfulIdentifier(identifier: string): boolean {
    // 忽略常见的无意义标识符格式
    const nonMeaningfulPatterns = [
        /^[aeiou]+$/i,           // 纯元音
        /^[bcdfghjklmnpqrstvwxyz]+$/i, // 纯辅音
        /^[a-z][0-9]+$/i,        // 一个字母后跟数字
        /^tmp[0-9]*$/i,          // tmp开头
        /^temp[0-9]*$/i,         // temp开头
        /^var[0-9]*$/i,          // var开头
        /^[a-z]tmp$/i,           // 以tmp结尾
        /^test[0-9]*$/i,         // test开头
        /^[a-z]{1,2}[0-9]{1,3}$/i, // 1-2个字母后跟1-3个数字
        /^[_\-0-9]*$/            // 只有下划线、连字符和数字
    ];
    
    // 检查是否匹配任何无意义的模式
    for (const pattern of nonMeaningfulPatterns) {
        if (pattern.test(identifier)) {
            return false;
        }
    }
    
    // 默认认为是有意义的
    return true;
}

/**
 * 检查字符串是否包含技术内容，如URL、文件路径、IP地址等
 * @param text 要检查的文本
 */
function isTechnicalString(text: string): boolean {
    // URL检测
    if (/(https?:\/\/[^\s"']+)|([a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z0-9][-a-zA-Z0-9]*\.(com|org|net|edu|gov|io|dev)(\.[a-zA-Z]{2})?)/i.test(text)) {
        return true;
    }
    
    // IP地址检测
    if (/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(text)) {
        return true;
    }
    
    // 文件路径检测
    if (/(?:\/[\w\-.]+)+\/?|\b[a-zA-Z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]*/.test(text)) {
        return true;
    }
    
    // 版本号检测
    if (/\bv?\d+\.\d+(\.\d+)?(-[a-zA-Z0-9]+)?\b/.test(text)) {
        return true;
    }
    
    // HTML/XML标签检测
    if (/<\/?[a-z][\s\S]*?>|<\![a-z][\s\S]*?>/i.test(text)) {
        return true;
    }
    
    // 数据库连接字符串检测
    if (/\b(jdbc|mongodb|mysql|postgres|redis):\/\/[^\s]+/.test(text)) {
        return true;
    }
    
    // 返回false表示不是技术字符串
    return false;
}

/**
 * 过滤已在词汇表中的标识符，增强查重功能
 * @param identifiers 标识符列表
 * @param vocabulary 词汇表
 */
function filterExistingIdentifiers(identifiers: string[], vocabulary: Vocabulary): { 
    existingIds: Set<string>, 
    newIdentifiers: string[] 
} {
    const existingIds = new Set<string>();
    const newIdentifiers: string[] = [];

    if (!vocabulary || !vocabulary.entries) {
        console.warn("[CodeLocalizer] 词汇表或entries未初始化，无法过滤现有标识符。");
        return { existingIds, newIdentifiers: identifiers }; // 返回所有标识符为新
    }

    // 创建一个快速查找集合，用于已存在于词汇表中的标识符原文 (类型为'identifier')
    // 创建两个查找集合 - 一个保留原始大小写，一个全部小写用于不区分大小写的比较
    const existingVocabIdentifiers = new Set<string>(
        vocabulary.entries
            .filter(entry => entry.type === 'identifier')
            .map(entry => entry.original)
    );
    
    // 创建小写版本的查找集合
    const existingVocabIdentifiersLower = new Set<string>(
        vocabulary.entries
            .filter(entry => entry.type === 'identifier')
            .map(entry => entry.original.toLowerCase())
    );

    // 创建词根映射，用于进一步的比较
    const stemMap = new Map<string, string[]>();
    vocabulary.entries
        .filter(entry => entry.type === 'identifier')
        .forEach(entry => {
            const stem = getStem(entry.original);
            if (!stemMap.has(stem)) {
                stemMap.set(stem, []);
            }
            stemMap.get(stem)?.push(entry.original);
        });

    // 优化查重算法 - 首先按简单规则分组
    const groupedIds = new Map<string, string[]>();
    
    // 1. 将所有标识符按纯字母内容（忽略大小写）分组
    for (const id of identifiers) {
        // 简化id - 去除所有非字母字符，转换为小写
        const simplifiedId = id.replace(/[^a-zA-Z]/g, '').toLowerCase();
        
        if (!groupedIds.has(simplifiedId)) {
            groupedIds.set(simplifiedId, []);
        }
        groupedIds.get(simplifiedId)?.push(id);
    }

    // 2. 处理每个分组中的标识符
    for (const [simplifiedId, groupIds] of groupedIds.entries()) {
        // 检查此组是否已有词汇表匹配
        let isGroupMatched = false;
        
        // 检查此简化ID是否与词汇表中的任何标识符的简化版本匹配
        for (const vocabId of existingVocabIdentifiers) {
            const vocabSimplifiedId = vocabId.replace(/[^a-zA-Z]/g, '').toLowerCase();
            if (vocabSimplifiedId === simplifiedId) {
                // 这一组的所有ID都应该标记为已存在
                groupIds.forEach(id => existingIds.add(id));
                isGroupMatched = true;
                console.log(`[CodeLocalizer] 简化内容匹配: 组 "${simplifiedId}" 匹配到词汇表中的 "${vocabId}"`);
                break;
            }
        }
        
        // 如果这组没有匹配，尝试词根匹配
        if (!isGroupMatched) {
            // 获取组的第一个ID的词根
            const stem = getStem(groupIds[0]);
            
            if (stemMap.has(stem)) {
                // 如果有相同词根的词条，则认为这一组都匹配
                groupIds.forEach(id => existingIds.add(id));
                isGroupMatched = true;
                console.log(`[CodeLocalizer] 词根匹配: 组 "${simplifiedId}" (词根: "${stem}") 匹配到词汇表中的词`);
            }
        }
        
        // 如果仍未匹配，检查标准方式
        if (!isGroupMatched) {
            for (const id of groupIds) {
                // 首先尝试精确匹配（保留大小写）
                if (existingVocabIdentifiers.has(id)) {
                    existingIds.add(id);
                } 
                // 然后尝试不区分大小写的匹配
                else if (existingVocabIdentifiersLower.has(id.toLowerCase())) {
                    existingIds.add(id);
                    console.log(`[CodeLocalizer] 忽略大小写匹配成功: 输入 "${id}" 匹配到词汇表中的同一单词(不同大小写)`);
                } 
                else {
                    newIdentifiers.push(id);
                }
            }
        }
    }

    // 新的简化日志
    console.log(`[CodeLocalizer] 标识符过滤: 总输入 ${identifiers.length}个, 已存在于词汇表 ('identifier' type): ${existingIds.size}个, 新增: ${newIdentifiers.length}个`);

    return { existingIds, newIdentifiers };
}

/**
 * 判断标识符是否是技术术语
 * @param identifier 标识符
 * @param blacklist 技术术语黑名单
 */
function isTechnicalTerm(identifier: string, blacklist: Set<string>): boolean {
    // 1. 检查黑名单
    if (blacklist.has(identifier.toLowerCase())) {
        return true;
    }
    
    // 2. 检查技术术语模式
    const techPatterns = [
        /^[A-Z]{2,}$/,                      // 全大写字母，如 JSON, HTTP, API
        /^[A-Z][a-z]*[0-9]+$/,              // 大写开头后跟数字，如 UTF8, IPv4, ES6
        /^v?[0-9]+(\.[0-9]+)+(-[a-z]+)?$/,  // 版本号，如 v1.0, 2.0.1
        /^[a-z]+[A-Z]+[a-z]*$/,             // 驼峰式技术名称，如 typeScript, jQuery
        /^[a-z]+[-_][a-zA-Z0-9]+$/,         // 带连字符或下划线的技术名称，如 react-dom, vue_router
        /^[a-z]+\.[a-z]+$/,                 // 点分隔的技术名称，如 axios.http, react.js
        /^[vV][0-9]+$/,                     // 版本标志，如 v1, V2
        /^[vV][0-9]+\.[0-9]+$/,             // 详细版本标志，如 v1.2, V2.0
        /^.*[_-][vV][0-9]+$/                // 名称后跟版本标志，如 api_v1, element-v2
    ];
    
    for (const pattern of techPatterns) {
        if (pattern.test(identifier)) {
            return true;
        }
    }
    
    // 3. 特定前缀/后缀检查
    const techPrefixes = ['i', 'e', 'on', 'is', 'has', 'use', 'get', 'set', 'create', 'fetch', 'update'];
    const techSuffixes = ['js', 'ts', 'db', 'api', 'sdk', 'dto', 'dao', 'ui', 'vm', 'rc'];
    
    // 检查长度为2-3的全小写词是否可能是技术缩写
    if (identifier.length <= 3 && /^[a-z]{2,3}$/.test(identifier) && !['of', 'to', 'is', 'as', 'in', 'on', 'at', 'by'].includes(identifier)) {
        return true; // 可能是技术缩写
    }
    
    // 检查后缀
    for (const suffix of techSuffixes) {
        if (identifier.toLowerCase().endsWith(suffix) && 
            identifier.length > suffix.length &&
            identifier.length <= suffix.length + 4) { // 避免匹配普通单词
            return true;
        }
    }
    
    return false;
} 