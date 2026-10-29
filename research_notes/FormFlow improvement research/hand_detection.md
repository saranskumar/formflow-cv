# Robust MediaPipe Hand Landmarker in Chrome: motion blur, backlight, low light

Context: FormFlow runs @mediapipe/tasks-vision HandLandmarker (WASM, Chrome/Edge, laptop webcam). It already has: canvas ctx.filter brightness/contrast, brightness cycling when no hand is found, lowered thresholds, 1280x720@30 with continuous exposure/WB/focus, a 3-hit/0.35 s-hold tracker, One-Euro filtering, a zoom-and-follow ROI in IMAGE mode, and a Pose forearm hint. The notes below cover what else could help. Research ran on 2026-10-29. Lines marked "Inference" are engineering judgement, not cited fact.

## Q1. Image preprocessing beyond brightness/contrast (CLAHE, gamma/tone mapping, sharpening, denoising)

### Takeaway
GPU preprocessing at 30 fps is feasible. Gamma or a local tone curve is cheap and safe in a WebGL2 fragment shader. CLAHE needs a histogram pass (fragment-shader scatter in WebGL2, or a compute shader in WebGPU). The evidence that generic enhancement helps pose networks is mixed. Brightness and rotation augmentation measurably raised MediaPipe Hands detection rates in one library study. But for body pose in extreme low light, off-the-shelf enhancers made results worse. So treat enhancement as a fallback that you A/B-test per frame, not as an always-on filter.

