'use client'

import ReactMarkdown from 'react-markdown'
import { resolveSafeHref } from '@/lib/ai/safeLinks'

type MarkdownContentProps = {
  content: string
  toolUrls?: readonly string[]
}

export function MarkdownContent({ content, toolUrls = [] }: MarkdownContentProps): React.JSX.Element {
  return (
    <ReactMarkdown
      skipHtml
      disallowedElements={['img']}
      components={{
        img: () => null,
        h2: ({ children }) => (
          <h2 className="text-sm font-semibold text-slate-100 mt-3 mb-1 border-b border-neutral-border pb-1">
            {children}
          </h2>
        ),
        p: ({ children }) => <p className="text-sm leading-relaxed mb-2 text-slate-200">{children}</p>,
        ul: ({ children }) => <ul className="text-sm space-y-1 ml-3 mb-2">{children}</ul>,
        li: ({ children }) => (
          <li className="flex gap-2 before:content-['·'] before:text-slate-500 text-slate-200">
            {children}
          </li>
        ),
        strong: ({ children }) => <span className="font-semibold text-slate-100">{children}</span>,
        a: ({ href, children }) => {
          const safeHref = resolveSafeHref(href, toolUrls)
          if (!safeHref) return <span>{children}</span>
          return (
          <a
            href={safeHref}
            target="_blank"
            rel="noreferrer noopener"
            className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
          >
            {children}
          </a>
          )
        },
      }}
    >
      {content}
    </ReactMarkdown>
  )
}
