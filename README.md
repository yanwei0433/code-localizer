# 母语化编程 VSCode 扩展

## 项目概述

"母语化编程"是一个创新的 VSCode 扩展，旨在将代码中的英文标识符和注释实时翻译成用户的母语（如中文），让开发者能够在编写和阅读代码时更容易理解代码含义，降低语言障碍。该扩展不改变原始代码，而是通过 VSCode 的装饰器 API 在界面上实现"翻译覆盖"效果。

## 核心功能

1. **代码标识符提取和翻译**：自动从代码文件中提取标识符和注释，通过大语言模型(LLM)翻译
2. **实时代码装饰**：使用 VSCode 装饰器将翻译后的文本直观地显示在编辑器中，不修改源代码
3. **用户词汇表管理**：建立和维护标识符与其翻译的映射关系，支持多语言
4. **智能标识符分解**：能够智能地处理驼峰命名法、下划线命名法等复合标识符
5. **黑名单过滤**：通过配置黑名单过滤不需要翻译的技术术语
6. **用户贡献系统**：允许用户提交对词汇表的贡献，改进翻译质量

## 项目结构

```
母语化编程/
├── src/                   # 源代码目录
│   ├── commands/          # 命令处理模块
│   ├── config/            # 配置管理模块
│   ├── contribution/      # 用户贡献管理
│   ├── extraction/        # 标识符提取模块
│   ├── translation/       # 翻译服务模块
│   ├── types/             # 类型定义
│   ├── ui/                # UI相关模块
│   ├── vocabulary/        # 词汇表管理
│   └── extension.ts       # 扩展入口文件
├── loc_core_vocabulary_*.json  # 多语言核心词汇表文件
└── blacklist.json         # 黑名单配置文件
```

## 核心模块详解

### 1. 提取模块 (`extraction/extractor.ts`)

提取模块是扩展的核心部分，负责从代码文件中智能提取标识符。

**主要功能**：
- 使用正则表达式从源代码中识别标识符、注释等可翻译元素
- 智能分解复合标识符（驼峰命名法、下划线命名法等）
- 通过黑名单过滤技术术语和无意义的短标识符
- 执行去重和词干匹配，提高提取质量

**关键函数**：
- `collectAndPrepareTranslatableItems`：从文档中收集并准备可翻译项
- `extractIdentifiers`：核心提取逻辑，识别源代码中的标识符
- `processUnderscoreIdentifier` 和 `processCamelCaseIdentifier`：处理不同命名风格的标识符
- `prioritizeIdentifiers`：对提取的标识符进行优先级排序

### 2. 翻译模块 (`translation/translator.ts`)

翻译模块负责与大语言模型(LLM)通信，将提取的标识符翻译成目标语言。

**主要功能**：
- 支持通过 Ollama API 调用本地大语言模型
- 批量处理标识符翻译请求
- 格式化和优化 LLM 输入提示
- 解析和验证翻译结果

**关键函数**：
- `translateItemsWithLLM`：使用 LLM 翻译项目的主要入口
- `createTranslationPrompt`：为 LLM 创建优化的翻译提示
- `getOllamaModels`：获取可用的 Ollama 模型列表
- `parseJSONResponse`：解析并验证 LLM 返回的 JSON 响应

### 3. 词汇表管理 (`vocabulary/vocabulary-manager.ts`)

词汇表管理模块负责管理翻译词汇库，包括加载、保存和更新词汇表。

**主要功能**：
- 加载和解析词汇表文件
- 合并新翻译到现有词汇表
- 管理多语言词汇表
- 提供词汇表的 CRUD 操作

**关键函数**：
- `loadVocabulary`：加载词汇表
- `saveVocabulary`：保存词汇表到文件
- `mergeTranslatedItemsToVocabulary`：将新翻译合并到主词汇表
- `initTempVocabulary`：初始化临时词汇表
- `clearVocabulary`：清除词汇表数据

### 4. 装饰器管理 (`ui/decorator-manager.ts`)

装饰器管理模块负责在 VSCode 编辑器中显示翻译后的文本。

**主要功能**：
- 创建和应用文本装饰
- 管理装饰范围和生命周期
- 处理文本样式和显示逻辑
- 智能处理标识符翻译的显示

**关键函数**：
- `applyMotherTongueDecorations`：应用母语装饰到编辑器
- `refreshAllDecorations`：刷新所有可见编辑器的装饰
- `clearAllDecorations`：清除所有装饰
- `clearDocumentDecorations`：清除特定文档的装饰
- `handleCompoundIdentifier`：处理复合标识符的翻译显示

### 5. 命令处理 (`commands/extract-commands.ts` & `commands/command-register.ts`)

命令处理模块注册和处理 VSCode 命令。

**主要功能**：
- 注册 VSCode 命令
- 处理文件提取和翻译工作流
- 处理用户交互和 UI 显示
- 执行词汇表操作

**关键函数**：
- `registerCommands`：注册所有命令
- `extractAndTranslateWorkflow`：执行提取和翻译工作流
- `translateExtractedItems`：翻译提取的项目
- `showExtractedItems`：显示提取的项目

