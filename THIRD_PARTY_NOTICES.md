# Third-Party Notices

LiteTuber is MIT-licensed (see `LICENSE`). It depends on the following packages;
their licenses apply to the bundled code.

| Package | Version | License | Copyright |
|---|---|---|---|
| `three` | 0.187.0 | MIT | three.js authors |
| `@pixiv/three-vrm` | 3.5.5 | MIT | pixiv Inc. and contributors |
| `@mediapipe/tasks-vision` | 0.10.22-rc.20250304 | Apache-2.0 | Google LLC |
| `vite` (build tool only) | 8.3.5 | MIT | VoidZero Inc. and Vite contributors |
| `vitest` (test tool only) | 5.1.0 | MIT | Vitest contributors |

## Runtime assets

- **MediaPipe WASM** (`public/wasm/`) — part of `@mediapipe/tasks-vision`, Apache-2.0.
- **Face landmarker model** (`public/models/face_landmarker.task`) — distributed by Google as part of the MediaPipe model collection; Apache-2.0.
- **VRM avatars** are not included in this repository. Users supply their own files, and each VRM's own license (commercial use, redistribution, modification) applies.

## Apache-2.0

`@mediapipe/tasks-vision` and its WASM/model assets are licensed under the
Apache License, Version 2.0: <https://www.apache.org/licenses/LICENSE-2.0>.

You may obtain a copy of the license at that URL. Apache-2.0 requires retaining
copyright and license notices, and stating significant modifications. This
project bundles the package unmodified as a dependency.

## MIT

The MIT-licensed packages above are distributed under the MIT License. Their
copyright notices are retained in `node_modules/` and in the respective package
metadata. The MIT permission notice text is reproduced in this project's
`LICENSE` file.
