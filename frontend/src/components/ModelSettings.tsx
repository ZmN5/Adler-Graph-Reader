import { useState, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { getModelConfig, updateModelConfig, ModelConfig } from '@/lib/api-client'
import { Settings, Save, Loader2 } from 'lucide-react'

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
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error && !config) {
    return (
      <div className={cn('p-4 text-sm text-destructive', className)}>
        Failed to load model config: {error}
      </div>
    )
  }

  return (
    <div className={cn('space-y-6', className)}>
      <div className="flex items-center gap-2">
        <Settings className="h-5 w-5" />
        <h2 className="text-lg font-semibold">Model Configuration</h2>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="space-y-4">
        {CONFIG_FIELDS.map(({ key, label, description }) => (
          <div key={key} className="space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor={key} className="text-sm font-medium">
                {label}
              </label>
              {saveSuccess && editValues[key] !== config?.[key as keyof ModelConfig] && (
                <span className="text-xs text-muted-foreground">
                  Unsaved changes
                </span>
              )}
              {saveSuccess && editValues[key] === config?.[key as keyof ModelConfig] && (
                <span className="text-xs text-green-600">
                  Saved
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{description}</p>
            <div className="flex gap-2">
              <input
                id={key}
                type="text"
                value={editValues[key] || ''}
                onChange={(e) => handleChange(key, e.target.value)}
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              <button
                onClick={() => handleSave(key)}
                disabled={isSaving || editValues[key] === config?.[key as keyof ModelConfig]}
                className={cn(
                  'flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  'bg-primary text-primary-foreground hover:bg-primary/90',
                  'disabled:opacity-50 disabled:cursor-not-allowed'
                )}
              >
                {isSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-md bg-muted p-3">
        <p className="text-xs text-muted-foreground">
          Changes take effect immediately. Model names should match the models loaded in LM Studio.
        </p>
      </div>
    </div>
  )
}
