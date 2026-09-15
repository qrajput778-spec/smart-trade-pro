import Card from '../components/Card'
import PageContainer from '../components/PageContainer'
import SupportChatThread from '../components/SupportChatThread'
import { useAuth } from '../context/AuthContext'

export default function Support() {
  const { user } = useAuth()

  return (
    <PageContainer>
      <header>
        <h1 className="text-2xl font-semibold text-text-primary">Live Chat</h1>
        <p className="mt-1 text-sm text-text-muted">A way to reach out to a real person.</p>
      </header>

      {/* Wider than a typical form card — a chat panel benefits from the
          extra horizontal room on desktop, unlike most of this app's
          content cards. Still caps out well short of PageContainer's own
          1800px ceiling so lines/bubbles don't stretch absurdly wide on an
          ultrawide monitor. */}
      <section className="mt-8 max-w-5xl">
        <Card className="overflow-hidden p-0">
          {/* Chat header — mirrors a real live-chat widget: title, a small
              "we're online" indicator, and a one-line reassurance that this
              goes to an actual person, not a bot. */}
          <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-alt/60 px-5 py-4">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-text-primary">Live Chat</h2>
                <span className="relative flex h-2.5 w-2.5" title="Online" aria-hidden="true">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-success" />
                </span>
                <span className="sr-only">Online</span>
              </div>
              <p className="mt-1 text-xs text-text-muted">
                Our support team is available to assist you — replies come from a real person, never a bot.
              </p>
            </div>
          </div>

          <div className="px-4 py-3 sm:px-5">
            {user ? (
              <SupportChatThread
                uid={user.uid}
                currentSenderId={user.uid}
                currentSenderRole="user"
                otherPartyLabel="Live Chat"
                emptyStateText="Send a message to start your live chat — a real person will reply here."
              />
            ) : (
              <p className="py-8 text-center text-sm text-text-muted">Log in to start a conversation.</p>
            )}
          </div>
        </Card>
      </section>
    </PageContainer>
  )
}
