# Copenhagen

A contact centre sizing simulator for solution engineers. Enter the volumes you expect and the service levels you're selling, and it works out how many agents you need, builds the shift rota, and plays out a day on an isometric floor with a live wallboard.

It builds to a single self-contained HTML file (scripts, styles and the simulation worker all inlined). There's no server: everything runs in the browser, and the only external dependency is Google Fonts.

## What it models

- **Queues:** Erlang A (callers abandon when their patience runs out) or Erlang C, in 48 half-hour intervals.
- **Channels:** calls, chats (several at once per agent) and two deferred channels, emails and self-service tickets, worked from a backlog in agents' spare time.
- **Teams:** blended or dedicated, with up to three languages. English is the shared language; spare language agents can help with English.
- **Shifts:** full 9-hour shifts (4 on, 1-hour lunch, 4 on) starting on any half hour, including overnight; optional part-time shifts. A greedy optimiser places them against each day's forecast.
- **Headcount:** 5 days in 7, annual leave and sickness rolled at random, shrinkage on shift, and a minimum staffing rule (at least 2 on seat whenever open, at least 3 people per team).
- **Shared service:** other clients' contacts join the queues as "ghost" contacts, and the client's share of the pool is reported.
- **Risk:** 500 simulated months (or weeks) with forecast error and absence, used both to report the odds of hitting each SLA and to size the team to a contract-level aim such as "at most 1 missed month in an 84-month (5 + 1 + 1) contract".

## Using it

- **Demand & targets:** volumes, handle times, opening hours, intraday and day-of-week patterns, languages, service targets and the contract risk aim.
- **Desk set-up:** team model, headcount (or match the recommendation), contracts, shrinkage, part-time, shared service and minimum staffing.
- **Shift schedule:** the optimised rota per day and team, with a CSV export.
- **Share link:** the whole scenario is encoded into the page's URL fragment.

Settings and saved scenarios live in the browser's local storage.

## Development

```bash
npm install
npm run dev        # local dev server
npm test           # model unit and regression tests
npm run test:e2e   # browser tests (Playwright) against the production build
npm run check      # svelte-check
npm run build      # type-check, then build dist/index.html
npm run artifact   # also write dist/artifact.html, the fragment published as the claude.ai artifact
```

Every push to `main` runs the unit and browser tests and deploys the build to GitHub Pages (`.github/workflows/pages.yml`).

### Layout

- `src/model/`: the modelling, as typed, pure functions of a scenario (no DOM): Erlang A/C, demand and requirements, shift optimisation, day evaluation, sizing, Monte Carlo and the contract-confidence search.
- `src/worker.ts` and `src/ui/sim.ts`: the confidence search, the other-targets grid and the week/month simulations run in a Web Worker, falling back to the main thread if workers aren't available.
- `src/ui/engine.svelte.js`: the page's state with no markup: the scenario, the recalculation pipeline, the live day and clock, month to date and saved scenarios. Components re-render when its counters in `ui` move (`inputs`, `rev`, `live`, `sizing`, `mc`, `tick`, `scen`).
- `src/ui/floor.js`: the isometric floor, drawn on a canvas, with its agents, camera and click handling.
- `src/ui/charts.js`: pure SVG chart builders (data in, markup out).
- `src/ui/components/`: Svelte 5 components, one per part of the page (top bar, sizing strip, wallboard, floor, reports, drawers, shift schedule, splash), plus small `Num`, `Check` and `Sel` inputs that bind to a scenario setting by path.
- `tests/`: unit tests for the maths, regression tests that pin the model to numbers recorded from the original single-file build (`tests/fixtures/baseline.json`), and browser tests in `tests/e2e/`.

## Why Copenhagen?

In 1917, A.K. Erlang worked out the queueing maths this tool runs on while working for the Copenhagen Telephone Company, sizing its exchanges.
