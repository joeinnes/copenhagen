# Copenhagen

A contact centre sizing simulator for solution engineers. Enter the volumes you expect and the service levels you're selling, and it works out how many agents you need, builds the shift rota, and plays out a day on an isometric floor with a live wallboard.

It's a single self-contained page: open `index.html` in a browser. No build step, no server, no dependencies beyond Google Fonts.

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

## Why Copenhagen?

In 1917, A.K. Erlang worked out the queueing maths this tool runs on while working for the Copenhagen Telephone Company, sizing its exchanges.
