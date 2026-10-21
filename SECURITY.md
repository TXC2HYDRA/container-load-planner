# Security

`container-load-planner` is a pure calculation library. It has no runtime dependencies, makes no network
requests, and reads or writes no files. Its only development dependency is `typescript`. `npm audit`
reported 0 vulnerabilities when this file was written (2026-10-21).

The main risk is a wrong number, not a breach: results are planning estimates and are not a loading
instruction or a safety check (see Limitations in the README).

No private reporting channel is set up for this repository. Please report a suspected vulnerability by
opening a GitHub issue, and keep exploit details out of the issue text. Say that you have more to share
and a private channel will be arranged.

Only the latest commit on `main` is maintained.
