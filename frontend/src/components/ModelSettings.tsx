import { useState, useEffect, useCallback, useRef } from 'react'
import { cn } from '@/lib/utils'
import { getModelConfig, updateModelConfig, ModelConfig } from '@/lib/api-client'
import { useTranslation } from '@/lib/i18n'
import { Settings, Save } from 'lucide-react'

interface ModelSettingsProps {
  className?: string
}

const CONFIG_FIELDS = [
  { key: 'embedding_model', label: 'Embedding Model', description: 'Model used for generating text embeddings' },
  { key: 'embedding_url', label: 'Embedding API URL', description: 'LM Studio embedding endpoint URL' },
  { key: 'llm_model', label: 'LLM Model', description: 'Model used for summarization and concept extraction' },
  { key: 'llm_api_url', label: 'LLM API URL', description: 'LM Studio LLM API endpoint URL' },
  { key: 'reranker_model', label: 'Reranker Model', description: 'Model used for reranking search results' },
] as const

export function ModelSettings({ className }: ModelSettingsProps) {
  const { t } = useTranslation()
  const [config, setConfig] = useState<ModelConfig | null>(null)
  const [editValues, setEditValues] = useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    getModelConfig()
      .then((cfg) => {
        setConfig(cfg)
        setEditValues({
          embedding_model: cfg.embedding_model,
          embedding_url: cfg.embedding_url,
          llm_model: cfg.llm_model,
          llm_api_url: cfg.llm_api_url,
          reranker_model: cfg.reranker_model,
        })
      })
      .catch((e) => setError(e.message))
      .finally(() => setIsLoading(false))
  }, [])

  const handleChange = useCallback((key: string, value: string) => {
    setEditValues((prev) => ({ ...prev, [key]: value }))
    setSaveSuccess(null)
  }, [])

  const handleSave = useCallback(async (key: string) => {
    if (!editValues[key]) return

    setIsSaving(true)
    setError(null)
    setSaveSuccess(null)

    try {
      const updated = await updateModelConfig(key, editValues[key])
      setConfig(updated)
      setSaveSuccess(`Updated ${key}`)
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = setTimeout(() => setSaveSuccess(null), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update config')
    } finally {
      setIsSaving(false)
    }
  }, [editValues])

  if (isLoading) {
    return (
      <div className={cn('flex items-center justify-center p-8', className)}>
        <div className="h-6 w-6 border-2 border-gray-200 border-t-apple-blue rounded-full animate-spin" />
      </div>
    )
  }

  if (error && !config) {
    return (
      <div className={cn('p-4 text-sm text-red-500 font-sans', className)}>
        Failed to load model config: {error}
      </div>
    )
  }

  return (
    <div className={cn('space-y-6', className)}>
      <div className="flex items-center gap-3">
        <div className="relative">
          <Settings className="h-5 w-5 text-apple-blue" />
        </div>
        <h2 className="text-lg font-sans font-semibold text-gray-900">{t('modelSettings.title')}</h2>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600 font-sans">
          {error}
        </div>
      )}

      <div className="space-y-5">
        {CONFIG_FIELDS.map(({ key, label, description }) => (
          <div key={key} className="space-y-2 p-4 rounded-xl border border-gray-200 bg-white">
            <div className="flex items-center justify-between">
              <label htmlFor={key} className="text-sm font-sans font-medium text-gray-700">
                {label}
              </label>
              {saveSuccess && editValues[key] !== config?.[key as keyof ModelConfig] && (
                <span className="text-xs text-amber-600 font-sans">
                  Unsaved changes
                </span>
              )}
              {saveSuccess && editValues[key] === config?.[key as keyof ModelConfig] && (
                <span className="text-xs text-green-600 font-sans">
                  Saved
                </span>
              )}
            </div>
            <p className="text-xs text-gray-400 font-sans">{description}</p>
            <div className="flex gap-3">
              <input
                id={key}
                type="text"
                value={editValues[key] || ''}
                onChange={(e) => handleChange(key, e.target.value)}
                className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-sans text-gray-900 placeholder-gray-400 focus:border-apple-blue focus:outline-none focus:ring-2 focus:ring-apple-blue/20"
              />
              <button
                onClick={() => handleSave(key)}
                disabled={isSaving || editValues[key] === config?.[key as keyof ModelConfig]}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-sans font-medium transition-all',
                  'bg-apple-blue text-white',
                  'hover:bg-blue-600',
                  'disabled:opacity-50 disabled:cursor-not-allowed'
                )}
              >
                {isSaving ? (
                  <div className="h-4 w-4 border border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <p className="text-xs text-gray-400 font-sans">
          Changes take effect immediately. Model names should match the models loaded in LM Studio.
        </p>
      </div>
    </div>
  )
}
