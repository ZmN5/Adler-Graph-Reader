import { createContext, useContext, useCallback, type ReactNode } from 'react'
import { useAppStore } from '@/stores/app-store'
import type { Language } from '@/lib/api-client'

// Translation type
type TranslationKey = keyof typeof translations.zh

// Translation strings
const translations = {
  zh: {
    // App
    'app.hero.title': 'COSMIC',
    'app.hero.subtitle': 'KNOWLEDGE',
    'app.hero.description': '通过交互式概念星图导航您的阅读之旅。提取、探索并前所未有的方式理解知识。',
    'app.library.title': '◆ 您的宇宙图书馆',
    'app.settings.title': '设置',
    'app.close': '关闭',

    // Navigation
    'nav.conceptGraph': '概念图谱',
    'nav.coreConcepts': '核心概念',

    // Core Concepts
    'coreConcepts.title': '核心概念',
    'coreConcepts.loading': '正在扫描核心概念...',
    'coreConcepts.empty': '尚未发现核心概念',
    'coreConcepts.emptyHint': '从此书中提取概念以发现星辰',
    'coreConcepts.references': '个引用',
    'coreConcepts.examples': '示例：',
    'coreConcepts.moreExamples': '更多示例',
    'coreConcepts.view': '查看',

    // Node Detail Panel
    'nodeDetail.aiAnalysis': 'AI 分析',
    'nodeDetail.scanning': '正在扫描宇宙数据...',
    'nodeDetail.retry': '重试',
    'nodeDetail.description': '描述',
    'nodeDetail.examples': '示例',
    'nodeDetail.sources': '来源',
    'nodeDetail.viewInPdf': '在 PDF 中查看',
    'nodeDetail.viewInEpub': '在 EPUB 中查看',
    'nodeDetail.sourceCitations': '⬡ 源引用',
    'nodeDetail.moreCitations': '更多引用',
    'nodeDetail.retrievalDetails': '检索详情',
    'nodeDetail.loading': '正在分析星球...',
    'nodeDetail.page': '页',
    'nodeDetail.chapter': '章节',

    // Graph
    'graph.nodes': '个节点',
    'graph.edges': '条边',
    'graph.expand': '展开',
    'graph.legend': '图例',
    'graph.filter': '筛选',

    // Book List
    'bookList.empty': '您的图书馆是空的',
    'bookList.emptyHint': '上传一本书开始探索',
    'bookList.delete': '删除',
    'bookList.extract': '提取概念图谱',

    // Upload
    'upload.title': '上传书籍',
    'upload.dragHint': '将 PDF 或 EPUB 文件拖放到此处',
    'upload.or': '或',
    'upload.browse': '浏览文件',
    'upload.processing': '正在处理...',
    'upload.success': '上传成功！',
    'upload.error': '上传失败',

    // Settings
    'settings.title': '设置',
    'settings.model': '模型配置',
    'settings.embedding': 'Embedding 模型',
    'settings.llm': 'LLM 模型',
    'settings.reranker': 'Reranker 模型',
    'settings.apiUrl': 'API URL',
    'settings.save': '保存',
    'settings.saved': '已保存！',
    'settings.loading': '正在加载...',
    'settings.loadError': '加载设置失败',

    // Model Settings specific
    'modelSettings.title': '模型配置',
    'modelSettings.embeddingModel': 'Embedding 模型',
    'modelSettings.embeddingUrl': 'Embedding API URL',
    'modelSettings.llmModel': 'LLM 模型',
    'modelSettings.llmUrl': 'LLM API URL',
    'modelSettings.rerankerModel': 'Reranker 模型',
    'modelSettings.save': '保存设置',
    'modelSettings.saving': '正在保存...',
    'modelSettings.saved': '已保存！',
    'modelSettings.error': '保存失败',

    // Common
    'common.loading': '加载中...',
    'common.error': '错误',
    'common.close': '关闭',
    'common.cancel': '取消',
    'common.confirm': '确认',
    'common.delete': '删除',
  },
  en: {
    // App
    'app.hero.title': 'COSMIC',
    'app.hero.subtitle': 'KNOWLEDGE',
    'app.hero.description': 'Navigate your reading journey through an interactive constellation of concepts. Extract, explore, and understand knowledge like never before.',
    'app.library.title': 'Your Cosmic Library',
    'app.settings.title': 'Settings',
    'app.close': 'Close',

    // Navigation
    'nav.conceptGraph': 'Concept Graph',
    'nav.coreConcepts': 'Core Concepts',

    // Core Concepts
    'coreConcepts.title': 'Core Concepts',
    'coreConcepts.loading': 'Scanning for core concepts...',
    'coreConcepts.empty': 'No core concepts discovered yet',
    'coreConcepts.emptyHint': 'Extract concepts from this book to find the stars',
    'coreConcepts.references': 'references',
    'coreConcepts.examples': 'Examples:',
    'coreConcepts.moreExamples': 'more examples',
    'coreConcepts.view': 'View',

    // Node Detail Panel
    'nodeDetail.aiAnalysis': 'AI Analysis',
    'nodeDetail.scanning': 'Scanning cosmic data...',
    'nodeDetail.retry': 'Retry',
    'nodeDetail.description': 'Description',
    'nodeDetail.examples': 'Examples',
    'nodeDetail.sources': 'Sources',
    'nodeDetail.viewInPdf': 'View in PDF',
    'nodeDetail.viewInEpub': 'View in EPUB',
    'nodeDetail.sourceCitations': '⬡ Source Citations',
    'nodeDetail.moreCitations': 'more citations',
    'nodeDetail.retrievalDetails': 'Retrieval Details',
    'nodeDetail.loading': 'Analyzing planet...',
    'nodeDetail.page': 'Page',
    'nodeDetail.chapter': 'Chapter',

    // Graph
    'graph.nodes': 'nodes',
    'graph.edges': 'edges',
    'graph.expand': 'Expand',
    'graph.legend': 'Legend',
    'graph.filter': 'Filter',

    // Book List
    'bookList.empty': 'Your library is empty',
    'bookList.emptyHint': 'Upload a book to start exploring',
    'bookList.delete': 'Delete',
    'bookList.extract': 'Extract Graph',

    // Upload
    'upload.title': 'Upload Book',
    'upload.dragHint': 'Drag and drop a PDF or EPUB file here',
    'upload.or': 'or',
    'upload.browse': 'Browse files',
    'upload.processing': 'Processing...',
    'upload.success': 'Upload successful!',
    'upload.error': 'Upload failed',

    // Settings
    'settings.title': 'Settings',
    'settings.model': 'Model Configuration',
    'settings.embedding': 'Embedding Model',
    'settings.llm': 'LLM Model',
    'settings.reranker': 'Reranker Model',
    'settings.apiUrl': 'API URL',
    'settings.save': 'Save',
    'settings.saved': 'Saved!',
    'settings.loading': 'Loading...',
    'settings.loadError': 'Failed to load settings',

    // Model Settings specific
    'modelSettings.title': 'Model Configuration',
    'modelSettings.embeddingModel': 'Embedding Model',
    'modelSettings.embeddingUrl': 'Embedding API URL',
    'modelSettings.llmModel': 'LLM Model',
    'modelSettings.llmUrl': 'LLM API URL',
    'modelSettings.rerankerModel': 'Reranker Model',
    'modelSettings.save': 'Save Settings',
    'modelSettings.saving': 'Saving...',
    'modelSettings.saved': 'Saved!',
    'modelSettings.error': 'Failed to save',

    // Common
    'common.loading': 'Loading...',
    'common.error': 'Error',
    'common.close': 'Close',
    'common.cancel': 'Cancel',
    'common.confirm': 'Confirm',
    'common.delete': 'Delete',
  },
}

// Context
interface I18nContextValue {
  t: (key: TranslationKey) => string
  language: Language
  setLanguage: (lang: Language) => void
}

const I18nContext = createContext<I18nContextValue | null>(null)

// Provider component
export function I18nProvider({ children }: { children: ReactNode }) {
  const { language, setLanguage } = useAppStore()

  const t = useCallback(
    (key: TranslationKey): string => {
      return translations[language][key] || translations.en[key] || key
    },
    [language]
  )

  return (
    <I18nContext.Provider value={{ t, language, setLanguage }}>
      {children}
    </I18nContext.Provider>
  )
}

// Hook to use translations
// eslint-disable-next-line react-refresh/only-export-components
export function useTranslation() {
  const context = useContext(I18nContext)
  // Always call hook at top level to satisfy rules-of-hooks
  const store = useAppStore()
  if (!context) {
    // Fallback if used outside provider
    const { language, setLanguage } = store
    const t = (key: TranslationKey): string => {
      return translations[language][key] || translations.en[key] || key
    }
    return { t, language, setLanguage }
  }
  return context
}
