# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-14

### Added

- One Gladys device per download client, SABnzbd or NZBGet (up to two): downloads paused (switch),
  speed limit in % of the line (slider), download speed, jobs in the queue, left to download, time
  left, free disk space, status, last download and errors of the last 24 hours. Feature names in
  French by default, or English, German and Spanish.
- Scene triggers "Download completed" and "Download failed", filtered by client and category, with
  the name, category, size or reason of the job. Jobs finished during a restart of the integration
  are announced once it is back.
- Scene actions "Pause downloads" (for a number of minutes or until resumed), "Resume downloads"
  and "Limit the download speed".
- The "Usenet downloads" dashboard widget: speed, queue, time left, one line per client, and Pause,
  Pause 30 min and Resume buttons.
- A "Test the connection" button, and the documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-usenet/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-usenet/releases/tag/v1.0.1
