# Contributing

```sh
pnpm install --frozen-lockfile
pnpm check    # format, types, skill validation and tests
```

## Changing a skill

- Read [authoring](docs/AUTHORING.md) for what makes a skill good; the validator cannot check that.
- Keep its markers in `evals/beats.json` and its routing prompts in `evals/triggers.json` current,
  and add it to `profiles.json` if it belongs to a profile.
- Try it for real: `./install.sh --local --project` in a throwaway project, then use it in an agent
  session against a real app. Say which agents you tried and what you did not check.
- For install script or manifest changes, run `pnpm smoke`. It needs npm registry access.

## Commits and versions

- Conventional commits.
- Bump `package.json` and `.claude-plugin/plugin.json` together for a release; the validator
  fails when they drift. New skills are minor, fixes are patch, renames or removals are major.
