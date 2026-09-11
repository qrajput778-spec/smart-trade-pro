import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore'
import { Send } from 'lucide-react'
import Button from './Button'
import { db } from '../lib/firebase'
import { cleanupStaleThreadIfNeeded, sendSupportMessage } from '../lib/supportChat'

interface ChatMessage {
  id: string
  senderRole: 'user' | 'admin'
  text: string
  timestamp: Date | null
}

interface SupportChatThreadProps {
  /** Whose thread this is — the account owner's uid, regardless of who's viewing it. */
  uid: string
  currentSenderId: string
  currentSenderRole: 'user' | 'admin'
  /** Label shown above messages NOT sent by the current viewer (e.g. "Support", or the user's name). */
  otherPartyLabel: string
  emptyStateText: string
}

/**
 * A real live chat thread — no bot, no auto-reply, no "agent is typing"
 * indicator. When there's nothing here yet, it looks exactly like what it
 * is: an empty inbox waiting for a real person to write something.
 */
export default function SupportChatThread({
  uid,
  currentSenderId,
  currentSenderRole,
  otherPartyLabel,
  emptyStateText,
}: SupportChatThreadProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Best-effort client-triggered cleanup of a stale (7+ day old) thread —
  // see src/lib/supportChat.ts for why this can't be a guaranteed schedule.
  useEffect(() => {
    cleanupStaleThreadIfNeeded(uid).catch(() => {
      // Non-fatal — worst case, an old thread just isn't cleaned up this time.
    })
  }, [uid])

  useEffect(() => {
    if (!db) {
      setLoading(false)
      return
    }
    const messagesQuery = query(
      collection(db, 'users', uid, 'supportChat', 'thread', 'messages'),
      orderBy('timestamp', 'asc'),
    )
    const unsubscribe = onSnapshot(
      messagesQuery,
      (snapshot) => {
        setMessages(
          snapshot.docs.map((docSnapshot) => {
            const data = docSnapshot.data()
            const timestamp = data.timestamp
            return {
              id: docSnapshot.id,
              senderRole: data.senderRole === 'admin' ? 'admin' : 'user',
              text: String(data.text ?? ''),
              timestamp: timestamp && typeof timestamp.toDate === 'function' ? timestamp.toDate() : null,
            }
          }),
        )
        setLoading(false)
      },
      () => setLoading(false),
    )
    return unsubscribe
  }, [uid])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length])

  async function handleSend(event?: FormEvent) {
    event?.preventDefault()
    const trimmed = input.trim()
    if (!trimmed || sending) return

    setSending(true)
    setError(null)
    try {
      await sendSupportMessage(uid, currentSenderId, currentSenderRole, trimmed)
      setInput('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send your message — please try again.')
    } finally {
      setSending(false)
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex h-[500px] flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto px-1 py-2">
        {loading ? (
          <p className="mt-8 text-center text-sm text-text-muted">Loading conversation…</p>
        ) : messages.length === 0 ? (
          <p className="mt-8 text-center text-sm text-text-muted">{emptyStateText}</p>
        ) : (
          messages.map((message) => {
            const isMine = message.senderRole === currentSenderRole
            return (
              <div key={message.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                    isMine ? 'bg-accent-gold-soft' : 'bg-surface-alt'
                  }`}
                >
                  <p className="text-[10px] uppercase tracking-wide text-text-muted">
                    {isMine ? 'You' : otherPartyLabel}
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap text-text-primary">{message.text}</p>
                  {message.timestamp && (
                    <p className="mt-1 text-[10px] text-text-muted">
                      {message.timestamp.toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })}
                    </p>
                  )}
                </div>
              </div>
            )
          })
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSend} className="mt-2 flex items-end gap-2 border-t border-border pt-3">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          placeholder="Type a message…"
          className="flex-1 resize-none rounded-md border border-border bg-surface-alt px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-gold focus:outline-none focus:ring-1 focus:ring-accent-gold"
        />
        <Button
          type="submit"
          variant="primary"
          disabled={sending || !input.trim()}
          className="flex flex-none items-center gap-1.5"
        >
          <Send size={14} /> Send
        </Button>
      </form>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  )
}
