import { memo, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const link = { a: (p: React.ComponentProps<'a'>) => <a {...p} target="_blank" rel="noreferrer" /> }

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="md break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={link}>{text}</ReactMarkdown>
    </div>
  )
})

/** Words begin fading in at most this often (ms), so a burst of text still reads as a sweep; each takes FADE (ms) to show fully. */
const STEP = 4, FADE = 700 // FADE matches .stream-word's animation in globals.css. Longer than the stream takes to bring a line, so lines overlap; STEP keeps text close behind the stream

type Node = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: Node[] }

/**
 * A reply while it streams: every word fades in, in order. Since a word takes FADE to show and the next starts at most STEP
 * later, the last few lines are fading at once, newest faintest, as in ChatGPT. Code blocks just appear. Once the last word is
 * in, the reply settles into plain Markdown.
 */
export function StreamingMarkdown({ text, streaming }: { text: string; streaming: boolean }) {
  const delays = useRef<number[]>([]) // per word, fixed at its first render: how long its element waits before fading in
  const last = useRef(0) // when the latest word starts to show (performance.now)
  const [settled, setSettled] = useState(!streaming)
  useEffect(() => {
    if (streaming || settled) return
    const t = setTimeout(() => setSettled(true), Math.max(0, last.current - performance.now()) + FADE)
    return () => clearTimeout(t)
  }, [streaming, settled])
  if (settled) return <Markdown text={text} />

  const now = performance.now()
  const fade = () => (tree: Node) => {
    let i = 0
    const word = (value: string): Node => {
      if (delays.current[i] === undefined) { const at = Math.max(now, last.current + STEP); last.current = at; delays.current[i] = Math.round(at - now) }
      return { type: 'element', tagName: 'span', properties: { className: ['stream-word'], style: `animation-delay:${delays.current[i++]}ms` }, children: [{ type: 'text', value }] }
    }
    const walk = (n: Node) => {
      if (n.tagName === 'pre' || n.tagName === 'code' || !n.children) return
      n.children = n.children.flatMap((c) => c.type !== 'text' ? (walk(c), [c]) : c.value!.split(/(\s+)/).filter(Boolean).map((p) => (/^\s+$/.test(p) ? { type: 'text', value: p } : word(p))))
    }
    walk(tree)
  }
  return (
    <div className="md break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[fade]} components={link}>{text}</ReactMarkdown>
    </div>
  )
}
