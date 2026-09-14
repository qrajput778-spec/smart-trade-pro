// Deposit and withdrawal REQUEST workflow for SMART TRADE PRO.
//
// Every deposit/withdrawal here is a request document in the top-level
// `balanceRequests` collection — nothing here is a real payment, bank
// transfer, or card charge. Submitting a request never changes the user's
// own `balance` field by itself; only an admin's approval (the
// approve*Request functions below) ever does, enforced both here and by
// firestore.rules (a user can create a request only in a fresh 'pending'
// state with no reviewer fields set, and only an admin can ever move
// `status` off 'pending').
//
// Withdrawal "reserved balance" design: a pending withdrawal request does
// NOT deduct `balance` — it's deducted only when an admin actually approves
// it (see approveWithdrawalRequest). To stop a user from submitting several
// pending requests that collectively ask for more than they have, each
// submission reserves its amount against `users/{uid}.pendingWithdrawalTotal`
// — a running total of the user's own currently-pending withdrawal
// requests, maintained with the exact same increment()-inside-a-transaction
// pattern trading.ts already uses for totalRealizedPnl. New withdrawal
// requests are validated against (balance - pendingWithdrawalTotal), and the
// reservation is released (decremented back) the moment that same request
// is approved or rejected.

import {
  addDoc,
  collection,
  doc,
  increment,
  runTransaction,
  serverTimestamp,
  type Firestore,
  type Transaction,
} from 'firebase/firestore'
import { db } from './firebase'
import { roundUsd } from './trading'
import { formatUsd } from './constants'
import type { BalanceRequestType, DepositNetwork } from '../types'

/** Thrown for expected, user-facing balance-request problems — its message is safe to show directly. */
export class BalanceRequestError extends Error {}

function requireDb(): Firestore {
  if (!db) {
    throw new BalanceRequestError('Firebase is not configured yet — add your project keys to .env.')
  }
  return db
}

function validateAmount(amount: number): number {
  const rounded = roundUsd(amount)
  if (!Number.isFinite(rounded) || rounded <= 0) {
    throw new BalanceRequestError('Enter an amount greater than zero.')
  }
  return rounded
}

export interface ReviewResult {
  requestId: string
  amount: number
  targetUid: string
}

/**
 * Submits a deposit request. Does NOT touch balance — it stays 'pending'
 * until an admin approves it from /admin/deposits.
 */
export async function submitDepositRequest(
  uid: string,
  email: string,
  amount: number,
  depositNetwork: DepositNetwork,
  depositAddress: string,
): Promise<void> {
  const firestore = requireDb()
  const rounded = validateAmount(amount)

  await addDoc(collection(firestore, 'balanceRequests'), {
    userId: uid,
    userEmail: email,
    type: 'deposit' as BalanceRequestType,
    amount: rounded,
    status: 'pending',
    createdAt: serverTimestamp(),
    reviewedAt: null,
    reviewedBy: null,
    adminNote: null,
    depositNetwork,
    depositAddress,
  })
}

/**
 * Submits a withdrawal request. Validates the amount against what's
 * actually still available (balance minus this user's own other pending
 * withdrawal requests), then reserves it by incrementing
 * pendingWithdrawalTotal in the same transaction as the request document
 * itself — so two near-simultaneous submissions can never both succeed if
 * their combined total would exceed the user's balance.
 *
 * `recipientAddress` is purely informational — a free-text destination the
 * user provides for the admin to see while reviewing (there's no real
 * payment rail behind it, nothing is ever sent there). It's stored as an
 * extra field on the request doc; firestore.rules' create rule doesn't
 * restrict the request's field set, so no rules change was needed to add it.
 */
