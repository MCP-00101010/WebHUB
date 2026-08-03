# Repository Instructions

## Release and Commit Checklist

Before committing product changes:

1. Bump the Hub patch version in `source/app.js` and both displayed version fallbacks in `index.html`.
2. When extension code changes, also bump the version in `extension/manifest.json`.
3. Add a dated entry at the top of `CHANGELOG.md` describing the user-visible changes and relevant validation.
4. Update `TODO.md` only for work that was completed or whose monitoring/version reference changed.
5. Run the relevant JavaScript and native-host tests and check the extension manifest with `web-ext lint` when extension files changed.

Keep unrelated user changes out of scoped commits.
