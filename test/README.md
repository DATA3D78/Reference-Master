# V2 verification

`node --test --test-concurrency=1 test/*.test.mjs` runs fal generation and schema tests, legacy Comfy recovery checks, and the local studio/OpenRouter/SHOOT regressions. All provider calls are simulated; tests do not spend credits.

`fixtures/fal-schemas.json` contains all 40 official fal schemas verified October 21, 2026. The tests cover each offered image/video input, ratio, resolution and duration, audio/tool requests, credential isolation, saved keys, queue recovery, downloads, billing reconciliation and exact SHOOT prompt submission.

`comfy-schemas` and files ending in `.comfy-reference.mjs` retain the earlier Comfy catalog contract for historical reference. Old files ending in `.fal-reference.mjs` retain pre-V2 tests. Those archival files are not current test entry points. Active `comfy-models.test.mjs` and `resumable-update.test.mjs` check recovery of already accepted legacy requests.

Simulated tests and official schemas do not establish live account access or output quality. No paid generation is performed by the suite.
