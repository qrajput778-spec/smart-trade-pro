import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react'
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore'
import { ImagePlus, ImageOff, Send, X } from 'lucide-react'
import Button from './Button'
import { db } from '../lib/firebase'
import {
  cleanupStaleThreadIfNeeded,
  getSupportChatImageUrl,
  sendSupportMessage,
  validateSupportChatImage,
  SUPPORT_CHAT_IMAGE_ACCEPT,
} from '../lib/supportChat'

interface ChatMessage {
  id: string
  senderRole: 'user' | 'admin' | 'system'
  text: string
  timestamp: Date | null
  // Present only on a message that carries an uploaded image — see
  // src/lib/supportChat.ts's sendSupportMessage. Absent on every other message.
  // Current messages carry `imagePath` (a Supabase Storage path — resolved
  // to a viewing URL on demand, see the `resolvedImageUrls` effect below);
  // `imageUrl` is legacy-only, a handful of pre-migration messages that
  // already had a persisted Firebase Storage URL and can just use it as-is.
  imagePath?: string
  imageUrl?: string
  imageName?: string
  imageSize?: number
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

/** e.g. 245000 -> "245 KB". Chat images are capped at 1 MB, so this never needs to show MB. */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${Math.round(bytes / 1024)} KB`
}

/**
 * A real live chat thread — every reply is a real person typing, with one
 * narrow exception: the single automatic first-contact acknowledgment
 * src/lib/supportChat.ts sends once when a brand-new conversation's first
 * message arrives (senderRole 'system', rendered distinctly below — see
 * `isSystem`). There is still no bot, no auto-reply to anything else, and
 * no "agent is typing" indicator. When there's nothing here yet, it looks
 * exactly like what it is: an empty inbox waiting for a real person to
 * write something. A message may also carry one image attachment (see the
 * composer below) — the file itself lives in Supabase Storage, never here.
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

  // ---- Image attachment (selected but not yet sent) ----
  const [selectedImage, setSelectedImage] = useState<File | null>(null)
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ---- Broken image URLs (from a snapshot, not from state) show a fallback instead of a broken <img>. ----
  const [brokenImageIds, setBrokenImageIds] = useState<Set<string>>(new Set())

  // ---- Signed viewing URLs for `imagePath` messages, resolved on demand and cached per message id. ----
  const [resolvedImageUrls, setResolvedImageUrls] = useState<Record<string, string>>({})
  const resolvingIdsRef = useRef<Set<string>>(new Set())

  // ---- Fullscreen lightbox ----
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

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
              senderRole: data.senderRole === 'admin' ? 'admin' : data.senderRole === 'system' ? 'system' : 'user',
              text: String(data.text ?? ''),
              timestamp: timestamp && typeof timestamp.toDate === 'function' ? timestamp.toDate() : null,
              imagePath: data.type === 'image' && typeof data.imagePath === 'string' ? data.imagePath : undefined,
              // Legacy-only — see the ChatMessage interface comment above.
              imageUrl: data.type === 'image' && typeof data.imageUrl === 'string' ? data.imageUrl : undefined,
              imageName: typeof data.imageName === 'string' ? data.imageName : undefined,
              imageSize: typeof data.imageSize === 'number' ? data.imageSize : undefined,
            }
          }),
        )
        setLoading(false)
      },
      () => setLoading(false),
    )
    return unsubscribe
  }, [uid])

  // Resolves a signed viewing URL for each new `imagePath` message — never
  // for a legacy `imageUrl` one, which is already directly usable. Cached
  // per message id in `resolvedImageUrls` (a signed URL is valid for an
  // hour — see SUPPORT_CHAT_SIGNED_URL_TTL_SECONDS — so re-resolving on
  // every snapshot update would be wasteful) and guarded by
  // `resolvingIdsRef` so a rapid double-update can't kick off two fetches
  // for the same message.
  useEffect(() => {
    for (const message of messages) {
      if (!message.imagePath) continue
      if (resolvedImageUrls[message.id] || resolvingIdsRef.current.has(message.id)) continue

      resolvingIdsRef.current.add(message.id)
      getSupportChatImageUrl(message.imagePath)
        .then((url) => {
          setResolvedImageUrls((prev) => ({ ...prev, [message.id]: url }))
        })
        .catch(() => {
          setBrokenImageIds((prev) => new Set(prev).add(message.id))
        })
        .finally(() => {
          resolvingIdsRef.current.delete(message.id)
        })
    }
  }, [messages, resolvedImageUrls])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length])

  // Revoke the object URL whenever it's replaced or the component unmounts
  // — same pattern as Kyc.tsx's own photo preview.
  useEffect(() => {
    if (!selectedImage) {
      setImagePreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(selectedImage)
    setImagePreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [selectedImage])

  // Escape closes the lightbox, matching Modal.tsx's own Escape-to-close.
  useEffect(() => {
    if (!lightboxUrl) return
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') setLightboxUrl(null)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [lightboxUrl])

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    // Allow re-selecting the exact same file later (e.g. after removing it).
    event.target.value = ''
    if (!file) return

    setError(null)
    const validationError = validateSupportChatImage(file)
    if (validationError) {
      setError(validationError)
      return
    }
    setSelectedImage(file)
  }

  function handleRemoveImage() {
    setSelectedImage(null)
  }

  async function handleSend(event?: FormEvent) {
    event?.preventDefault()
    const trimmed = input.trim()
    if ((!trimmed && !selectedImage) || sending) return

    setSending(true)
    setError(null)
    try {
      await sendSupportMessage(uid, currentSenderId, currentSenderRole, trimmed, selectedImage ?? undefined)
      setInput('')
      setSelectedImage(null) // Only cleared on success — a failed send keeps the image so the user can retry.
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
    <div className="flex h-[400px] flex-col sm:h-[500px]">
      <div className="flex-1 space-y-3 overflow-y-auto px-1 py-2">
        {loading ? (
          <p className="mt-8 text-center text-sm text-text-muted">Loading conversation…</p>
        ) : messages.length === 0 ? (
          <p className="mt-8 text-center text-sm text-text-muted">{emptyStateText}</p>
        ) : (
          messages.map((message) => {
            // The one automatic system message is never "mine" for either
            // viewer (user or admin) — it always reads as coming from
            // support, using the existing "not mine" bubble style rather
            // than a new one, per "use the existing bubble design, don't
            // make it look like a user message."
            const isSystem = message.senderRole === 'system'
            const isMine = !isSystem && message.senderRole === currentSenderRole
            const imageBroken = brokenImageIds.has(message.id)
            // `imagePath` (current schema) resolves asynchronously to a
            // signed URL — see the effect above; `imageUrl` (legacy schema,
            // pre-migration) is already a directly usable URL with nothing
            // to resolve. Exactly one of the two is ever set on a given message.
            const displayImageUrl = message.imagePath ? resolvedImageUrls[message.id] : message.imageUrl
            const hasImage = Boolean(message.imagePath || message.imageUrl)
            return (
              <div key={message.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                    isMine ? 'bg-accent-gold-soft' : 'bg-surface-alt'
                  }`}
                >
                  <p className="text-[10px] uppercase tracking-wide text-text-muted">
                    {isSystem ? 'SmartTradePro Support' : isMine ? 'You' : otherPartyLabel}
                  </p>
                  {hasImage && (
                    <div className="mt-1.5">
                      {imageBroken ? (
                        <div className="flex w-full max-w-[220px] flex-col items-center gap-1.5 rounded-md border border-dashed border-border bg-surface px-3 py-6 text-text-muted">
                          <ImageOff size={20} />
                          <span className="text-[11px]">Image unavailable</span>
                        </div>
                      ) : !displayImageUrl ? (
                        <div className="flex h-24 w-full max-w-[220px] items-center justify-center rounded-md border border-border bg-surface text-[11px] text-text-muted">
                          Loading image…
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setLightboxUrl(displayImageUrl)}
                          className="block overflow-hidden rounded-md border border-border transition-opacity hover:opacity-90"
                          aria-label="View image full size"
                        >
                          <img
                            src={displayImageUrl}
                            alt={message.imageName ?? 'Attached image'}
                            className="max-h-64 w-full max-w-[220px] object-cover"
                            onError={() => setBrokenImageIds((prev) => new Set(prev).add(message.id))}
                          />
                        </button>
                      )}
                    </div>
                  )}
                  {message.text && <p className="mt-1 whitespace-pre-wrap text-text-primary">{message.text}</p>}
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

      {selectedImage && (
        <div className="mt-2 flex items-center gap-2 rounded-md border border-border bg-surface-alt px-2.5 py-2">
          {imagePreviewUrl && (
            <img src={imagePreviewUrl} alt="" className="h-10 w-10 flex-none rounded object-cover" />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-text-primary">{selectedImage.name}</p>
            <p className="text-[11px] text-text-muted">{formatFileSize(selectedImage.size)}</p>
          </div>
          <button
            type="button"
            onClick={handleRemoveImage}
            disabled={sending}
            className="flex-none rounded p-1 text-text-muted transition-colors hover:bg-surface hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Remove selected image"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <form onSubmit={handleSend} className="mt-2 flex items-end gap-2 border-t border-border pt-3">
        <input
          ref={fileInputRef}
          type="file"
          accept={SUPPORT_CHAT_IMAGE_ACCEPT.join(',')}
          onChange={handleFileChange}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={sending}
          className="flex-none rounded-md border border-border p-2.5 text-text-muted transition-colors hover:border-accent-gold hover:text-accent-gold disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Attach an image"
          title="Attach an image"
        >
          <ImagePlus size={16} />
        </button>
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
          disabled={sending || (!input.trim() && !selectedImage)}
          className="flex flex-none items-center gap-1.5"
        >
          <Send size={14} /> {sending ? (selectedImage ? 'Uploading…' : 'Sending…') : 'Send'}
        </Button>
      </form>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}

      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightboxUrl(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Image preview"
        >
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            className="absolute right-4 top-4 rounded-md bg-black/50 p-2 text-white transition-colors hover:bg-black/70"
            aria-label="Close image preview"
          >
            <X size={20} />
          </button>
          <img
            src={lightboxUrl}
            alt="Attachment preview"
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}
