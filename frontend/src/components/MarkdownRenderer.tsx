import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

interface MarkdownRendererProps {
  text: string
  className?: string
  inline?: boolean
}

export function MarkdownRenderer({ text, className, inline = false }: MarkdownRendererProps) {
  if (inline) {
    return (
      <span className={cn('inline', className)}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            p: ({ children }) => <span className="inline">{children}</span>,
            ul: ({ children }) => <span className="inline">{children}</span>,
            ol: ({ children }) => <span className="inline">{children}</span>,
            li: ({ children }) => <span className="inline mr-2">{children}</span>,
            pre: ({ children }) => (
              <code className="px-1 py-0.5 bg-gray-100 rounded text-xs font-mono">{children}</code>
            ),
            code: ({ className: codeClass, children }) => {
              const isInline = !codeClass
              return isInline ? (
                <code className="px-1 py-0.5 bg-gray-100 rounded text-xs font-mono">{children}</code>
              ) : (
                <code className="text-xs font-mono">{children}</code>
              )
            },
            strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
            em: ({ children }) => <em className="italic">{children}</em>,
            a: ({ href, children }) => (
              <a href={href} className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ),
          }}
        >
          {text}
        </ReactMarkdown>
      </span>
    )
  }

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="list-disc pl-5 mb-2">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 mb-2">{children}</ol>,
          li: ({ children }) => <li className="mb-0.5">{children}</li>,
          h1: ({ children }) => <h1 className="text-lg font-bold mb-2 mt-3">{children}</h1>,
          h2: ({ children }) => <h2 className="text-base font-bold mb-2 mt-3">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-bold mb-1 mt-2">{children}</h3>,
          h4: ({ children }) => <h4 className="text-sm font-bold mb-1 mt-2">{children}</h4>,
          h5: ({ children }) => <h5 className="text-sm font-semibold mb-1 mt-2">{children}</h5>,
          h6: ({ children }) => <h6 className="text-sm font-semibold mb-1 mt-2">{children}</h6>,
          pre: ({ children }) => (
            <pre className="bg-gray-100 rounded-lg p-3 overflow-x-auto my-2">{children}</pre>
          ),
          code: ({ className: codeClass, children }) => {
            const isInline = !codeClass
            return isInline ? (
              <code className="px-1 py-0.5 bg-gray-100 rounded text-xs font-mono">{children}</code>
            ) : (
              <code className="text-xs font-mono">{children}</code>
            )
          },
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-gray-300 pl-3 italic my-2">{children}</blockquote>
          ),
          hr: () => <hr className="my-3 border-gray-200" />,
          table: ({ children }) => (
            <table className="border-collapse my-2 w-full">{children}</table>
          ),
          th: ({ children }) => (
            <th className="border border-gray-300 px-2 py-1 bg-gray-50 text-xs text-left font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-gray-300 px-2 py-1 text-xs">{children}</td>
          ),
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          a: ({ href, children }) => (
            <a href={href} className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
