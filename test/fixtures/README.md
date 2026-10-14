# Test fixtures

- `gladys-feature-table.json`: the category/type couples, units and poll frequencies of the
  Gladys core (`test/gladys-rules.test.js`).
- `sabnzbd/4.2.2`, `sabnzbd/5.1.3`: real answers of SABnzbd 4.2.2 (Ubuntu 24.04 package) and
  5.1.3 (official source release), recorded on 14/10/2026 while they downloaded generated jobs
  from `test/real/nntp.js`: idle, downloading, paused, paused for 30 minutes, limited to 1 MB/s
  (no maximum line speed) and to 25 % (maximum 8 MB/s), history with completed and failed jobs,
  unchanged history, warnings (including those a wrong API key adds), the 403 answers, and the
  `/sabnzbd/api` path (still served by 4.2.2, a 404 page on 5.1.3).
- `nzbget/21.0`, `nzbget/26.3`: real answers of NZBGet 21.0 (Ubuntu 24.04 package) and 26.3
  (official Linux binary), same scenario: `status`, `listgroups`, `history`, `log`, the error of a
  command sent as GET, an unknown method, a wrong password (401, on 21.0: 26.3 trusts
  127.0.0.1). NZBGet 21.0 could not read the free disk space in the sandbox (0xFFFFFFFF in both
  halves).
- `sabnzbd/home-assistant-queue.json`: the queue fixture of the Home Assistant `sabnzbd` tests
  (SABnzbd 4.3.3, Apache-2.0).

Anonymised: API keys and passwords replaced by `0123456789abcdef…` (cut to their length),
local paths replaced by `/downloads`. The job names are invented.
