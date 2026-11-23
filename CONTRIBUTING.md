# Contributing to Headroom

Thanks for helping. This page covers how to get set up, how the code is laid out, what a good change looks like, and how to send it.

## Ways to help

- **Add an agent.** The most useful contribution. See [docs/adding-an-agent.md](docs/adding-an-agent.md).
- **Fix a reader.** Agents change their file formats. If a number looks wrong, open an issue with a sample of the log lines involved (remove prompts and anything private).
- **Test on Windows or Linux.** Tray behaviour differs a lot between desktops. Reports of what works and what doesn't are valuable.
- **Report bugs and suggest improvements** through the issue templates.

## Set up

You need Node 22 or newer.

```bash
npm install
npm start          # run the app
npm test           # unit tests
npm run check      # syntax check
```

Useful while developing:

| Variable | Effect |
| --- | --- |
| `HEADROOM_DEMO=1` | Opens the popover with sample data, no real agents needed. `HEADROOM_DEMO=view=onboarding` shows the first-run screen, `view=settings` the settings, `open=codex` an expanded row. |
| `HEADROOM_THEME=light` or `dark` | Forces a theme. |
| `HEADROOM_SHOT_H=594` | With `--smoke=out.png`, captures at a fixed height so a row of README screenshots lines up. |
| `HEADROOM_USER_DATA=/some/dir` | Uses a separate settings folder, so you can replay the first-run screen. |

## How the code is laid out

```
src/
  main/               Electron main process
    main.js           tray, window, settings, refresh loop
    trayIcon.js       draws the tray icon (pure pixel code)
    preload.js        the only bridge between the two processes
    providers/        one module per agent, plus shared file helpers
      index.js        the agent list and the headline rule
  renderer/           the popover: plain HTML, CSS and JS, no build step
    icons/            agent marks
  shared/format.js    durations, numbers and the pace sentence
test/                 unit tests (node:test)
docs/                 guides and screenshots
```

There is no bundler, framework or transpiler. Please keep it that way unless there is a strong reason; it is why the project is easy to read and quick to start.

## Principles

These decide most design questions. Please read them before changing behaviour or UI.

1. **One glance.** The bar shows one number. The dropdown answers "how much is left and when does it reset" without scrolling or clicking.
2. **Do not bother people.** No pop-ups, no badges, no sounds. One silent notification at 90% is the entire budget. New features must not add interruptions by default.
3. **Say what is true.** If an agent publishes no limit, show counts and say so. Never invent a percentage. Estimates are labelled as estimates.
4. **Local first.** Read files the agent already wrote. Anything that touches the network or a credential must be opt-in, explained in plain words in the UI, and documented in the README's Privacy section.
5. **Never write to an agent's files.** Readers are read-only. Do not refresh tokens, edit configs or install hooks.
6. **Same on every platform.** If something cannot work on one OS, degrade clearly rather than hide it.

## Writing a change

- **Keep it small.** One purpose per pull request.
- **Add or update tests** for anything in `providers/`, `shared/` or `trayIcon.js`. Tests build fixture files in a temporary home folder; see `test/helpers.js` and any existing test for the pattern. Tests must not read the real home folder or use the network.
- **UI changes** need a screenshot in light and dark. `npm start -- --smoke=out.png` renders the popover once, saves it and exits. `HEADROOM_DEMO=1 npm start` gives you stable sample data; extend `src/renderer/demo.js` if your change needs a new state.
- **Match the surrounding style**: two-space indent, single quotes, semicolons. Comments explain why, not what.
- **No new dependencies** without discussing it in an issue first. The app currently ships with none at runtime.
- **Fixtures must be synthetic.** Never commit real session logs, tokens, account IDs or prompts.

## Commits and pull requests

- Write commit subjects in the imperative, under about 70 characters: `Read weekly limit from Codex secondary window`.
- Explain the why in the body when it is not obvious.
- Open the pull request against `main` and fill in the template. CI runs the tests on macOS, Windows and Linux; all three must pass.
- A maintainer will review. Expect questions about the principles above.

By contributing you agree that your work is released under the project's [MIT license](LICENSE).

## Reporting security issues

Please do not open a public issue for anything involving credentials or private data. See [SECURITY.md](SECURITY.md).

## How changes reach `main`

Nobody pushes to `main` directly, maintainers included. Every change goes through a pull request:

1. Open a pull request from a branch or a fork.
2. CI runs `npm run check` and `npm test` on macOS, Windows and Linux. All three must pass.
3. A code owner (see `.github/CODEOWNERS`) is asked to review automatically. One approval is required, a new push dismisses earlier approvals, and review threads must be resolved.
4. A maintainer merges. Force-pushing to `main` and deleting it are blocked.

Repository admins may merge their own pull request without a second approval, because a project with one maintainer would otherwise be stuck. They still cannot push to `main` without a pull request.

The rules live in `.github/rulesets/main.json`. To apply or update them (admins only):

```bash
gh api repos/ishmalazmi/headroom/rulesets --method POST --input .github/rulesets/main.json
```

GitHub only enforces rulesets on public repositories, or private ones on a paid plan.

## Releasing (maintainers)

1. Update `version` in `package.json` and add a section to `CHANGELOG.md`.
2. Commit, then tag: `git tag v0.2.0 && git push --tags`.
3. The release workflow builds installers on all three platforms and attaches them to a draft GitHub release. Review the draft and publish it.
