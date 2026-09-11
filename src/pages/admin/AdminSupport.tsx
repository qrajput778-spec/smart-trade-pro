import { useEffect, useState } from 'react'
import { collection, collectionGroup, getDocs, onSnapshot, orderBy, query } from 'firebase/firestore'
import { ArrowLeft, ShieldCheck } from 'lucide-react'
import Card from '../../components/Card'
import PageContainer from '../../components/PageContainer'
import SupportChatThread from '../../components/SupportChatThread'
import { useAuth } from '../../context/AuthContext'
import { db } from '../../lib/firebase'

interface ThreadSummary {
  uid: string
  lastMessage: string
  lastMessageAt: Date | null
  lastSenderRole: 'user' | 'admin'
}

interface UserInfo {
  displayName: string
  email: string
}

export default function AdminSupport() {
  const { user: adminUser } = useAuth()

  const [threads, setThreads] = useState<ThreadSummary[]>([])
  const [userInfo, setUserInfo] = useState<Record<string, UserInfo>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedUid, setSelectedUid] = useState<string | null>(null)

  // One-time lookup so the list/thread view can show a name and email
  // instead of a raw uid — same join pattern as AdminTrades.tsx.
  useEffect(() => {
    if (!db) return
    getDocs(collection(db, 'users'))
      .then((snapshot) => {
        const map: Record<string, UserInfo> = {}
        snapshot.forEach((docSnapshot) => {
          const data = docSnapshot.data()
          map[docSnapshot.id] = {
            displayName: typeof data.displayName === 'string' ? data.displayName : docSnapshot.id,
            email: typeof data.email === 'string' ? data.email : '—',
          }
        })
        setUserInfo(map)
      })
      .catch(() => {
        // Non-fatal — the list still works, just shows uids instead of names.
      })
  }, [])

  useEffect(() => {
    if (!db) {
      setError('Firebase is not configured yet — add your project keys to .env.')
      setLoading(false)
      return
    }

    // Reads the denormalized thread-summary docs (one per user, at
    // users/{uid}/supportChat/thread) — not every message — so this is one
    // cheap collection-group query, not a scan of every message ever sent.
    // Requires the draft admin rule + a collection-group index on
    // "lastMessageAt" once set up in Firebase.
    const threadsQuery = query(collectionGroup(db, 'supportChat'), orderBy('lastMessageAt', 'desc'))

    const unsubscribe = onSnapshot(
      threadsQuery,
      (snapshot) => {
        setThreads(
          snapshot.docs.map((docSnapshot) => {
            const data = docSnapshot.data()
            const lastMessageAt = data.lastMessageAt
            const uid = docSnapshot.ref.parent.parent?.id ?? String(data.uid ?? 'unknown')
            return {
              uid,
              lastMessage: String(data.lastMessage ?? ''),
              lastMessageAt:
                lastMessageAt && typeof lastMessageAt.toDate === 'function' ? lastMessageAt.toDate() : null,
              lastSenderRole: data.lastSenderRole === 'admin' ? 'admin' : 'user',
            }
          }),
        )
        setError(null)
        setLoading(false)
      },
      (err) => {
        // eslint-disable-next-line no-console
        console.error('[admin] failed to load support threads', err)
        setError('Could not load support threads. The admin Firestore rules may not be deployed yet.')
        setLoading(false)
      },
    )

    return unsubscribe
  }, [])

  const selectedInfo = selectedUid ? userInfo[selectedUid] : undefined

  return (
    <PageContainer>
      <header className="flex items-center gap-2">
        <ShieldCheck size={22} className="text-accent-gold" />
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Support Chats</h1>
          <p className="mt-1 text-sm text-text-muted">
            Real conversations with users. Replies here come from you, an actual admin — not an
            automated system.
          </p>
        </div>
      </header>

      {error && (
        <Card className="mt-6 border-danger/40">
          <p className="text-sm text-danger">{error}</p>
        </Card>
      )}

      {selectedUid ? (
        <div className="mt-6">
          <button
            type="button"
            onClick={() => setSelectedUid(null)}
            className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text-primary"
          >
            <ArrowLeft size={14} /> Back to all threads
          </button>
          <Card className="mt-4">
            <h2 className="font-medium text-text-primary">{selectedInfo?.displayName ?? selectedUid}</h2>
            <p className="text-xs text-text-muted">{selectedInfo?.email ?? ''}</p>
            <div className="mt-4">
              {adminUser && (
                <SupportChatThread
                  uid={selectedUid}
                  currentSenderId={adminUser.uid}
                  currentSenderRole="admin"
                  otherPartyLabel={selectedInfo?.displayName ?? 'User'}
                  emptyStateText="No messages yet."
                />
              )}
            </div>
          </Card>
        </div>
      ) : (
        <Card className="mt-6 overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">Last message</th>
                <th className="px-4 py-3 font-medium">From</th>
                <th className="px-4 py-3 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-text-muted">
                    Loading threads…
                  </td>
                </tr>
              ) : threads.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-text-muted">
                    No support conversations yet.
                  </td>
                </tr>
              ) : (
                threads.map((thread) => {
                  const info = userInfo[thread.uid]
                  return (
                    <tr
                      key={thread.uid}
                      onClick={() => setSelectedUid(thread.uid)}
                      className="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-surface-alt"
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium text-text-primary">{info?.displayName ?? thread.uid}</p>
                        <p className="text-xs text-text-muted">{info?.email ?? '—'}</p>
                      </td>
                      <td className="max-w-xs truncate px-4 py-3 text-text-muted">{thread.lastMessage}</td>
                      <td className="px-4 py-3 text-xs uppercase text-text-muted">{thread.lastSenderRole}</td>
                      <td className="px-4 py-3 text-text-muted">
                        {thread.lastMessageAt
                          ? thread.lastMessageAt.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
                          : '—'}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </Card>
      )}
    </PageContainer>
  )
}
