import { create } from 'zustand'
import type { Language } from '@/lib/api-client'

interface AppState {
  isLoading: boolean
  error: string | null
  language: Language
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  clearError: () => void
  setLanguage: (language: Language) => void
}

export const useAppStore = create<AppState>((set) => ({
  isLoading: false,
  error: null,
  language: 'zh', // Default to Chinese
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  clearError: () => set({ error: null }),
  setLanguage: (language) => set({ language }),
}))