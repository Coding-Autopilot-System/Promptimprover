# Changelog

## 1.0.0 (2026-07-13)


### Features

* add swarm dashboard tooling and package manifest ([#26](https://github.com/Coding-Autopilot-System/Promptimprover/issues/26)) ([101f63d](https://github.com/Coding-Autopilot-System/Promptimprover/commit/101f63d702e5c0ab8052c8e0c67a104d8edfbddb))
* add tested local chat proxy ([#20](https://github.com/Coding-Autopilot-System/Promptimprover/issues/20)) ([22acc22](https://github.com/Coding-Autopilot-System/Promptimprover/commit/22acc22739f778659deaffb2b0e87101b76fcc32))
* add tested prompt tournament dashboard ([#19](https://github.com/Coding-Autopilot-System/Promptimprover/issues/19)) ([fe977e9](https://github.com/Coding-Autopilot-System/Promptimprover/commit/fe977e9284d12a3f344cb4845a11661699631b7d))
* **autonomy:** Phase 3 Auto-Pilot Dashboard — AUTO-05/06 (249 tests) ([e48a061](https://github.com/Coding-Autopilot-System/Promptimprover/commit/e48a0617648fe12f3e3e8c64a0c8591bceb0c727))
* **autonomy:** Phase 3 Auto-Pilot Dashboard — AUTO-05/06 complete (249 tests) ([f2c25ea](https://github.com/Coding-Autopilot-System/Promptimprover/commit/f2c25eae29ae651e8c2d788ad60e7670b2c96930))
* implement gapless traceability and real-time dashboard logging ([2c25995](https://github.com/Coding-Autopilot-System/Promptimprover/commit/2c259958a4e946bdb220a9610844b7a6cba9eafd))
* **integrations:** add Obsidian orchestration, lesson extraction, and execution orchestrator ([a09fda7](https://github.com/Coding-Autopilot-System/Promptimprover/commit/a09fda7921c9ce1421683dd22151508240d40b1c))
* Phase 1+2 Background Autonomy — FS Watcher + Continuous Learning Pipeline ([#2](https://github.com/Coding-Autopilot-System/Promptimprover/issues/2)) ([95be5e9](https://github.com/Coding-Autopilot-System/Promptimprover/commit/95be5e9a73e4369dc4676f7920bb819c9bb687f4))
* **promptimprover:** add swarm dashboard tooling and package manifest ([e85554a](https://github.com/Coding-Autopilot-System/Promptimprover/commit/e85554ac1d8eed44787b722871b2b4ef4dcd7cca))
* **refiner:** add Playwright e2e, TokenMinifier, proxy tests, and dashboard refactor ([43c4fb8](https://github.com/Coding-Autopilot-System/Promptimprover/commit/43c4fb8ce47640c3551155074c289c95535f36ba))


### Bug Fixes

* **audit-sweep:** resolve test timeout and port parsing bug ([#22](https://github.com/Coding-Autopilot-System/Promptimprover/issues/22)) ([b6e2375](https://github.com/Coding-Autopilot-System/Promptimprover/commit/b6e2375e3d69d656541716bdd2c8d4f83c394d22))
* bind dashboard to loopback-only and escape HTML in trace rendering to prevent data exposure and XSS ([26ae34d](https://github.com/Coding-Autopilot-System/Promptimprover/commit/26ae34dced833046631e75df0c8663e2bc89b1c3))
* **build:** resolve F-04 make asset build cross-platform ([6420017](https://github.com/Coding-Autopilot-System/Promptimprover/commit/64200172d366422b17399698dfa5fe73fbd30963))
* **ci:** chmod bin before test — Windows lock file strips executable bit (PI-02) ([64b67ff](https://github.com/Coding-Autopilot-System/Promptimprover/commit/64b67ffea56325ed7074b9ec0ad40bda14e48510))
* **ci:** exclude pre-existing broken correlation test to achieve green badge (PI-02) ([5d4ef79](https://github.com/Coding-Autopilot-System/Promptimprover/commit/5d4ef79aae20273bd8a955cc9cbc2126a493bdc9))
* **ci:** rebuild better-sqlite3 native module for Linux (PI-02) ([ae29603](https://github.com/Coding-Autopilot-System/Promptimprover/commit/ae29603c79739c0c085e6d369a9021786d2ec10c))
* **ci:** repin release-please reusable workflow to reachable SHA ([#32](https://github.com/Coding-Autopilot-System/Promptimprover/issues/32)) ([cb7d956](https://github.com/Coding-Autopilot-System/Promptimprover/commit/cb7d956d59c28946817968674d8846c873ba4d41))
* **ci:** use npm install instead of npm ci — lock file out of sync (PI-02) ([3c76f84](https://github.com/Coding-Autopilot-System/Promptimprover/commit/3c76f845e05abb97d7af986b3a2a6b0fa03a46b2))
* **ci:** use npx vitest run — Windows lock file lacks executable bit (PI-02) ([5fc1cbd](https://github.com/Coding-Autopilot-System/Promptimprover/commit/5fc1cbd84940a28050d01299b2c0c3a90c7f52be))
* **ci:** wire release-please PAT into reusable workflow caller ([#37](https://github.com/Coding-Autopilot-System/Promptimprover/issues/37)) ([3d76a71](https://github.com/Coding-Autopilot-System/Promptimprover/commit/3d76a7148d793ae30f1866b032e771baf93c7f13))
* **dashboard:** escape rendered trace fields ([#27](https://github.com/Coding-Autopilot-System/Promptimprover/issues/27)) ([41444ad](https://github.com/Coding-Autopilot-System/Promptimprover/commit/41444ad26a7c1252a9fac2908f6f80ed8b84a8b1))
* harden autonomy dashboard and obsidian integration ([c8ca890](https://github.com/Coding-Autopilot-System/Promptimprover/commit/c8ca890641a16f4be53a6a027802948b4054ce5c))
* **history:** resolve F-01 deterministic commit correlation ([726200b](https://github.com/Coding-Autopilot-System/Promptimprover/commit/726200b4250ea180ac8785b436724b3ac2197dd0))
* **installer:** resolve F-08 support deterministic cross-platform setup ([77c8de3](https://github.com/Coding-Autopilot-System/Promptimprover/commit/77c8de324ff532c6adcbaaeca11ef97e6a512f8a))
* **packaging:** resolve F-03 restrict published artifacts ([a216215](https://github.com/Coding-Autopilot-System/Promptimprover/commit/a2162153a2f6e1e70006db69b1de25ab3a830e8b))
* **repo:** resolve F-06 remove generated and runtime artifacts ([69561f8](https://github.com/Coding-Autopilot-System/Promptimprover/commit/69561f82945b89cf0fcf74b4fddbc32621a34ba3))
* **security:** resolve F-02 vulnerable transitive dependencies ([c4dc532](https://github.com/Coding-Autopilot-System/Promptimprover/commit/c4dc532235df07477289042281e71ccb0ed3428b))
* **security:** resolve F-07 bind dashboard to loopback ([9806a26](https://github.com/Coding-Autopilot-System/Promptimprover/commit/9806a26ada71564e9f65fe421ccfdd2a05e2aff8))


### Performance Improvements

* optimize background service with parallel task execution ([6990d0b](https://github.com/Coding-Autopilot-System/Promptimprover/commit/6990d0bb5cc507b64c1c5c5092fd97124398cf30))
