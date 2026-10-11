export function LoginForm() {
  return (
    <main className="min-h-screen bg-surface-base text-ink-primary">
      <h1 className="text-ink-primary">Sign in</h1>
      <form method="post" action="/session/login">
        <label>
          Identifier
          <input type="text" name="identifier" autoComplete="username" required />
        </label>
        <label>
          Secret
          <input type="password" name="secret" autoComplete="current-password" required />
        </label>
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}
