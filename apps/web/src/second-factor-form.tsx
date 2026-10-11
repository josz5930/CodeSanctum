export function SecondFactorForm({ rejected = false }: { rejected?: boolean }) {
  return (
    <main className="min-h-screen bg-surface-base text-ink-primary">
      <h1 className="text-ink-primary">Enter your authenticator code</h1>
      {rejected ? (
        <p role="alert">
          The code was not accepted. Wait for the next code and try again, or <a href="/login">sign in again</a>.
        </p>
      ) : null}
      <form method="post" action="/session/second-factor">
        <label>
          Code
          <input
            type="text"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]{6,7}"
            maxLength={7}
            required
          />
        </label>
        <button type="submit">Verify</button>
      </form>
    </main>
  );
}
