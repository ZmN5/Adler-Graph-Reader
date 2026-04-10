import { useState, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { getModelConfig, updateModelConfig, ModelConfig } from '@/lib/api-client'
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
  const [config, setConfig] = useState<ModelConfig | null>(null)
  const [editValues, setEditValues] = useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null)

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
      setTimeout(() => setSaveSuccess(null), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update config')
    } finally {
      setIsSaving(false)
    }
  }, [editValues])

  if (isLoading) {
    return (
      <div className={cn('flex items-center justify-center p-8', className)}>
        <div className="h-6 w-6 border-2 border-neon-cyan/30 border-t-neon-cyan rounded-full animate-spin" />
      </div>
    )
  }

  if (error && !config) {
    return (
      <div className={cn('p-4 text-sm text-red-400 font-space', className)}>
        Failed to load model config: {error}
      </div>
    )
  }

  return (
    <div className={cn('space-y-6', className)}>
      <div className="flex items-center gap-3">
        <div className="relative">
          <Settings className="h-5 w-5 text-neon-cyan" />
          <div className="absolute inset-0 blur-sm bg-neon-cyan/30 rounded-full" />
        </div>
        <h2 className="text-lg font-space font-semibold text-white">Model Configuration</h2>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400 backdrop-blur-sm font-space">
          {error}
        </div>
      )}

      <div className="space-y-5">
        {CONFIG_FIELDS.map(({ key, label, description }) => (
          <div key={key} className="space-y-2 p-4 rounded-lg border border-white/10 bg-space-deep/40">
            <div className="flex items-center justify-between">
              <label htmlFor={key} className="text-sm font-space font-medium text-slate-200">
                {label}
              </label>
              {saveSuccess && editValues[key] !== config?.[key as keyof ModelConfig] && (
                <span className="text-xs text-neon-orange font-space">
                  Unsaved changes
                </span>
              )}
              {saveSuccess && editValues[key] === config?.[key as keyof ModelConfig] && (
                <span className="text-xs text-emerald-400 font-space">
                  ✓ Saved
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 font-space">{description}</p>
            <div className="flex gap-3">
              <input
                id={key}
                type="text"
                value={editValues[key] || ''}
                onChange={(e) => handleChange(key, e.target.value)}
                className="flex-1 rounded-md border border-white/20 bg-space-deep/80 px-3 py-2 text-sm font-space text-white placeholder-slate-500 focus:border-neon-cyan/50 focus:outline-none focus:ring-1 focus:ring-neon-cyan/30"
              />
              <button
                onClick={() => handleSave(key)}
                disabled={isSaving || editValues[key] === config?.[key as keyof ModelConfig]}
                className={cn(
                  'flex items-center gap-2 rounded-md px-4 py-2 text-sm font-space font-medium transition-all',
                  'bg-neon-cyan/20 border border-neon-cyan/40 text-neon-cyan',
                  'hover:bg-neon-cyan/30 hover:border-neon-cyan/60',
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

      <div className="rounded-lg border border-white/10 bg-space-deep/40 p-4">
        <p className="text-xs text-slate-500 font-space">
          Changes take effect immediately. Model names should match the models loaded in LM Studio.
        </p>
      </div>
    </div>
  )
}