### 6. 配置管理 (`config/config-manager.ts` & `config/blacklist-manager.ts`)

配置管理模块处理扩展配置和黑名单管理。

**主要功能**：
- 管理用户配置
- 加载和保存黑名单配置
- 提供语言设置
- 管理 LLM 配置

**关键函数**：
- `getExtensionConfig`：获取扩展配置
- `getTargetLanguage`：获取目标语言
- `setTargetLanguage`：设置目标语言
- `loadBlacklist`：加载黑名单配置
- `getTermsSet`：获取技术术语集合

## 工作流程

### 1. 标识符提取和翻译流程

1. **用户触发**：用户在编辑器中右键点击，选择"提取此文件中的标识符和注释"
2. **内容提取**：系统调用 `collectAndPrepareTranslatableItems` 从当前文件中提取标识符和注释
3. **与词汇表对比**：比较提取的项目与现有词汇表，确定需要翻译的新项目
4. **展示提取结果**：在 WebView 中显示提取到的新项目，让用户确认并选择要翻译的内容
5. **翻译处理**：如果用户确认翻译，系统调用 `translateExtractedItems` 发送请求给 LLM 进行翻译
6. **结果预览**：翻译结果返回后，在 WebView 中展示预览，让用户审核翻译质量
7. **合并到词汇表**：用户确认后，通过 `mergeTranslatedItemsToVocabulary` 将翻译结果合并到主词汇表
8. **保存词汇表**：调用 `saveVocabulary` 将更新后的词汇表保存到文件中
9. **刷新装饰**：调用 `refreshAllDecorations` 刷新所有打开的编辑器，应用新的翻译

### 2. 装饰应用流程

1. **扩展激活**：VSCode 窗口打开或配置更改时，扩展被激活
2. **词汇表加载**：系统加载主词汇表
3. **装饰初始应用**：对所有可见编辑器调用 `applyMotherTongueDecorations`，应用母语装饰
4. **标识符匹配**：为每个编辑器，扫描内容并匹配词汇表中的标识符
5. **装饰创建**：为每个匹配的标识符创建装饰，使用 `TextEditorDecorationType`
6. **实时更新**：当用户切换文件或编辑内容时，装饰被实时更新

## 用户配置选项

1. **目标语言**：用户可以选择翻译的目标语言（默认跟随 VSCode 界面语言）
2. **启用母语显示**：控制是否应用翻译装饰
3. **LLM 设置**：配置 Ollama API URL 和模型选择
4. **黑名单配置**：管理不需要翻译的技术术语和短标识符

## 黑名单系统

黑名单系统用于控制哪些标识符不应被翻译，包含几个主要部分：

1. **技术术语（`technicalTerms`）**：常见的编程语言、框架、库名称等技术术语
2. **忽略列表（`ignoreList`）**：单字母标识符、常见的短变量名等
3. **有意义的短词（`meaningfulShortWords`）**：尽管很短但有明确意义的单词
4. **Python 关键词（`pythonKeywords`）**：Python 编程语言的特定关键词
5. **自定义黑名单（`customBlacklist`）**：用户自定义的不翻译术语

## 贡献系统

该扩展支持用户贡献翻译改进，包括：

1. **贡献队列管理**：通过 `contribution-manager.ts` 管理用户提交的翻译改进
2. **贡献统计**：通过 `showContributionStats` 命令显示用户贡献统计
3. **贡献提交**：允许用户在翻译预览界面提交对现有翻译的改进

## 使用提示

1. **初次使用**：安装扩展后，打开代码文件，右键点击选择"提取此文件中的标识符和注释"
2. **调整目标语言**：通过命令面板执行"显示当前目标语言"或"设置目标语言"来更改语言
3. **配置 LLM**：通过命令面板执行"配置本地 LLM"来设置 Ollama API 连接
4. **管理词汇表**：可通过"显示翻译预览"查看当前词汇表，或通过"清除词汇表"重置
5. **检查重复项**：使用 `check_duplicates.py` 脚本检查词汇表中的重复项

## 技术实现亮点

1. **智能标识符分解**：能够识别和分解各种命名风格（驼峰、下划线等）的复合标识符
2. **非侵入式装饰**：使用 VSCode 装饰器 API 实现翻译显示，不修改源代码
3. **上下文感知**：能够根据标识符上下文优化提取和翻译结果
4. **灵活的黑名单系统**：通过多层次的黑名单提高翻译质量和相关性
5. **本地 LLM 集成**：支持通过 Ollama 使用本地大语言模型，保护代码安全

## 未来展望

1. **支持更多语言**：扩展对更多编程语言的特定语法识别能力
2. **增强的标识符分析**：引入更先进的自然语言处理技术，提高复合标识符的识别精度
3. **代码注释生成**：基于代码内容自动生成母语注释
4. **交互式词汇表编辑**：提供更友好的界面编辑和管理词汇表
5. **团队词汇表共享**：支持团队间共享和同步词汇表，统一翻译术语