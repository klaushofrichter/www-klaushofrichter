// Read on every call rather than once at startup, and shared by the OAuth
// callback (who may sign in) and currentUser (who may keep using a session):
// removing an address from ALLOWED_EMAILS then locks that account out on its
// next request instead of when its 7-day cookie expires.
export function getAllowedEmails(): string[] {
  return (process.env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim())
    .filter((email) => email.length > 0);
}
