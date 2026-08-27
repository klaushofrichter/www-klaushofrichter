// Baked in by the Docker build (ARG APP_VERSION) at deploy time, so the
// running container can say which build it is. "dev" for local builds and
// tests, which is what you want to see locally. Deliberately not read from
// package.json — that file carries no version at all (see CHANGELOG.md).
export function appVersion(): string {
  return process.env.APP_VERSION || 'dev';
}
