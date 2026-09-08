// Maps Firebase Auth error codes to plain-language messages for SMART TRADE PRO.
// Never surface raw Firebase error text (e.g. "Firebase: Error (auth/...)") to users.

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  'auth/email-already-in-use': 'An account with this email already exists — try logging in instead.',
  'auth/invalid-email': "That email address doesn't look right.",
  'auth/weak-password': 'Password is too weak — use at least 6 characters.',
  'auth/missing-password': 'Please enter a password.',
  'auth/user-not-found': 'No account found with that email.',
  'auth/wrong-password': 'Incorrect password — please try again.',
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/user-disabled': 'This account has been disabled.',
  'auth/too-many-requests': 'Too many attempts — please wait a moment and try again.',
  'auth/network-request-failed': 'Network error — check your connection and try again.',
  'auth/operation-not-allowed':
    'Email/password sign-in is not enabled for this project yet — enable it in the Firebase console.',
}

/** Turns a thrown Firebase Auth error into a plain-language message safe to show a user. */
export function getAuthErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code: unknown }).code
    if (typeof code === 'string' && AUTH_ERROR_MESSAGES[code]) {
      return AUTH_ERROR_MESSAGES[code]
    }
  }
  return 'Something went wrong. Please try again.'
}
