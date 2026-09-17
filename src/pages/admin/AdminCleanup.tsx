import { useState } from 'react'
import { AlertTriangle, CheckCircle2, PlayCircle, ShieldCheck, Trash2, XCircle } from 'lucide-react'
import Card from '../../components/Card'
import Button from '../../components/Button'
import Badge from '../../components/Badge'
import TextField from '../../components/TextField'
import ConfirmDialog from '../../components/ConfirmDialog'
import PageContainer from '../../components/PageContainer'
import { useAuth } from '../../context/AuthContext'
import {
  previewTestDataCleanup,
  executeTestDataCleanup,
  CleanupError,
  type CleanupPreview,
  type CleanupExecutionReport,
  type CleanupTotals,
} from '../../lib/cleanup'

const CONFIRM_PHRASE = 'EMPTY TEST DATA'

const TOTAL_LABELS: { key: keyof CleanupTotals; label: string }[] = [
  { key: 'userCount', label: 'Non-admin users' },
  { key: 'transactionCount', label: 'Trades' },
  { key: 'portfolioSnapshotCount', label: 'Portfolio snapshots' },
  { key: 'timedTradeCount', label: 'Timed trades' },
  { key: 'supportMessageCount', label: 'Support messages' },
  { key: 'kycSubmissionCount', label: 'KYC submissions' },
  { key: 'balanceRequestCount', label: 'Deposit/withdrawal requests' },
  { key: 'supabaseKycFileCount', label: 'Supabase KYC files' },
  { key: 'supabaseSupportFileCount', label: 'Supabase support files' },
]

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-3">
      <span className="text-[11px] uppercase tracking-wide text-text-muted">{label}</span>
      <p className="mt-1 font-mono text-xl text-text-primary">{value.toLocaleString('en-US')}</p>
    </Card>
  )
}

/**
 * Admin-only "Empty Test Data" tool.
 *
 * Dry Run (previewTestDataCleanup) and Execute (executeTestDataCleanup) are
 * kept as two clearly separate steps — see src/lib/cleanup.ts for what each
 * actually does. Execute is gated behind: having already run a dry run this
 * page load, typing the exact confirmation phrase, and a final ConfirmDialog
 * warning that this cannot be undone. A success banner is only ever shown
 * when the execution report says fullySucceeded — a partial run always shows
 * as a warning with the exact failures listed, never as success.
 */