### Cited Findings
- MediaPipe's own hand model card lists low light and motion blur among the conditions that degrade performance. — [MediaPipe Hand Tracking (Lite/Full) model card, Oct 2021](https://dcmpx.remotevs.com/com/googleapis/storage/SL/mediapipe-assets/Model%20Card%20Hand%20Tracking%20%28Lite_Full%29%20with%20Fairness%20Oct%202021.pdf) (from the search snippet; the PDF itself was not opened)
- GRLib (Warchocki, Vlasenko, Eisma, Oct 2023) rotates and brightness-adjusts each frame, sending several augmented copies to MediaPipe Hands. The authors report this raises recognition rates over the no-augmentation baseline on the ASL, HaGRID and Kenyan datasets. They name lighting sensitivity and distance to the camera as the main constraints. — [arXiv 2310.14919](https://ar5iv.labs.arxiv.org/html/2310.14919)
- Wu and Senda (2021) report that MediaPipe Hands is less reliable against brightly coloured backgrounds, and that adjusting saturation and brightness improved recognition. They give no controlled numbers. — [arXiv 2108.10716](https://arxiv.org/abs/2108.10716v1)
- In ExLPose (CVPR 2023, extreme low-light body pose), running LLFlow or LIME enhancement before a pose network gave worse results than expected. The enhancers optimise perceptual quality, not the downstream task. Training on enhanced images, or on enhanced plus well-lit images, worked better. — [arXiv 2303.15410](https://arxiv.org/pdf/2303.15410)
- A 2025 paper argues that generic pixel-level enhancement favours perceptual quality over semantic fidelity. It proposes a task-driven, frequency-based plug-in enhancement module for pose networks. — [arXiv 2501.08038](https://arxiv.org/abs/2501.08038v1)
- XPose (WACV 2025) is described as the first RGB hand-pose method for extreme low light, with a 120k-image dataset. It relies on training-time guidance, not inference-time enhancement, so it is not a drop-in browser model. — [XPose, WACV 2025](https://openaccess.thecvf.com/content/WACV2025/html/Rosh_XPose_Towards_Extreme_Low_Light_Hand_Pose_Estimation_WACV_2025_paper.html)
- An egocentric-video guide says low light and blur cause landmark flicker, and suggests sharpening frames before MediaPipe. — [Labellerr blog](https://labellerr.com/blog/mediapipe-hand-tracking-egocentric-video/)
- GPU CLAHE reference design (YuAo/Accelerated-CLAHE, Metal): a fragment shader converts RGB to lightness, a histogram shader builds per-tile histograms, and the clip limit is scaled by tile area. The project says it achieves real-time performance. — [GitHub YuAo/Accelerated-CLAHE](https://www.github.com/YuAo/Accelerated-CLAHE)
- The standard CLAHE structure is: per-tile histograms, clip and redistribute, build a LUT per tile, then bilinearly interpolate between neighbouring tile LUTs to avoid seams. — [NVIDIA DALI CLAHE docs](https://docs.nvidia.com/deeplearning/dali/archives/dali_2_1_1/user-guide/dali_dynamic/operations/nvidia.dali.experimental.dynamic.clahe.html)
- A multi-pass ReShade CLAHE / "local contrast" pixel shader exists (HLSL). — [ReShade forum](https://reshade.me/forum/shader-presentation/6683-clahe-contrast-limited-adaptive-histogram-normalization)
- FPGA CLAHE reaches 640x480 at 354 fps, which shows the algorithm is cheap at webcam resolution. — [FPL 2016 slides](https://fpl2016.epfl.ch/slides/S6a_1.pdf)
- A secondary source says MediaPipe's web GPU delegate runs on WebGL2, not WebGPU. — [forasoft guide (unofficial)](https://www.forasoft.com/learn/ai-for-video-engineering/articles-ai/mediapipe-selfie-segmentation-webgpu-background-blur)

### Inferences
- **Order of payoff for FormFlow:**
  1. Adaptive gamma / tone curve on the luma channel, driven by a mean-luma or histogram measure. About 0.1–0.3 ms in a fragment shader.
  2. Backlight-aware local tone mapping: lift the shadows where the hand and body are, without blowing out the window. Use either a cheap "shadow lift" (`out = in + k*(1-in)*blurLow(in)`-style curve) or full CLAHE.
  3. Mild unsharp mask, radius 1–2 px, for slight blur.
  4. Skip heavy denoising and deblurring.
- **Why gamma beats brightness for backlight:** `ctx.filter = 'brightness()'` is a linear gain. It clips highlights and lifts sensor noise equally. Gamma (pow(x, 1/γ), γ 1.5–2.2 for dark hands) or a filmic/Reinhard-style curve on luma brightens the shadows more than the highlights. That suits a dark hand silhouetted against a window.
- **CLAHE cost on webcam frames:** the palm detector input is 192x192 and the landmark input is 224x224. CLAHE can run on a downscaled frame (for example 640x360) with 8x8 tiles and clip limit 2–3, so cost is small.
  - In WebGL2, histograms need either point-sprite scatter into a 256x(tiles) float texture with additive blending, or a CPU readback of a small luma image. A readback at 320x180 is about 57 KB, and the histogram in JS takes about 1 ms.
  - In WebGPU, a compute shader with workgroup atomics is the natural fit.
  - Expected cost is 0.5–2 ms per frame on an integrated GPU. This is an estimate, not measured.
- **CPU-only fallback:** OpenCV.js (Apache-2.0) has `cv.createCLAHE`. At 640x360 it is likely 3–8 ms in WASM, which is acceptable if run only when the quality monitor flags low contrast.
- **Canvas 2D filter limits:** `ctx.filter` already supports `brightness()`, `contrast()`, `saturate()` and `url(#svgfilter)`. An SVG `feComponentTransfer type="gamma"` can give gamma without WebGL, but Chrome runs SVG filters on canvas slowly in some cases. WebGL2 is the better path.
- **Feeding GPU output to MediaPipe:** to avoid readback, render into an OffscreenCanvas / WebGL canvas and pass that canvas (or an `ImageBitmap` / `VideoFrame` made from it) to `detectForVideo`. MediaPipe accepts HTMLCanvasElement, OffscreenCanvas, ImageBitmap, VideoFrame and ImageData inputs.
- **Use enhancement as a test-time augmentation:** FormFlow's brightness cycling already does this crudely. Upgrade it to "run palm detection on enhanced variant B only when variant A finds nothing". Cache which variant won, and keep using it until confidence drops. This matches the GRLib result that augmented copies raise detection rate.
- **Deblurring is not worth it at 30 fps:** real motion deblurring (Wiener, Richardson-Lucy, or learned) is too expensive and ill-posed. Prevent blur at capture instead (shorter exposure, more light) and track through it (Q4).
- **Denoising:** a 3x3 bilateral or temporal EMA denoise in low light may reduce false palm detections from noise. But temporal denoising smears a moving hand, which is worse for blur. Keep it spatial and light.

### Gaps
- I found no published study that measures CLAHE or gamma preprocessing specifically against MediaPipe palm detection or hand landmark accuracy. Any gain has to be measured on FormFlow's own recordings.
- I found no open-source WebGL or WebGPU CLAHE library ready for the browser. Implementation would be ported from the Metal or ReShade designs.
- I did not confirm officially whether the tasks-vision web GPU delegate uses WebGL2 or WebGPU in v1.1.x. The release notes mention WebGPU plumbing but no explicit switch for vision tasks.

## Q2. MediaStreamTrack image-capture constraints on Windows webcams in Chrome

### Takeaway
On Windows, Chrome implements nearly the whole Image Capture constraint set through IAMCameraControl / IAMVideoProcAmp and Media Foundation: exposureMode, exposureCompensation, exposureTime (since M76), brightness, contrast, saturation, sharpness, whiteBalanceMode, colorTemperature, focusMode, focusDistance, zoom and pan/tilt. What actually appears depends on the webcam driver, so always feature-detect with `track.getCapabilities()`. Backlight compensation is not part of the W3C set.

### Cited Findings
- Chrome's implementation-status table (W3C mediacapture-image, notes last updated Feb 2023) lists these Windows versions:

  | Constraint | Windows since |
  |---|---|
  | exposureMode | M60 |
  | exposureCompensation | M60 |
  | exposureTime | M76 |
  | brightness | M60 |
  | contrast | M60 |
  | saturation | M60 |
  | sharpness | M60 |
  | whiteBalanceMode | M60 |
  | colorTemperature | M60 |
  | focusMode | M76 |
  | focusDistance | M76 |
  | zoom | M60 |
  | pan / tilt | M87 |

  - Mac support mostly arrived in M111.
  - No flag is needed after M59.
  - The page does not cover torch or backlightCompensation.
  - Column parsing was partly inferred because the page extraction dropped blank cells.

  — [w3c/mediacapture-image implementation-status.md](https://github.com/w3c/mediacapture-image/blob/main/implementation-status.md)
- Chrome uses IAMCameraControl on Windows, V4L2 on Linux and IOUSBHost on macOS. Manual exposure depends on OS, browser, camera and driver. Chrome support was described as "pretty good" from M101. — [webrtcHacks (2022)](https://webrtchacks.com/?p=3807)
- A Chromium CL fixed Windows exposureTime: the code had queried exposure time but set exposure compensation. At the time it worked only with the DirectShow backend (`--disable-features=MediaFoundationVideoCapture`). This is historical; current behaviour should be verified. — [crrev.com/660888](https://crrev.com/660888)
- `getCapabilities()` contents depend on browser and hardware. The method is Baseline 2024. — [MDN getCapabilities](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/getCapabilities)
- Chrome 114+ (ChromeOS, macOS, Windows) exposes OS camera effects as track constraints, for example `backgroundBlur`. They are read via `getSettings()` and toggled via `applyConstraints()` when the capability array has both values. A `configurationchange` event fires when the user toggles them in the OS. — [Chrome blog: Blur camera background](https://developer.chrome.com/blog/background-blur)

### Inferences
- **Implementation recipe:**
  ```js
  const track = stream.getVideoTracks()[0];
  const caps = track.getCapabilities?.() ?? {};
  // e.g. caps.exposureMode = ['manual','continuous'], caps.exposureTime = {min,max,step}
  // (Windows units: Chrome maps the 100 µs units spec'd by W3C; verify per device),
  // caps.exposureCompensation = {min,max,step}, caps.brightness/contrast/sharpness = {min,max,step}
  await track.applyConstraints({ advanced: [{ exposureMode: 'continuous', exposureCompensation: caps.exposureCompensation?.max * 0.5 }] });
  ```
  Then read back with `track.getSettings()`, because Chrome may silently clamp values. Wrap each constraint in its own `advanced` entry, so that one unsupported key does not reject the whole set.
- **Backlight (window behind the user):** keep `exposureMode: 'continuous'` but raise `exposureCompensation` to +1 to +2 EV. Most UVC drivers meter the whole frame, so the window drives the exposure down. Positive compensation lifts the user at the cost of clipping the window, which is fine because the window carries no hand information.
  - If compensation is not exposed, switch to `exposureMode: 'manual'` and step `exposureTime` up until the mean luma of the person/hand ROI reaches about 0.4–0.5.
  - The UVC "Backlight Compensation" control (VideoProcAmp_BacklightCompensation) is not in the W3C set. Users can only toggle it in the Windows Camera app, the vendor app, or Windows Settings > Bluetooth & devices > Cameras (brightness/contrast; plus "Studio Effects" on Copilot+ PCs). Coach users to do this.
- **Motion blur:** blur comes from long exposure. UVC webcams in dim rooms often drop to 15 fps or below with 1/15–1/30 s exposure under continuous AE.
  - Requesting `frameRate: { min: 30 }` (or `ideal: 30` with a `min: 24`) forces AE to cap exposure near 33 ms, which reduces blur.
  - With manual `exposureTime`, a shorter exposure (for example 8–10 ms) plus gain/brightness trades noise for sharpness. Noise is usually the lesser evil for palm detection, but this is unverified.
  - Note: many Windows drivers ignore `brightness` while AE is active, or apply it as a post-gain.
- **Lower resolution can help:** asking for 640x480@30, or 1280x720 with `resizeMode: 'none'`, may let some cameras keep 30 fps in low light where 720p would drop. Check `track.getSettings().frameRate` at run time and feed it into the blur heuristics.
- **Pan/tilt/zoom permission:** PTZ needs a separate permission prompt, requested with `getUserMedia({ video: { pan: true, tilt: true, zoom: true } })`. A hardware zoom could replace FormFlow's software ROI zoom for far hands on supporting cameras (rare on laptop webcams). This is from general knowledge; the Chrome PTZ article URL returned 404, so it is unverified this session.
- **Disable OS effects that fight detection:** OS "Studio Effects" such as background blur, auto-framing and eye contact can blur or crop hands near the body. Read `getSettings().backgroundBlur` and, if controllable, `applyConstraints({ backgroundBlur: false })`. Listen for `configurationchange`.
- **No change to the permission model:** Image Capture constraints need nothing beyond normal camera permission (aside from PTZ). They work on the live track; `new ImageCapture(track)` is only needed for `takePhoto` / `getPhotoCapabilities`.

### Gaps
- I could not confirm the current (M13x–M14x, 2026) Windows Media Foundation behaviour for exposureTime/exposureCompensation, or the exact unit mapping on Windows.
- Status of Chrome constraints named `faceFraming`, `lightingCorrection` or `eyeGazeCorrection` (proposed in mediacapture-extensions): the search found nothing citable.
- I found no data on which popular laptop webcams (Realtek / Sonix / Chicony UVC modules) expose exposureCompensation through Chrome. This needs testing on the target laptops.

## Q3. MediaPipe options, versions, GPU delegate, and alternative browser hand models

### Takeaway
The Tasks HandLandmarker is a two-stage pipeline: palm detector, then a 21-point landmark model on 224x224 crops. In VIDEO / LIVE_STREAM it reuses the previous frame's landmark box and re-runs palm detection only when presence fails. The latest MediaPipe is v1.1.1 (14 Oct 2026). v1.1.0 added per-landmark presence scores to the Web Tasks API and fixed One-Euro drift on resolution change. The web hand model itself has not changed in years, so the gains come from configuration and pipeline design, not a newer model.

### Cited Findings
- **Options and defaults:**
  - `running_mode` (IMAGE / VIDEO / LIVE_STREAM), default IMAGE
  - `num_hands`, default 1
  - `min_hand_detection_confidence` 0.5 (palm detector score)
  - `min_hand_presence_confidence` 0.5 (landmark model; below this, palm detection re-triggers in VIDEO / LIVE_STREAM)
  - `min_tracking_confidence` 0.5 (IoU between the current and previous frame box)

  — [Hand landmarker guide](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker)
- In VIDEO / LIVE_STREAM, the landmark model's box from the previous frame is reused to localise the hand. Palm detection only runs when the landmark model no longer finds a hand or tracking fails. — [Hand landmarker guide](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker)
- **Bundle:** palm detection plus landmark model, input shapes 192x192 and 224x224, float16. The landmark model was trained on about 30K real images plus synthetic renders. Benchmark on Pixel 6: 17.12 ms CPU, 12.27 ms GPU. Only the "full" variant is listed. — [Hand landmarker guide](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker)
- The model card covers "Hand Tracking (Lite/Full)", meaning lite and full variants exist in the model family. — [Model card PDF](https://dcmpx.remotevs.com/com/googleapis/storage/SL/mediapipe-assets/Model%20Card%20Hand%20Tracking%20%28Lite_Full%29%20with%20Fairness%20Oct%202021.pdf)
- **Release notes:**

  | Release | Date | Relevant changes |
  |---|---|---|
  | v1.1.1 | 14 Oct 2026 | Retrieval snippets; macOS GPU segmentation fix |
  | v1.1.0 | 07 Oct 2026 | Per-landmark presence scores exposed in the Web Tasks API; `use_litert` option in BaseOptions with LiteRT / NPU delegate options; fix for landmark drift in the OneEuro smoothing filter when stream resolution changes |
  | v1.0.0 | 28 Jul 2026 | IIFE bundles for web task modules; running mode cached in VisionTaskRunner |
  | v0.10.32 | Jan | WebGPU ImageToTensor fixes; `wgpu::ExternalTexture` support |

  — [google-ai-edge/mediapipe releases](https://github.com/google-ai-edge/mediapipe/releases)
- `detectForVideo` runs synchronously and blocks until the result is ready. — [tasks-vision HandLandmarker API](https://ai.google.dev/edge/api/mediapipe/js/tasks-vision.handlandmarker?authuser=4)
- **GPU delegate reports:**
  - A Japanese tutorial reports flicker with the web GPU delegate and suggests CPU as a fallback. — [zenn.dev](https://zenn.dev/tkada/articles/600efba2db186b)
  - Python reports say the GPU delegate gave no speedup in some versions (0.10.21 on macOS; the CPU/GPU gap vanished in 0.10.31). These are Python, not web. — [Issue #6041](https://github.com/google-ai-edge/mediapipe/issues/6041), [Issue #6216](https://github.com/google-ai-edge/mediapipe/issues/6216)
- **ONNX Runtime Web** has a WebGPU EP (since 1.17) with WASM fallback. Unsupported ops fall back to slow CPU execution. WebGPU is on by default in Chrome/Edge 113+ on Windows. — [Microsoft Open Source blog](https://opensource.microsoft.com/blog/2024/02/29/onnx-runtime-web-unleashes-generative-ai-in-the-browser-using-webgpu/), [onnxruntime-web npm](https://npmjs.com/package/onnxruntime-web)

### Inferences
- **numHands:** set to 2 even for single-hand use. In backlight, the palm detector sometimes locks onto a spurious hand-like blob. With numHands = 2, the real hand still gets a slot, and FormFlow's tracker can pick by continuity, handedness and size. Cost is one extra landmark pass only while two hands are tracked, about +3–6 ms.
- **VIDEO vs IMAGE mode:**
  - VIDEO mode gives MediaPipe's built-in box propagation, which is the main thing that survives blur once a hand is acquired. It needs monotonically increasing timestamps; use `performance.now()` or the rVFC `mediaTime`.
  - IMAGE mode runs palm detection on every call. That is slower and has no temporal propagation, but it does not get stuck on a stale box.
  - FormFlow's IMAGE-mode ROI zoom is effectively a hand-rolled tracker. Consider running two HandLandmarker instances: a VIDEO one on the full frame and an IMAGE one on the zoomed ROI, used only when VIDEO loses the hand.
- **Thresholds:** `min_tracking_confidence` is an IoU between consecutive boxes, not a classifier score. Fast motion lowers IoU even when the hand is clearly visible.
  - Lowering it (0.3, already done) keeps the landmark model running instead of re-triggering palm detection. Palm detection is what fails under blur.
  - Lowering `min_hand_presence_confidence` too far (<0.3) lets the landmark model hallucinate a hand on the background. Gate with FormFlow's own plausibility checks: bone-length ratios, palm-width consistency, handedness stability.
- **Per-landmark presence (v1.1.0):** upgrading to @mediapipe/tasks-vision 1.1.x and reading per-landmark presence/visibility lets FormFlow freeze or extrapolate only the fingertips that went soft (blurred) while keeping well-observed joints. Check the exact field names in the 1.1.x typings. The One-Euro drift fix also matters if FormFlow changes resolution or ROI on the fly.
- **GPU vs CPU delegate:**
  - On an integrated-GPU laptop, delegate 'GPU' (WebGL2) is usually faster. Some driver combinations flicker or return empty results.
  - Implement a startup self-test: run both delegates on 30 frames, compare latency and detection count, and pick one.
  - Pass the `<video>` element or a WebGL canvas directly. Avoid `getImageData` round-trips, which cost 2–5 ms at 720p.
  - Move inference to a Worker with OffscreenCanvas / VideoFrame (transferable) so main-thread UI work does not cause dropped frames that look like "blur gaps".
- **Lite vs full:** the Tasks `hand_landmarker.task` ships the full landmark model. The legacy `@mediapipe/hands` solution exposed `modelComplexity: 0|1` (lite/full). Full is more robust; there is no reason to downgrade for robustness.
- **Alternative browser models:**
  - **TF.js hand-pose-detection** (Apache-2.0): wraps the same MediaPipe Hands models (tfjs or mediapipe runtime), so it gives no robustness gain.
  - **RTMPose-hand / RTMW (MMPose, Apache-2.0)** exported to ONNX and run with onnxruntime-web WebGPU is plausible: a top-down 256x256 crop model with SimCC heads. Its robustness to blur is unknown. It still needs a hand detector (for example RTMDet-nano hand or YOLO-hand ONNX; check licences, since Ultralytics YOLO is AGPL-3.0). This is a larger engineering effort and only worth it if MediaPipe's palm detector is the measured bottleneck.
  - **Hybrid fallback:** use a person/pose detector (already present: Pose Landmarker wrist and elbow) to propose hand ROIs, then run the MediaPipe landmark stage on that crop. This bypasses the palm detector, which is the weak link under blur and backlight. FormFlow's forearm hint is the start of this; formalise it as an ROI producer.

### Gaps
- I found no official benchmark of tasks-vision hand landmarker under blur or backlight, and no official statement on the WebGL2 vs WebGPU backend in v1.1.x.
- I found no citable browser demo or robustness numbers for RTMPose-hand in onnxruntime-web.
- The claim "at least 50% of hands not identified under diagonal motion blur" appeared only in a search snippet. It is attributed to a robustness paper (Pu, Chong, Lim 2023, "Robustness Evaluation in Hand Pose Estimation Models using Metamorphic Testing"), but the page could not be fetched (SSL error). Treat it as unverified. Snippet source: [paperswithcode](https://physics.paperswithcode.com/paper/robustness-evaluation-in-hand-pose-estimation)

## Q4. Temporal techniques (Kalman / One-Euro tuning, dropout prediction, previous-landmark crop, blur-aware tracking)

### Takeaway
MediaPipe already does previous-landmark ROI propagation internally in VIDEO mode. The biggest temporal win is to replicate that propagation outside MediaPipe when it fails: predict the hand box with a constant-velocity Kalman filter, crop and upscale the predicted ROI, and run the landmark/palm stage on it, instead of waiting for full-frame palm detection to succeed on a blurred frame. Pair this with velocity-adaptive One-Euro parameters and a short extrapolation window.

### Cited Findings
- MediaPipe reuses the previous frame's landmark-derived box to locate the hand and only re-runs palm detection on failure. — [Hand landmarker guide](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker)
- MediaPipe v1.1.0 fixed landmark drift in its OneEuro smoothing filter when stream resolution changes. v0.10.35 added a configurable policy for empty landmarks in smoothing calculators. — [MediaPipe releases](https://github.com/google-ai-edge/mediapipe/releases)
- `requestVideoFrameCallback` delivers per-frame metadata including `mediaTime`, `presentedFrames`, width and height. Gaps in `presentedFrames` reveal missed frames. — [web.dev rVFC](https://web.dev/articles/requestvideoframecallback-rvfc), [MDN](https://developer.mozilla.org/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback)
- A community guide recommends a rAF loop throttled to about 33 ms between detect calls, to avoid blocking the main thread. — [mediapipe-usage skill guide](https://skills.cat/skills/liuchiawei/agent-skills/mediapipe-usage)

### Inferences
- **Use rVFC, not rAF:**
  - Drive detection with `video.requestVideoFrameCallback` so every inference sees a new camera frame and gets accurate `mediaTime`.
  - Use `mediaTime * 1000` (ms) as the `detectForVideo` timestamp and as filter `dt`. Real `dt` matters for One-Euro and Kalman when the camera drops to 15–20 fps in low light.
  - Use `presentedFrames` jumps to detect skipped frames and widen the prediction gate.
- **Kalman on the hand box plus wrist:** state is [cx, cy, s, vx, vy, vs], constant velocity, with process noise scaled by measured speed. When a detection is missing (up to about 300–500 ms):
  - Predict the box and crop the frame to 1.5–2.0 times the predicted box, square and rotated to the last wrist-to-middle-MCP angle.
  - Upscale the crop to about 256 px and run HandLandmarker in IMAGE mode on it. The palm detector works far better on a hand that fills 40–60% of the crop.

  This is FormFlow's zoom-and-follow ROI, generalised to the near-field fast-motion case. Cost is one extra IMAGE-mode inference per lost frame, about 8–15 ms on CPU WASM.
- **Map crop landmarks back to the frame:** apply the inverse crop affine transform, then fuse with the Kalman prediction weighted by `handedness score × presence`.
- **Landmark extrapolation during dropouts:**
  - For up to about 150 ms, extrapolate all 21 points rigidly with the wrist velocity, damped (v *= 0.85 per frame), and keep finger articulation frozen.
  - Show the hand as "ghosted" in the UI. Never commit drawing strokes from extrapolated points; FormFlow's drawing logic should require real detections.
  - This beats a plain 0.35 s hold, which makes the cursor stick and then jump.
- **One-Euro tuning:**
  - The jitter-versus-lag trade-off is controlled by `min_cutoff` (lower = smoother at rest) and `beta` (higher = less lag when fast). Typical starting points for normalised 0–1 coordinates at 30 fps: `min_cutoff` 1.0–1.7 Hz, `beta` 0.3–1.0 for drawing, `d_cutoff` 1.0.
  - In low light, noise increases jitter. Lower `min_cutoff` when the quality monitor (Q5) reports low luma or high noise.
  - Under blur, landmarks lag and smear along the motion. Raise `beta` when wrist speed is high, so the filter does not add lag on top of the blur lag.
  - Use per-joint filters with different parameters: fingertips noisier, wrist and MCPs steadier.
- **Blur-aware confidence:**
  - When wrist speed exceeds about 1.5 hand-widths per frame, expect blurred fingers. Down-weight fingertip updates in the filters (or use the v1.1 per-landmark presence) and lean on the palm/MCP rigid body.
  - Ignore pinch/fist gesture state changes during high-speed segments to avoid false "fist-undo" triggers. These are known failure points in FormFlow's commit history.
- **Re-acquisition hysteresis:** after a dropout, accept a re-detection immediately (no 3-hit requirement) if it lies inside the Kalman gate (Mahalanobis distance < 3) and matches the predicted handedness. Keep the 3-hit rule only for fresh hands outside any active track. This reduces the felt "lost hand" duration without adding false positives.
- **Combining with Pose:** Pose Landmarker's wrist (index 15/16) is more blur-robust, because the arm is larger and less blurred than the fingers. Use it as a measurement in the same Kalman filter when hand detection is missing. Pose costs about 10–20 ms, so run it at a reduced rate (for example every 3rd frame) or only during dropouts.

### Gaps
- I found no published tuning study of One-Euro parameters specifically for MediaPipe hand landmarks in webcams. The values above are common starting points from general practice, not cited.
- I found no browser-specific motion-blur-aware hand tracker publication.

## Q5. Detecting bad conditions and coaching the user

### Takeaway
Cheap per-frame metrics, computed on a small downscaled luma image every few frames, can classify conditions reliably enough to show targeted coaching:
- variance of Laplacian for blur
- mean luma and percentile spread for low light
- ROI-vs-frame luma ratio, or the clipped-highlight fraction, for backlight
- actual frame rate from `getSettings()` / rVFC

Thresholds are domain-dependent and must be calibrated on FormFlow's own camera data.

### Cited Findings
- Variance of the Laplacian is the standard blur score. A sharp image has a wide spread of Laplacian responses; 100 is a common default threshold below which an image counts as blurry. The right threshold is highly domain-dependent (optics, lighting, scene). — [PyImageSearch blur detection](https://pyimagesearch.com/2015/09/07/blur-detection-with-opencv/), [OpenCV forum](https://forum.opencv.org/t/scoring-the-clarity-of-an-image/16268)
- One project picks the threshold from precision-recall / ROC curves on labelled sharp and blurry images instead of using a fixed constant. — [HF BlinkBlur calculate_metrics.py](https://huggingface.co/spaces/ArnoBen/BlinkBlur/blob/main/blurriness_estimation/calculate_metrics.py)
- Another domain found its best threshold at 200, showing how widely cutoffs vary. — [JUMMEC Laplacian blur study](https://ejournal.um.edu.my/index.php/jummec/article/view/43812)
- Community reports:
  - Even frontal lighting made MediaPipe tracking reliable. — [Cycling '74 forum](https://cycling74.com/ja/forums/n4m-facemesh-handpose-google-mediapipe)
  - In low light, detection took much longer, and a bright scene was up to 5 times faster. — [vvvv forum](https://forum.vvvv.org/t/vl-mediapipe/22194/27)

### Inferences
- **Metrics on a 160x90 luma image** (drawImage to a small canvas plus getImageData; about 0.3 ms; or a WebGL reduction), every 5th frame:
  1. `meanY`, `p5`, `p95` from a 64-bin histogram.
  2. `clipFrac` = fraction of pixels with Y > 250.
  3. `lapVar` on the hand ROI, or the centre region when no hand. Compare against the median `lapVar` of recent frames where the hand was still. A relative drop is more robust than an absolute threshold.
  4. `fps` from `track.getSettings().frameRate` and rVFC timing.
  5. When a hand is tracked: `roiMeanY / frameMeanY`.
- **Classification rules** (starting points; calibrate per device):
  - **Low light:** meanY < 0.25 and p95 < 0.5, or fps < 20. Coach: "Turn on a light in front of you". Also raise exposureCompensation / gamma.
  - **Backlight:** clipFrac > 0.08 and (roiMeanY / frameMeanY < 0.6, or the upper third is much brighter than the middle). Coach: "Bright light behind you; face the window or close the blind". Automatically apply positive exposureCompensation and shadow-lift gamma.
  - **Motion blur:** lapVar on the hand ROI < 0.4 × running median while wrist speed is high, or fps < 24. Coach: "Move a bit slower" or "Add light so the camera can use a faster shutter".
  - **Hand too far / small:** hand box < 8% of frame height. Coach: "Move closer". FormFlow already has far-hand ROI zoom, so this is mostly informational.
- **Debounce warnings:** require the condition for at least 2 s, with hysteresis, to avoid flicker. Show one non-modal hint at a time, with an icon. Log metrics alongside detection success to tune the thresholds (or fit a small logistic model) on real sessions.
- **Detection health as a signal:** the rolling detection rate (detections / frames over 3 s) plus mean handedness score is the best signal of whether conditions are bad. Use the image metrics only to explain why it is bad, and to pick an automatic remedy (camera constraints, enhancement variant, thresholds).
- **Calibration step:** a 3-second "show your palm" calibration at session start can record baseline lapVar, meanY and ROI luma. It can also choose the enhancement variant and delegate that give the highest presence score, then store the result per camera deviceId in localStorage.

### Gaps
- I found no published thresholds linking luma, backlight ratio or Laplacian variance to MediaPipe hand detection success rates. All thresholds above are unvalidated starting points.