export async function submitWithdrawalRequest(
  uid: string,
  email: string,
  amount: number,
  recipientAddress: string,
): Promise<void> {
  const firestore = requireDb()
  const rounded = validateAmount(amount)
  const trimmedRecipient = recipientAddress.trim()
  if (!trimmedRecipient) {
    throw new BalanceRequestError('Enter a recipient address or account reference.')
  }

  const userRef = doc(firestore, 'users', uid)

  await runTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(userRef)
    if (!snapshot.exists()) throw new BalanceRequestError('Account not found.')

    const data = snapshot.data()
    const balance = typeof data.balance === 'number' ? data.balance : 0
    const pendingWithdrawalTotal =
      typeof data.pendingWithdrawalTotal === 'number' ? data.pendingWithdrawalTotal : 0
    const available = roundUsd(balance - pendingWithdrawalTotal)

    if (rounded > available) {
      throw new BalanceRequestError(
        `You can request up to ${formatUsd(available)} — the rest is already reserved by your ` +
          'other pending withdrawal requests.',
      )
    }

    const requestRef = doc(collection(firestore, 'balanceRequests'))
    transaction.set(requestRef, {
      userId: uid,
      userEmail: email,
      type: 'withdrawal' as BalanceRequestType,
      amount: rounded,
      status: 'pending',
      createdAt: serverTimestamp(),
      reviewedAt: null,
      reviewedBy: null,
      adminNote: null,
      recipientAddress: trimmedRecipient,
    })

    transaction.update(userRef, { pendingWithdrawalTotal: increment(rounded) })
  })
}

interface PendingRequest {
  ref: ReturnType<typeof doc>
  amount: number
  targetUid: string
}

/** Reads a request inside an in-flight transaction and enforces it's still reviewable. */
async function loadPendingRequest(
  transaction: Transaction,
  firestore: Firestore,
  requestId: string,
  expectedType: BalanceRequestType,
): Promise<PendingRequest> {
  const ref = doc(firestore, 'balanceRequests', requestId)
  const snapshot = await transaction.get(ref)
  if (!snapshot.exists()) throw new BalanceRequestError('Request not found.')

  const data = snapshot.data()
  if (data.status !== 'pending') {
    throw new BalanceRequestError('This request has already been reviewed.')
  }
  if (data.type !== expectedType) {
    throw new BalanceRequestError(`This is not a ${expectedType} request.`)
  }

  return {
    ref,
    amount: typeof data.amount === 'number' ? data.amount : 0,
    targetUid: String(data.userId ?? ''),
  }
}

/** Records one auditable entry for a deposit/withdrawal decision in the existing adminActions log. */
function writeAuditRecord(
  transaction: Transaction,
  firestore: Firestore,
  entry: {
    action: 'deposit_approved' | 'deposit_rejected' | 'withdrawal_approved' | 'withdrawal_rejected'
    requestId: string
    type: BalanceRequestType
    amount: number
    targetUid: string
    adminUid: string
    reason: string | null
  },
): void {
  const actionRef = doc(collection(firestore, 'adminActions'))
  transaction.set(actionRef, { ...entry, timestamp: serverTimestamp() })
}

/**
 * Approves a pending deposit: credits the user's balance and marks the
 * request approved, atomically, plus an adminActions audit entry — all in
 * one transaction so none of it can happen only partway, and a duplicate
 * click/retry after a successful commit is rejected by the
 * status-must-still-be-pending check above.
 */
export async function approveDepositRequest(
  adminUid: string,
  requestId: string,
  note?: string,
): Promise<ReviewResult> {
  const firestore = requireDb()
  let amount = 0
  let targetUid = ''

  await runTransaction(firestore, async (transaction) => {
    const request = await loadPendingRequest(transaction, firestore, requestId, 'deposit')
    amount = request.amount
    targetUid = request.targetUid

    const userRef = doc(firestore, 'users', targetUid)
    const userSnapshot = await transaction.get(userRef)
    if (!userSnapshot.exists()) throw new BalanceRequestError('Target account not found.')

    const trimmedNote = note?.trim() || null

    transaction.update(userRef, { balance: increment(amount) })
    transaction.update(request.ref, {
      status: 'approved',
      reviewedAt: serverTimestamp(),
      reviewedBy: adminUid,
      adminNote: trimmedNote,
    })
    writeAuditRecord(transaction, firestore, {
      action: 'deposit_approved',
      requestId,
      type: 'deposit',
      amount,
      targetUid,
      adminUid,
      reason: trimmedNote,
    })
  })

  return { requestId, amount, targetUid }
}

