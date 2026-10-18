import type { AuthSnapshot } from './authStore';

// An unavailable saved session needs recovery or local sign-out, not another
// password submission that would discard it before attempting a new login.
export function accountPresentation(snapshot: AuthSnapshot) {
  const mutating = ['restoring', 'signingIn', 'signingOut'].includes(snapshot.status);
  const signedIn = snapshot.status === 'authenticated' && snapshot.viewer !== null;
  const saved = snapshot.status === 'unavailable' || (snapshot.status === 'anonymous' && snapshot.hasSavedSession);
  const mode = signedIn ? 'signedIn' : saved ? 'savedSession' : 'signIn';
  return {
    mode,
    busy: mutating || snapshot.validating,
    canSignOut: !mutating && (signedIn || saved),
    canRetrySaved: saved && !mutating && !snapshot.validating,
  };
}
