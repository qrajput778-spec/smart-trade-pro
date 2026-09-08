import { useState, type FormEvent } from 'react'
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { CheckCircle2 } from 'lucide-react'
import Card from '../components/Card'
import Button from '../components/Button'
import TextField from '../components/TextField'
import PageContainer from '../components/PageContainer'
import { useAuth } from '../context/AuthContext'
import { db } from '../lib/firebase'

// Static FAQ — accurate to what's actually built in this app, not generic filler.
const FAQ_ITEMS = [
  {
    question: 'Is this real money?',
    answer:
      'No. Every dollar and every coin in SMART TRADE PRO is simulated. Signing up seeds your ' +
      'account with virtual practice funds, and Buy/Sell orders only change numbers in your own ' +
      'Firestore account document — nothing here ever touches a real bank account, card, or ' +
      'crypto wallet.',
  },
  {
    question: 'How do I get more virtual funds?',
    answer:
      'Open your Wallet and use "Add Virtual Funds" to top up your simulated cash balance, or ' +
      '"Reset Portfolio" to clear your holdings and start over from the starting balance.',
  },
  {
    question: 'What markets are supported?',
    answer:
      "Five assets: BTC, ETH, SOL, XRP, and BNB. Prices are real, live spot prices pulled from " +
      "CoinGecko's public API and refreshed every 30 seconds.",
  },
  {
    question: 'Are there any trading fees?',
    answer: 'No — every simulated order executes at a flat 0% fee.',
  },
  {
    question: 'Is my data private?',
    answer:
      "Your account (email, balance, holdings, and trade history) is stored in this project's " +
      'Firebase backend and is only readable by your own signed-in account. This is a ' +
      'university course project, not a commercial product — your data is never sold or shared.',
  },
  {
    question: 'Can I withdraw real crypto or cash?',
    answer:
      'No. There is no real deposit, withdrawal, wallet address collection, or identity ' +
      'verification anywhere in this app — it exists purely to practice trading concepts ' +
      'risk-free.',
  },
]

export default function Support() {
  const { user } = useAuth()
  const [name, setName] = useState('')
  const [email, setEmail] = useState(user?.email ?? '')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()

    if (!name.trim() || !email.trim() || !message.trim()) {
      setSubmitError('Please fill in every field before sending.')
      return
    }
    if (!db) {
      setSubmitError('Firebase is not configured yet — add your project keys to .env.')
      return
    }

    setSubmitting(true)
    setSubmitError(null)
    try {
      await addDoc(collection(db, 'supportMessages'), {
        uid: user?.uid ?? null,
        name: name.trim(),
        email: email.trim(),
        message: message.trim(),
        createdAt: serverTimestamp(),
      })
      setSubmitted(true)
      setMessage('')
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[support] failed to submit message', err)
      setSubmitError('Could not send your message — please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PageContainer>
      <header>
        <h1 className="text-2xl font-semibold text-text-primary">Support</h1>
        <p className="mt-1 text-sm text-text-muted">Answers to common questions, plus a way to reach out.</p>
      </header>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-text-primary">Frequently Asked Questions</h2>
        <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
          {FAQ_ITEMS.map((item) => (
            <Card key={item.question}>
              <p className="font-medium text-text-primary">{item.question}</p>
              <p className="mt-2 text-sm leading-relaxed text-text-muted">{item.answer}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="mt-10 max-w-xl">
        <h2 className="text-lg font-semibold text-text-primary">Contact Us</h2>
        <Card className="mt-4">
          {submitted ? (
            <div className="flex items-start gap-2 text-sm text-success">
              <CheckCircle2 size={18} className="mt-0.5 flex-none" />
              <span>
                Message received — since this is a course project, there's no live support team
                monitoring this yet.
              </span>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <TextField label="Name" name="name" value={name} onChange={(event) => setName(event.target.value)} />
              <TextField
                label="Email"
                name="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <div>
                <label htmlFor="support-message" className="block text-sm font-medium text-text-primary">
                  Message
                </label>
                <textarea
                  id="support-message"
                  name="message"
                  rows={4}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  className="mt-1.5 w-full rounded-md border border-border bg-surface-alt px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-gold focus:outline-none focus:ring-1 focus:ring-accent-gold"
                />
              </div>

              {submitError && <p className="text-xs text-danger">{submitError}</p>}

              <Button type="submit" variant="primary" className="w-full" disabled={submitting}>
                {submitting ? 'Sending…' : 'Send Message'}
              </Button>
            </form>
          )}
        </Card>
      </section>
    </PageContainer>
  )
}