/** Rejects a pending deposit. Balance is never touched — there was nothing to reserve. */
export async function rejectDepositRequest(
  adminUid: string,
  requestId: string,
  note?: string,
): Promise<ReviewResult> {
  const firestore = requireDb()
  let amount = 0
  let targetUid = ''

  await runTransaction(firestore, async (transaction) => {
    const request = await loadPendingRequest(transaction, firestore, requestId, 'deposit')
    amount = request.amount
    targetUid = request.targetUid
    const trimmedNote = note?.trim() || null

    transaction.update(request.ref, {
      status: 'rejected',
      reviewedAt: serverTimestamp(),
      reviewedBy: adminUid,
      adminNote: trimmedNote,
    })
    writeAuditRecord(transaction, firestore, {
      action: 'deposit_rejected',
      requestId,
      type: 'deposit',
      amount,
      targetUid,
      adminUid,
      reason: trimmedNote,
    })
  })

  return { requestId, amount, targetUid }
}

/**
 * Approves a pending withdrawal: re-reads the user's CURRENT balance inside
 * the transaction (not whatever the admin's screen last rendered), verifies
 * it's still sufficient, deducts it exactly once, releases this request's
 * reservation hold, and marks the request approved — all atomically, plus
 * an audit entry. If the balance has since become insufficient (e.g. the
 * user traded it away, or another withdrawal was approved first), nothing
 * is deducted and nothing is approved.
 */
export async function approveWithdrawalRequest(
  adminUid: string,
  requestId: string,
  note?: string,
): Promise<ReviewResult> {
  const firestore = requireDb()
  let amount = 0
  let targetUid = ''

  await runTransaction(firestore, async (transaction) => {
    const request = await loadPendingRequest(transaction, firestore, requestId, 'withdrawal')
    amount = request.amount
    targetUid = request.targetUid

    const userRef = doc(firestore, 'users', targetUid)
    const userSnapshot = await transaction.get(userRef)
    if (!userSnapshot.exists()) throw new BalanceRequestError('Target account not found.')

    const userData = userSnapshot.data()
    const balance = typeof userData.balance === 'number' ? userData.balance : 0

    if (amount > balance) {
      throw new BalanceRequestError(
        `Cannot approve — this user's current balance (${formatUsd(balance)}) is less than the ` +
          `requested withdrawal (${formatUsd(amount)}). Reject it instead, or ask them to submit a ` +
          'smaller request.',
      )
    }

    const trimmedNote = note?.trim() || null

    transaction.update(userRef, {
      balance: increment(-amount),
      pendingWithdrawalTotal: increment(-amount),
    })
    transaction.update(request.ref, {
      status: 'approved',
      reviewedAt: serverTimestamp(),
      reviewedBy: adminUid,
      adminNote: trimmedNote,
    })
    writeAuditRecord(transaction, firestore, {
      action: 'withdrawal_approved',
      requestId,
      type: 'withdrawal',
      amount,
      targetUid,
      adminUid,
      reason: trimmedNote,
    })
  })

  return { requestId, amount, targetUid }
}

/**
 * Rejects a pending withdrawal. Balance itself was never touched at
 * submission time, so there's nothing to refund there — only this
 * request's reservation hold on pendingWithdrawalTotal is released.
 */
export async function rejectWithdrawalRequest(
  adminUid: string,
  requestId: string,
  note?: string,
): Promise<ReviewResult> {
  const firestore = requireDb()
  let amount = 0
  let targetUid = ''

  await runTransaction(firestore, async (transaction) => {
    const request = await loadPendingRequest(transaction, firestore, requestId, 'withdrawal')
    amount = request.amount
    targetUid = request.targetUid
    const trimmedNote = note?.trim() || null

    const userRef = doc(firestore, 'users', targetUid)
    transaction.update(userRef, { pendingWithdrawalTotal: increment(-amount) })
    transaction.update(request.ref, {
      status: 'rejected',
      reviewedAt: serverTimestamp(),
      reviewedBy: adminUid,
      adminNote: trimmedNote,
    })
    writeAuditRecord(transaction, firestore, {
      action: 'withdrawal_rejected',
      requestId,
      type: 'withdrawal',
      amount,
      targetUid,
      adminUid,
      reason: trimmedNote,
    })
  })

  return { requestId, amount, targetUid }
}