export default function AdminCleanup() {
  const { user: adminUser } = useAuth()

  const [preview, setPreview] = useState<CleanupPreview | null>(null)
  const [dryRunLoading, setDryRunLoading] = useState(false)
  const [dryRunError, setDryRunError] = useState<string | null>(null)

  const [confirmPhrase, setConfirmPhrase] = useState('')
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number; email: string } | null>(null)
  const [executionReport, setExecutionReport] = useState<CleanupExecutionReport | null>(null)
  const [executionError, setExecutionError] = useState<string | null>(null)

  async function handleRunDryRun() {
    setDryRunLoading(true)
    setDryRunError(null)
    try {
      const result = await previewTestDataCleanup()
      setPreview(result)
      // A fresh dry run invalidates any previous execution report/typed
      // phrase — the admin should re-confirm against current numbers, not
      // whatever was true before.
      setExecutionReport(null)
      setExecutionError(null)
      setConfirmPhrase('')
    } catch (err) {
      setDryRunError(err instanceof CleanupError ? err.message : 'Could not compute the cleanup preview — please try again.')
    } finally {
      setDryRunLoading(false)
    }
  }

  async function handleExecute() {
    if (!adminUser || !preview) return
    setExecutionError(null)
    setExecuting(true)
    setProgress({ done: 0, total: preview.usersToClean.length, email: '' })
    try {
      const report = await executeTestDataCleanup(adminUser.uid, adminUser.email, (done, total, user) => {
        setProgress({ done, total, email: user.email })
      })
      setExecutionReport(report)
      // The numbers on screen from the old dry run are now stale — replace
      // them with the report's own fresh "after" scan so the page never
      // shows pre-cleanup counts next to a "done" result.
      setPreview(report.after)
      setConfirmPhrase('')
    } catch (err) {
      // executeTestDataCleanup itself only throws for something that
      // prevented it from even starting (e.g. Firestore not configured) —
      // per-user failures are captured inside the report, not thrown here.
      setExecutionError(err instanceof CleanupError ? err.message : 'Could not run the cleanup — please try again.')
    } finally {
      setExecuting(false)
      setProgress(null)
    }
  }

  const canExecute = preview !== null && preview.usersToClean.length > 0 && confirmPhrase === CONFIRM_PHRASE

  return (
    <PageContainer>
      <header className="flex items-center gap-2">
        <Trash2 size={22} className="text-accent-gold" />
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Test Data Cleanup</h1>
          <p className="mt-1 text-sm text-text-muted">Preview, then permanently empty, all non-admin test/dummy application data.</p>
        </div>
      </header>

      <Card className="mt-6 border-accent-gold/30 bg-accent-gold-soft/40">
        <div className="flex items-start gap-2">
          <ShieldCheck size={16} className="mt-0.5 flex-none text-accent-gold" />
          <div className="text-xs text-text-primary">
            <p className="font-medium">Always excluded, no matter what:</p>
            <p className="mt-1 text-text-muted">
              Every admin account (<code className="text-[11px]">isAdmin === true</code>), and{' '}
              <code className="text-[11px]">systemSettings/tradeOutcomeControl</code>,{' '}
              <code className="text-[11px]">adminActions</code>, and{' '}
              <code className="text-[11px]">deletionAudit</code> — this tool never reads or writes any of those. Real
              Firebase Authentication credentials are never deleted (this project's Spark plan has no backend able to
              do that) — a cleaned account's own access stays permanently disabled at the application layer instead
              (the same mechanism the single-user "Remove User" tool already uses), exactly like before.
            </p>
          </div>
        </div>
      </Card>

      <div className="mt-4">
        <Button type="button" onClick={handleRunDryRun} disabled={dryRunLoading || executing} className="flex items-center gap-2">
          <PlayCircle size={16} /> {dryRunLoading ? 'Running dry run…' : 'Run Dry Run'}
        </Button>
      </div>

      {dryRunError && (
        <Card className="mt-4 border-danger/40">
          <p className="text-sm text-danger">{dryRunError}</p>
        </Card>
      )}

      {preview && (
        <>
          <section className="mt-8">
            <h2 className="text-lg font-semibold text-text-primary">
              {executionReport ? 'Remaining after cleanup' : 'Would be affected'}
            </h2>
            <p className="mt-1 text-xs text-text-muted">
              Computed {preview.generatedAt.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {TOTAL_LABELS.map(({ key, label }) => (
                <StatTile key={key} label={label} value={preview.totals[key]} />
              ))}
            </div>
            {!preview.supabaseConfigured && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-danger">
                <AlertTriangle size={12} className="flex-none" /> Supabase isn't configured in this environment — the
                two Supabase file counts above are 0 because no KYC/support file paths could be resolved, not because
                no files exist. Recheck once VITE_SUPABASE_* is set.
              </p>
            )}
          </section>

          <section className="mt-8">
            <h2 className="text-lg font-semibold text-text-primary">
              Preserved — {preview.preservedAdmins.length} admin account
              {preview.preservedAdmins.length === 1 ? '' : 's'}, never touched
            </h2>
            {preview.preservedAdmins.length === 0 ? (
              <Card className="mt-3 py-6 text-center text-sm text-text-muted">No other admin accounts found.</Card>
            ) : (
              <Card className="mt-3 overflow-x-auto p-0">
                <table className="w-full min-w-[480px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
                      <th className="px-4 py-3 font-medium">Name</th>
                      <th className="px-4 py-3 font-medium">Email</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.preservedAdmins.map((admin) => (
                      <tr key={admin.uid} className="border-b border-border last:border-0">
                        <td className="px-4 py-3 text-text-primary">{admin.displayName}</td>
                        <td className="px-4 py-3 text-text-muted">{admin.email}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
            <p className="mt-2 text-xs text-text-muted">
              Also always preserved, unconditionally: {preview.preservedSystemPaths.join('; ')}.
            </p>
          </section>

          <section className="mt-8">
            <h2 className="text-lg font-semibold text-text-primary">Non-admin users — {preview.usersToClean.length}</h2>
            {preview.usersToClean.length === 0 ? (
              <Card className="mt-3 py-8 text-center text-sm text-text-muted">
                No non-admin users found — nothing for a cleanup run to affect.
              </Card>
            ) : (
              <Card className="mt-3 overflow-x-auto p-0">
                <table className="w-full min-w-[900px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
                      <th className="px-4 py-3 font-medium">User</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium text-right">Trades</th>
                      <th className="px-4 py-3 font-medium text-right">Snapshots</th>
                      <th className="px-4 py-3 font-medium text-right">Timed</th>
                      <th className="px-4 py-3 font-medium text-right">Support msgs</th>
                      <th className="px-4 py-3 font-medium text-right">KYC</th>
                      <th className="px-4 py-3 font-medium text-right">Requests</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.usersToClean.map((user) => (
                      <tr key={user.uid} className="border-b border-border last:border-0">
                        <td className="px-4 py-3">
                          <p className="font-medium text-text-primary">{user.displayName}</p>
                          <p className="text-xs text-text-muted">{user.email}</p>
                        </td>
                        <td className="px-4 py-3">
                          {user.alreadyDeactivated ? (
                            <Badge tone="neutral">Already deactivated</Badge>
                          ) : (
                            <Badge tone="gold">Active</Badge>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-text-primary">{user.transactionCount}</td>
                        <td className="px-4 py-3 text-right font-mono text-text-primary">{user.portfolioSnapshotCount}</td>
                        <td className="px-4 py-3 text-right font-mono text-text-primary">{user.timedTradeCount}</td>
                        <td className="px-4 py-3 text-right font-mono text-text-primary">{user.supportMessageCount}</td>
                        <td className="px-4 py-3 text-right font-mono text-text-primary">{user.kycSubmissionCount}</td>
                        <td className="px-4 py-3 text-right font-mono text-text-primary">{user.balanceRequestCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </section>

          {/* Execute — deliberately separate from, and below, every dry-run
              result above, gated on having already seen those numbers. */}
          {preview.usersToClean.length > 0 && !executionReport && (
            <section className="mt-10">
              <Card className="border-danger/40">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={16} className="text-danger" />
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-danger">Execute Cleanup</h2>
                </div>
                <p className="mt-2 text-xs text-text-muted">
                  Permanently disables access and purges all Firestore/Supabase application data for all{' '}
                  {preview.usersToClean.length} non-admin user{preview.usersToClean.length === 1 ? '' : 's'} listed
                  above. This cannot be undone. Firebase Authentication credentials themselves are not and cannot be
                  deleted (Spark plan) — those accounts simply can never access the app again.
                </p>

                <div className="mt-4 max-w-sm">
                  <TextField
                    label={`Type "${CONFIRM_PHRASE}" to enable execution`}
                    name="confirmPhrase"
                    value={confirmPhrase}
                    onChange={(event) => setConfirmPhrase(event.target.value)}
                    placeholder={CONFIRM_PHRASE}
                    disabled={executing}
                  />
                </div>

                {executionError && <p className="mt-3 text-xs text-danger">{executionError}</p>}

                {progress && (
                  <div className="mt-4">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-alt">
                      <div
                        className="h-full bg-accent-gold transition-all"
                        style={{ width: `${progress.total === 0 ? 100 : Math.round((progress.done / progress.total) * 100)}%` }}
                      />
                    </div>
                    <p className="mt-1.5 text-xs text-text-muted">
                      Processing {progress.done} of {progress.total}
                      {progress.email ? ` — last: ${progress.email}` : ''}…
                    </p>
                  </div>
                )}

                <div className="mt-4">
                  <Button
                    type="button"
                    variant="danger"
                    onClick={() => setConfirmDialogOpen(true)}
                    disabled={!canExecute || executing}
                  >
                    {executing ? 'Running cleanup…' : 'Execute Cleanup'}
                  </Button>
                </div>
              </Card>
            </section>
          )}

          {executionReport && (
            <section className="mt-10">
              <Card className={executionReport.fullySucceeded ? 'border-success/40' : 'border-danger/40'}>
                <div className="flex items-center gap-2">
                  {executionReport.fullySucceeded ? (
                    <CheckCircle2 size={18} className="text-success" />
                  ) : (
                    <XCircle size={18} className="text-danger" />
                  )}
                  <h2 className="text-lg font-semibold text-text-primary">
                    {executionReport.fullySucceeded ? 'Cleanup complete' : 'Cleanup finished with problems'}
                  </h2>
                </div>
                <p className="mt-1 text-xs text-text-muted">
                  Started {executionReport.startedAt.toLocaleTimeString('en-US')}, finished{' '}
                  {executionReport.finishedAt.toLocaleTimeString('en-US')}.
                </p>

                <div className="mt-4 grid grid-cols-3 gap-3 sm:max-w-md">
                  <StatTile label="Deleted" value={executionReport.deletedUserCount} />
                  <StatTile label="Skipped (already clean)" value={executionReport.skippedUserCount} />
                  <StatTile label="Failed" value={executionReport.failedUserCount} />
                </div>

                {!executionReport.fullySucceeded && (
                  <p className="mt-3 flex items-start gap-1.5 text-xs text-danger">
                    <AlertTriangle size={12} className="mt-0.5 flex-none" />
                    {executionReport.failedUserCount > 0
                      ? 'Not every user was fully cleaned — see the failures below. It is safe to run Execute again: already-cleaned users and records are skipped automatically.'
                      : 'Every targeted user reported success, but the post-cleanup verification scan below still found remaining data. Review it and re-run if needed.'}
                  </p>
                )}

                {executionReport.userResults.some((r) => r.outcome === 'failed') && (
                  <div className="mt-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Failed users</p>
                    <ul className="mt-2 space-y-1.5">
                      {executionReport.userResults
                        .filter((r) => r.outcome === 'failed')
                        .map((r) => (
                          <li key={r.uid} className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs">
                            <span className="font-medium text-text-primary">{r.email}</span>{' '}
                            <span className="text-text-muted">({r.uid})</span>
                            <p className="mt-0.5 text-danger">{r.error}</p>
                          </li>
                        ))}
                    </ul>
                  </div>
                )}

                <div className="mt-5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                    Verification scan — actually removed this run
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                    {TOTAL_LABELS.map(({ key, label }) => (
                      <StatTile key={key} label={label} value={Math.max(0, executionReport.deltas[key])} />
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-text-muted">
                    Remaining non-admin data after this run is shown in the "Remaining after cleanup" section above —
                    it should read all zeros (aside from Supabase counts if not configured in this environment).
                  </p>
                </div>
              </Card>
            </section>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmDialogOpen}
        onClose={() => setConfirmDialogOpen(false)}
        title="Permanently empty all test data?"
        description={
          preview
            ? `This will disable access and permanently purge Firestore/Supabase application data for all ${preview.usersToClean.length} non-admin user(s) listed above — ${preview.totals.transactionCount} trades, ${preview.totals.timedTradeCount} timed trades, ${preview.totals.kycSubmissionCount} KYC submissions, ${preview.totals.balanceRequestCount} deposit/withdrawal requests, ${preview.totals.supportMessageCount} support messages, and their uploaded files. Admin accounts and system documents are never touched. This cannot be undone.`
            : ''
        }
        confirmLabel="Execute Cleanup"
        loadingLabel="Starting…"
        variant="danger"
        onConfirm={() => {
          // Deliberately NOT awaited here: ConfirmDialog awaits whatever
          // this returns before closing itself, and it's a full-page modal
          // overlay — if the real (potentially long-running) cleanup ran
          // inside that await, the live progress bar below would be hidden
          // behind the dialog for the entire run. Firing it instead and
          // returning immediately lets the dialog close right away, so the
          // progress bar rendered on the page itself is what's visible
          // while handleExecute actually runs.
          void handleExecute()
        }}
      />
    </PageContainer>
  )
}
