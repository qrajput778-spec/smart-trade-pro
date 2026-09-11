import Card from '../components/Card'
import PageContainer from '../components/PageContainer'
import SupportChatThread from '../components/SupportChatThread'
import { useAuth } from '../context/AuthContext'

export default function Support() {
  const { user } = useAuth()

  return (
    <PageContainer>
      <header>
        <h1 className="text-2xl font-semibold text-text-primary">Support</h1>
        <p className="mt-1 text-sm text-text-muted">A way to reach out to a real person.</p>
      </header>

      <section className="mt-8 max-w-2xl">
        <h2 className="text-lg font-semibold text-text-primary">Chat with Support</h2>
        <p className="mt-1 text-xs text-text-muted">
          Send a message and we'll get back to you here. A real person replies from the admin
          panel — this is not an automated or simulated responder.
        </p>
        <Card className="mt-4">
          {user ? (
            <SupportChatThread
              uid={user.uid}
              currentSenderId={user.uid}
              currentSenderRole="user"
              otherPartyLabel="Support"
              emptyStateText="Send a message and we'll get back to you here."
            />
          ) : (
            <p className="text-sm text-text-muted">Log in to start a conversation.</p>
          )}
        </Card>
      </section>
    </PageContainer>
  )
}
