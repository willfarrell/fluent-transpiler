# Contributing

In the spirit of Open Source Software, everyone is very welcome to contribute to this repository. Feel free to [raise issues](https://github.com/willfarrell/fluent-transpiler/issues) or to [submit Pull Requests](https://github.com/willfarrell/fluent-transpiler/pulls).

## Development Setup

```bash
git clone https://github.com/willfarrell/fluent-transpiler.git
cd fluent-transpiler
npm install
npm test
```

## Committing

Ensure git commits meet the following FLOSS Best Practices:

- Message follows [Conventional Commits](https://www.conventionalcommits.org/) pattern. This is automatically enforced using `@commitlint/cli`.
- Message includes sign off for [Developer Certificate of Origin (DCO)](https://developercertificate.org/) compliance. This is automatically enforced using GitHub Actions on Pull-Requests.
  1. `git config --global user.name "Your Name"` and `git config --global user.email username@example.org` setup with `--signoff` flag on `git commit`
  2. Or, `Signed-off-by: username <email address>` as the last line of a commit, when a change is made through GitHub
- Commit is cryptographically signed and can be verified. This is automatically enforced by GitHub security configuration. [GitHub Docs: About commit signature verification](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification)

## Code Style

Code is formatted and linted using [Biome](https://biomejs.dev).

## Licence

Licensed under [MIT Licence](LICENSE).
