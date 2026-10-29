# Client-side object silhouette extraction in Chrome (no training) for FormFlow

Context: FormFlow builds a voxel visual hull from up to three photos (front, side, top). The current classical pipeline (Coons-patch border background model, Otsu on colour distance, morphology, largest component) fails on cluttered backgrounds, shadows, objects touching the frame, and backgrounds close in colour to the object. Research date: 2026-10-29.

## Q1. Classical options (GrabCut / watershed / graph cuts / SLIC) in OpenCV.js: quality, speed, bundle size

### Takeaway
OpenCV.js runs in the browser but is heavy: about 6 to 8 MB for the default WASM, and about 1.5 MB with a custom module-trimmed build. I found no published GrabCut-in-browser timings. Classical methods all rest on colour statistics, so they share the current pipeline's main failure mode (background similar in colour to the object). They are best kept as a zero-download fallback or as a refinement step seeded by a box or a model mask.

### Cited Findings
- The default opencv_js.wasm is reported at about 6 MB, and another user reports a package over 8 MB — [OpenCV Q&A: opencv_js.wasm is too large](https://answers.opencv.org/question/229032/opencv_jswasm-is-too-large); [OpenCV Q&A: smaller package](https://answers.opencv.org/question/209264/opencvjs-smaller-package)
- Turning off unused modules cut one build from 8.4 MB to about 4.2 MB. A reduced config reached about 1.5 MB, or about 0.5 MB gzipped — [OpenCV Q&A: Decreasing size of opencv.js](https://answers.opencv.org/question/181963/decreasing-size-of-opencvjs); [OpenCV forum: build only relevant functions](https://forum.opencv.org/t/how-to-build-only-relevant-functions-in-opencv-js/1679)
- Some third-party builds ship the WASM as a separate file rather than embedded, to reduce bundle size (example: `@dusion/opencv-js` 4.10.0) — [@dusion/opencv-js README](https://cdn.jsdelivr.net/npm/@dusion/opencv-js@4.10.0-release.6/README.md)
- OpenCV.js takes a few seconds to compile its modules in the browser at startup. Performance varies by device and browser — [OpenCV blog: OpenCV.js real-time webcam filters](https://opencv.org/opencv-js-real-time-webcam-filters/)
- A 2019 academic study measured OpenCV.js with the WASM engine on desktop, embedded and mobile browsers. The excerpts I could see had no GrabCut timings — [SEDICI, UNLP](https://sedici.unlp.edu.ar/handle/10915/89186)

### Inferences
- GrabCut (`cv.grabCut`, iterated GMM plus graph cut) is the strongest classical option and is a natural fit for "box" interaction: initialise with a user rectangle (`GC_INIT_WITH_RECT`), or with FormFlow's current mask as probable foreground and background (`GC_INIT_WITH_MASK`). It still fails when foreground and background colour distributions overlap, and it tends to swallow cast shadows, because shadows sit in a colour cluster between the two.
- Practical speed: GrabCut cost grows with pixel count and iterations. Downscaling to about 512 px on the long side, running 3 to 5 iterations, then upsampling the mask is the usual approach. Timings need to be measured on FormFlow's own hardware (see Gaps).
- Watershed with markers (seeded from an eroded current mask and a border band) is cheap and refines edges along gradients. It does not solve clutter.
- SLIC is not in the core OpenCV.js build: it lives in the `ximgproc` contrib module, which needs a custom build. Superpixel voting (classify superpixels by their overlap with a coarse mask) is a useful way to snap edges for a model output. It is not a standalone segmenter.
- If FormFlow avoids OpenCV.js entirely, GrabCut-style refinement can be approximated with a small hand-written JS min-cut or a guided filter on the model's alpha, at a far smaller download.

### Gaps
- I found no published GrabCut timings for OpenCV.js in Chrome. They need to be measured directly.
- I could not verify the official size of the current OpenCV.js 4.10 or newer build. The figures above come from 2019 to 2020 forum posts.

## Q2. Promptable segmentation in the browser (SAM family): sizes, timings, licences

### Takeaway
SlimSAM-77 (`Xenova/slimsam-77-uniform`, Apache-2.0) through transformers.js is the lightest maintained option: about 13 MB encoder plus 5 MB decoder when quantized, with an official WebGPU demo. MobileSAM (Apache-2.0, ~27 MB encoder) and EdgeSAM (MIT) are similar in weight. SAM 2.1 tiny is roughly 150 MB and gains little for still photos. All of these use the same interaction: the encoder runs once per image, then each click runs only a small decoder.

### Cited Findings
- **SlimSAM-77** (`Xenova/slimsam-77-uniform`), licence Apache-2.0. File sizes:

  | File | fp32 | fp16 | quantized |
  |---|---|---|---|
  | vision_encoder.onnx | 23.3 MB | 12.2 MB | 8.88 MB |
  | prompt_encoder_mask_decoder.onnx | 16.6 MB | 8.55 MB | 4.9 MB |

  — [HF model files](https://huggingface.co/Xenova/slimsam-77-uniform/tree/main/onnx)
- An official Hugging Face Space, "Segment Anything WebGPU", runs SlimSAM-77 in the browser through transformers.js. Left click adds a positive point, right click a negative point. The Space is Apache-2.0 — [HF Space README](https://huggingface.co/spaces/webml-community/segment-anything-webgpu/blob/main/README.md); [Xenova post](https://huggingface.co/posts/Xenova/240458016943176)
- A community copy of that demo loads the model with `dtype: fp16` and `device: 'webgpu'` — [Space index.js](https://huggingface.co/spaces/AhmedMagdy7/segment-anything-webgpu/blob/main/index.js)
- SlimSAM support first arrived in transformers.js 2.14.0, which included a mask-generation example — [transformers.js 2.14.0 release](https://github.com/huggingface/transformers.js/releases/tag/2.14.0)
- Current transformers.js versions:
  - v3.8.0 added SAM2, SAM3 (Tracker) and EdgeTAM support.
  - v4.0.0 brought a new C++ WebGPU runtime that runs in browsers, Node, Bun and Deno.
  - v4.3.0 enabled WebGPU on Safari 26 and later.
  - The latest release is 4.3.2.
  - The years for these dates were not shown on the page; I infer 2025 to 2026.

  — [transformers.js releases](https://github.com/huggingface/transformers.js/releases)
- WebSAM (an independent project) runs SAM and SAM 2 with WebGPU and ONNX:
  - It quotes SAM 2.1 at about 145 MB (Tiny) to 878 MB (Large).
  - It offers SlimSAM-77 as "a 14 MB INT8 distillation" on CPU through WASM, for browsers without WebGPU.
  - It caches the encoder output, so each later click runs only the decoder.

  — [xevion.dev WebSAM](https://xevion.dev/projects/websam); [GitHub Xevion/WebSAM](https://github.com/Xevion/WebSAM)
- **SAM 2.1 Hiera Tiny** export for onnxruntime-web: encoder 134.7 MB (.ort), decoder 16.6 MB. About 2.7 s for the encoder on Apple Silicon, using WASM with 4 threads (not WebGPU) — [HF Cr7z676/sam2.1-hiera-tiny-onnx](https://huggingface.co/Cr7z676/sam2.1-hiera-tiny-onnx)
- A WebGPU SAM 2 demo exists. Its author warns that the WebGPU build of onnxruntime-web is hard to bundle with Vite — [Segment Anything 2, in WebGPU (write-up)](https://11ty-site-b0m.pages.dev/software/webgpu-sam2); a further SAM 2 in-browser write-up is at [Labelbox blog](https://labelbox.com/blog/bringing-ai-to-the-browser-sam2-for-interactive-image-segmentation/)
- **MobileSAM:**
  - Licence Apache-2.0. It supports ONNX export, and a community "MobileSAM-in-the-Browser" port exists — [MobileSAM mirror](https://gitee.com/robotify/MobileSAM)
  - It replaces SAM's ViT-H with a Tiny-ViT encoder (5M parameters). On a native GPU (not browser) it takes about 8 ms for the encoder and 4 ms for the decoder, against 452 ms for the original SAM encoder. It uses the same mask decoder as SAM — [MobileSAM HF](https://huggingface.co/dhkim2810/MobileSAM)
  - A third-party ONNX bundle has a ViT-T encoder of about 27 MB and is Apache-2.0 — [HF Heliosoph/sam-onnx](https://huggingface.co/Heliosoph/sam-onnx)
- **EfficientSAM-Ti / EfficientSAM-S:** official ONNX exports are listed as Apache-2.0 — [samexporter ONNX collection](https://huggingface.co/nrl-ai/samexporter-onnx-models)
- **EdgeSAM:** licence MIT. It ships `edge_sam_3x_encoder.onnx` and `edge_sam_3x_decoder.onnx` — [HF EdgeSAM card](https://huggingface.co/tonyyang2000/EdgeSAM/blob/main/README.md); paper [arXiv 2312.06660](https://arxiv.org/html/2312.06660v3)
- The original SAM is Apache-2.0, and the SlimSAM paper describes SlimSAM as a data-efficient compression of SAM — [SlimSAM arXiv 2312.05284](https://arxiv.org/pdf/2312.05284)

### Inferences
- For FormFlow, the best fit is SlimSAM-77 quantized or fp16 through `@huggingface/transformers` (`SamModel` + `AutoProcessor`). It is about 13 to 25 MB, Apache-2.0, has an official WebGPU example, and falls back to WASM. EdgeSAM or MobileSAM through raw onnxruntime-web are good alternatives if mask quality is better in tests.
- SAM-family models give multiple masks (multimask output) with IoU scores. FormFlow can pick the best-scoring mask. A centre point works as an automatic prompt, and a box prompt (from the current classical mask's bounding box, or the image minus a border margin) is often more reliable than one point for whole objects.
- SAM 2 or 2.1's main advantage is video and memory tracking, which FormFlow does not need for three still photos. Its ~150 MB download is hard to justify.
- SAM does not separate cast shadows reliably when the prompt is ambiguous. Negative clicks on the shadow fix this.

### Gaps
- I found no measured, apples-to-apples WebGPU timings in Chrome for the SlimSAM, MobileSAM or EdgeSAM encoders. The only number found was WASM 2.7 s for SAM 2.1 tiny. One SharpAI model card's "2-3 s encoder / 0.1-0.5 s per point" appears to be templated estimates, so it is unverified.
- I found no file sizes for EdgeSAM or EfficientSAM ONNX.
- I did not verify whether the transformers.js v4 API still exposes SlimSAM in exactly the 2.x and 3.x demo form.

## Q3. MediaPipe Interactive Segmenter (MagicTouch) and Image Segmenter

### Takeaway
The MediaPipe Interactive Segmenter is a very good fit for one-click correction. It is a ~6 MB MagicTouch model that turns a single point into a confidence mask for "objects / animals / humans", runs in real time on mobile, and is a single npm package (`@mediapipe/tasks-vision`). The Image Segmenter models are person-, hair- or class-specific, and DeepLab-v3 covers only a fixed class list. They do not suit arbitrary objects.

### Cited Findings
- The Interactive Segmenter web guide uses `interactive_segmentation.task` (int8, `interactive_segmenter_v2/magic_touch`). Key behaviour:
  - Input is a normalised keypoint or stroke.
  - Output is a single-channel confidence mask (0 to 1) at the input image size.
  - The delegate is CPU or GPU.
  - The API is `FilesetResolver.forVisionTasks()` → `InteractiveSegmenter.createFromOptions()` → `segment()`.
  - Calls are synchronous and block the UI thread, so the guide recommends web workers.
  - The package is `@mediapipe/tasks-vision`, and the CDN examples use `@latest`.
  - Code samples are Apache 2.0.

  — [MediaPipe Interactive Segmenter web guide](https://developers.google.com/edge/mediapipe/solutions/vision/interactive_segmenter/web_js)
- The MagicTouch model card says the model is 6 MB and segments "objects / animals / humans" in photos based on a point. It reports about 30 FPS on a Pixel 7 using the TFLite GPU backend. The card was found on a mirror of Google's storage bucket — [MagicTouch model card PDF (mirror)](https://dcmpx.remotevs.com/com/googleapis/storage/SL/mediapipe-assets/Model%20Card%20MagicTouch.pdf)
- The API takes a RegionOfInterest (a point or scribble) and requires a TFLite model with metadata. It can output a category mask or a confidence mask — [MediaPipe InteractiveSegmenter API](https://developers.google.com/edge/api/mediapipe/python/mp/tasks/vision/InteractiveSegmenter)
- Image Segmenter models (Pixel 6 latency) — [MediaPipe Image Segmenter overview](https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter):

  | Model | Input | Classes | CPU latency | GPU latency |
  |---|---|---|---|---|
  | SelfieSegmenter | 256×256 | person / background | ~33 ms | ~35 ms |
  | HairSegmenter | 512×512 | hair / background | ~58 ms | ~52 ms |
  | SelfieMulticlass | 256×256 | 6 classes | ~218 ms | ~71 ms |
  | DeepLab-V3 | 257×257 | includes background, person, cat, dog, potted plant | ~124 ms | ~103 ms |

  The overview calls DeepLab-v3 "a general purpose image segmenter".

### Inferences
- Selfie and Hair are irrelevant for generic objects. DeepLab-V3 uses PASCAL-VOC-style classes, so most tabletop objects (mugs, tools, toys) fall into "background". Not suitable.
- MagicTouch is the lightest click-to-segment option: about 6 MB, one dependency, GPU delegate, sub-100 ms per click. One approach for FormFlow: auto-prompt with the image centre or the centroid of the classical mask, then let the user click to re-run. It accepts positive points only (no negative points or box in the web guide), so removing a shadow region is weaker than with SAM.
- The model licence is not stated on the web guide page. Google's MediaPipe models are generally distributed under their model cards, so check the card before shipping (see Gaps).

### Gaps
- I found no explicit licence for the MagicTouch weights on an official page. The model card was only found on a mirror.
- I found no browser (Chrome WebGPU or WASM) timing for MagicTouch. The figures are for Pixel 7 TFLite only.

## Q4. Salient-object / background-removal models in the browser

### Takeaway
These give a fully automatic, zero-click first pass and handle clutter far better than colour statistics. The permissively licensed choices are:
- **BiRefNet_lite** (MIT): best quality, but 115 MB at fp16, and the 1024 export has WebGPU problems.
- **ISNet general-use**: the DIS repo states Apache-2.0 for code, as used by rembg.
- **U²-Netp** (Apache-2.0): 4.7 MB, lower quality.

Licence warnings:
- **@imgly/background-removal** is AGPL, which is viral for a distributed web app.
- **RMBG-1.4 and RMBG-2.0** are non-commercial. That may be acceptable for a college project, but it must be flagged.
- **MODNet** is portrait-only.

### Cited Findings
- **@imgly/background-removal** (v1.7.0 README):
  - It says "free for use under the AGPL License", with other licences available from IMG.LY.
  - Models are `isnet`, `isnet_fp16` (default, ~80 MB) and `isnet_quint8` (~40 MB, "sometimes shows artifacts").
  - Device is `cpu` or `gpu` (WebGPU when available).
  - Outputs are foreground, background or mask, as PNG, JPEG or WebP.
  - It needs `SharedArrayBuffer`, which requires the COOP `same-origin` and COEP `require-corp` headers, for full performance.
  - The first run downloads the WASM and model files, which are then cached.

  — [imgly README 1.7.0](https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/README.md); [npm](https://npmjs.com/package/@imgly/background-removal)
- The imgly changelog records a licence change from GPL to AGPL — [search summary of npm/yarn page](https://classic.yarnpkg.com/en/package/@imgly/background-removal)
- **RMBG-1.4** (BRIA):
  - Licence is "bria-rmbg-1.4", for non-commercial use; commercial use needs an agreement with BRIA.
  - 44.1M parameters, 1024×1024 input.
  - transformers.js usage: `pipeline('image-segmentation', 'briaai/RMBG-1.4')`.
  - 3 quantized variants.

  — [HF briaai/RMBG-1.4](https://huggingface.co/briaai/RMBG-1.4)
- **RMBG-2.0:** CC BY-NC 4.0, non-commercial; commercial use requires a paid BRIA licence — [GitHub Bria-AI/RMBG-2.0](https://github.com/Bria-AI/RMBG-2.0)
- **BiRefNet_lite** (onnx-community):
  - Licence MIT (upstream BiRefNet). The repo is tagged for transformers.js.
  - `model.onnx` is 224 MB and `model_fp16.onnx` is 115 MB.

  — [HF onnx-community/BiRefNet_lite-ONNX](https://huggingface.co/onnx-community/BiRefNet_lite-ONNX); [files](https://huggingface.co/onnx-community/BiRefNet_lite-ONNX/tree/main/onnx)
- Community reports say the stock 1024×1024 BiRefNet_lite ONNX fails in onnxruntime-web (`std::bad_alloc`) or on the WebGPU EP. Two re-exports claim to fix this, both self-reported and unverified:
  - a 512×512 re-export (`studioludens/birefnet-lite-512`, WebGPU with WASM fallback);
  - a graph-patched 1024 export (`jiabins0303/birefnet-lite-1024-webgpu`), which replaces an operator that the WebGPU EP lacks.

  — [HF runes/birefnet-lite-webgpu](https://huggingface.co/runes/birefnet-lite-webgpu); [studioludens/birefnet-lite-512](https://hf-2025.pages.dev/studioludens/birefnet-lite-512); [jiabins0303/birefnet-lite-1024-webgpu](https://huggingface.co/jiabins0303/birefnet-lite-1024-webgpu)
- A transformers.js performance-leaderboard entry exists for BiRefNet_lite WebGPU fp32 in Chromium — [whitphx leaderboard commit](https://huggingface.co/datasets/whitphx/transformersjs-performance-leaderboard-results/commit/de577a0d09db679fc9438508c08436ba5de108f3)
- **ISNet / DIS:** the repo states "Our code and evaluation metric use Apache License 2.0". `isnet-general-use` is the general model that rembg uses — [GitHub xuebinqin/DIS](https://github.com/xuebinqin/DIS); [rembg-web models guide](https://bunn-io.github.io/rembg-web/guides/models.html)
- **U²-Netp:** about 4.7 MB, Apache-2.0 (matches the upstream U-2-Net repo). The rembg code itself is MIT — [HF edgetools/u2netp](https://huggingface.co/edgetools/u2netp); [HF Heliosoph/u2net-onnx](https://huggingface.co/Heliosoph/u2net-onnx); [rembg spec](https://eur.openeuler.openatom.cn/results/mywaaagh_admin/pypi/openeuler-22.03_LTS_SP1-x86_64/00047693-python-rembg/python-rembg.spec)
- **MODNet** (`Xenova/modnet`) is a "tiny portrait background removal model", shown in the transformers.js v3 `remove-background-webgpu` example. Development notes report ~20 fps with WebGPU at fp32, since fp16 was broken at the time — [HF blog: Transformers.js v3](https://www.huggingface.co/blog/transformersjs-v3); [PR #545](https://github.com/huggingface/transformers.js/pull/545); [onnx-community/modnet-webnn](https://huggingface.co/onnx-community/modnet-webnn/tree/main)
- Transformers.js v3 was released 22 Oct 2024 as `@huggingface/transformers`, with WebGPU support — [HF blog v3](https://www.huggingface.co/blog/transformersjs-v3)

### Inferences
- Recommended automatic model: **ISNet general-use** through onnxruntime-web directly. This avoids the AGPL imgly wrapper but uses the same weights family. The ONNX is roughly 170 MB at fp32 and about 40 to 90 MB fp16 or quantized, based on imgly's variants. Alternatively, use BiRefNet_lite at 512 if quality testing favours it and 115 MB is acceptable.
- Using imgly's package directly would put FormFlow under AGPL obligations: source must be offered to users of the web app. That is acceptable for an open-source student project, but it should be flagged.
- RMBG-1.4 is easy to use (one line in transformers.js) and good quality, but it is non-commercial. It is acceptable for coursework or a demo only.
- Salient-object models assume a single dominant subject, which matches FormFlow's "one object per photo" setting. They can fail when the object is small, off-centre, or when a more salient distractor such as a hand is present. A one-click fallback is still needed.
- Objects touching the frame are not a problem for these models, unlike the current border-based background model.
- Many of these models label soft cast shadows as background, but strong contact shadows sometimes leak in.

### Gaps
- I found no verified Chrome WebGPU millisecond timings for ISNet or BiRefNet. The leaderboard dataset exists, but I did not extract numbers.
- The ISNet ONNX file sizes are inferred from imgly's 40 and 80 MB variants, not checked against the rembg release files.
- The exact BRIA licence terms and prices were not reviewed.

## Q5. Shadow handling and post-processing (matting, edge refinement)

### Takeaway
For a visual hull, a slightly too-large silhouette is the worst error, because shadows and floor patches carve no voxels and produce "fins". The lowest-cost wins are:
1. Use a learned mask, which already rejects most soft shadows.
2. Add a chromaticity test: a pixel that is darker but keeps the background's chromaticity is shadow, and is removed from the mask.
3. Snap edges with a guided filter or GrabCut seeded from the mask.
4. Threshold the alpha at about 0.5, then make the morphology conservative.

### Cited Findings
- A standard assumption is that cast shadows are darker than the background but keep similar chromaticity. Colour spaces that separate chromaticity from intensity (HSV, c1c2c3, YUV) are used to detect them — [NSF PAR 10206170](https://par.nsf.gov/servlets/purl/10206170)
- HSV chromatic criteria flag candidate shadow pixels inside a foreground mask. The pipeline is: detect foreground, detect shadow candidates, cluster them into regions, remove them — [NSF PAR 10206364](https://par.nsf.gov/servlets/purl/10206364)
- Shadows shift hue slightly and sharply lower saturation. Shadow pixels form a compact cluster that empirical HSV thresholds can separate — [IASJ 2024 paper](https://iasj.rdd.edu.iq/journals/uploads/2024/12/17/f9ad6daf49a252492a2e543d11bd268b.pdf)
- Shadow outlines often remain labelled as foreground, so removal is partial. Umbra shadows can break chromaticity-only rules, and gradient-plus-colour models help — [NSF PAR 10206170](https://par.nsf.gov/servlets/purl/10206170); [Holte et al. ICCV 2009 workshop](https://vbn.aau.dk/ws/files/19095436/holte_iccv09.pdf)
- A reference implementation of shadow-detection methods is on GitHub — [hadign20/ShadowDetection](https://github.com/hadign20/ShadowDetection)

### Inferences
- FormFlow already has a per-pixel background estimate (the Coons patch). A pixel inside the mask with brightness ratio I/B in about [0.4, 0.95] and small chromaticity difference to B (normalised rg, or hue and saturation) is a shadow candidate. Contact shadows touch the bottom of the object, so restrict removal to candidates in the lower part of the bounding box, or adjacent to the floor.
- With promptable models, a negative click on the shadow is the simplest correction (SAM family supports negative points; MagicTouch does not in the web guide).
- Edge refinement:
  - Run a guided filter (He et al.) with the RGB image as guide on the soft alpha, then threshold. This is cheap in JS or WebGL.
  - Alternatively, run GrabCut with `GC_INIT_WITH_MASK`, setting eroded mask = definite foreground, dilated complement = definite background, and the band in between = probable.
  - Full alpha matting is unnecessary for hulls, which need binary silhouettes.
- Hull-specific choices:
  - Prefer slightly eroded masks, because carving more is safer than leaving fins.
  - Keep largest-component and hole fill, but disable hole fill for objects with real through-holes (for example, mug handles).
  - Keep the Douglas-Peucker tolerance small.

### Gaps
- I did not find a browser-specific shadow-removal library, or a published evaluation of shadow leakage for ISNet or BiRefNet on product-style photos.
- The guided-filter and GrabCut refinement benefits are from general knowledge and were not benchmarked in sources here.

## Q6. Recommended UX: automatic first, then one-click correction (comparison and integration)

### Takeaway
Recommended pipeline:
1. Run a salient-object model automatically on each photo (ISNet or BiRefNet_lite, MIT or Apache-2.0).
2. Show the mask overlay.
3. If the user clicks, switch to a promptable model for that photo: SlimSAM-77 (Apache-2.0, ~13 to 25 MB) for positive and negative clicks or a box, or MediaPipe MagicTouch (~6 MB) for single-tap reselect.
4. Keep the existing classical pipeline as the offline fallback and as a source of box and point prompts.

### Cited Findings (comparison table; each row's sources are in Q1 to Q4)

| Option | Quality (generic object) | Download | Browser backend | Interaction | Licence | Library / model |
|---|---|---|---|---|---|---|
| Current classical (Otsu/Coons) | Low on clutter, shadows, similar colours | 0 | JS | none | own | n/a |
| OpenCV.js GrabCut | Medium; still colour-based | ~6–8 MB default WASM; ~1.5 MB custom | WASM | box or mask seed | Apache-2.0 (OpenCV 4.5+) | opencv.js 4.x |
| ISNet general-use | High, automatic | ~40–170 MB depending on precision | onnxruntime-web WebGPU/WASM | none | Apache-2.0 (DIS) | DIS / rembg weights |
| @imgly/background-removal | High (ISNet) | ~40 MB (quint8) / ~80 MB (fp16) | WebGPU / WASM | none | **AGPL** | @imgly/background-removal 1.7.x |
| BiRefNet_lite | Very high | 115 MB fp16 / 224 MB fp32 | transformers.js WebGPU (1024 export issues; 512 re-export) | none | MIT | onnx-community/BiRefNet_lite-ONNX |
| RMBG-1.4 | High | 44.1M params (~44–176 MB) | transformers.js | none | **Non-commercial** (bria-rmbg-1.4) | briaai/RMBG-1.4 |
| RMBG-2.0 | Very high | large (BiRefNet-based) | — | none | **CC BY-NC 4.0** | briaai/RMBG-2.0 |
| U²-Netp | Medium | 4.7 MB | onnxruntime-web | none | Apache-2.0 | u2netp |
| MODNet | Portrait only | small | transformers.js WebGPU (~20 fps) | none | (Apache-2.0 upstream; not verified here) | Xenova/modnet |
| SlimSAM-77 | High with prompts | 13.8 MB quantized / 20.8 MB fp16 / 40 MB fp32 | transformers.js WebGPU/WASM | point(s) or box | Apache-2.0 | Xenova/slimsam-77-uniform |
| MobileSAM | High with prompts | ~27 MB encoder + decoder | onnxruntime-web | point or box | Apache-2.0 | MobileSAM |
| EdgeSAM | High with prompts | not found | onnxruntime-web | point or box | MIT | EdgeSAM |
| EfficientSAM-Ti/S | High with prompts | not found | onnxruntime-web | point or box | Apache-2.0 | EfficientSAM |
| SAM 2.1 tiny | High with prompts | ~151 MB | onnxruntime-web (WASM 2.7 s encoder, M-series) | point or box | Apache-2.0 | sam2.1-hiera-tiny |
| MediaPipe MagicTouch | Good, single tap | ~6 MB | tasks-vision GPU/CPU | one point or stroke (positive only) | Apache-2.0 code; model licence via card | @mediapipe/tasks-vision |
| MediaPipe Selfie / DeepLab-V3 | Not suitable (person / fixed classes) | small | tasks-vision | none | — | — |

- Hosting requirement: imgly and multithreaded onnxruntime-web need `SharedArrayBuffer`, which requires the COOP and COEP headers — [imgly README](https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/README.md)
- MediaPipe recommends running segmentation in a web worker, because the calls block the UI thread — [MediaPipe web guide](https://developers.google.com/edge/mediapipe/solutions/vision/interactive_segmenter/web_js)
- The onnxruntime-web WebGPU build is hard to bundle with Vite — [webgpu-sam2 write-up](https://11ty-site-b0m.pages.dev/software/webgpu-sam2)
- The SAM-family workflow encodes once per image and runs only the decoder per click — [WebSAM](https://xevion.dev/projects/websam)

### Inferences
- Suggested flow per photo:
  1. Run the auto mask (salient model) in a worker.
  2. Score it with FormFlow's existing "object-likeness" heuristics (area fraction, compactness, centredness, border contact).
  3. If the score is low, or the user taps "fix", run the SlimSAM encoder once and cache the embedding.
  4. Seed SAM with a box prompt from the auto mask's bounding box. This often fixes partial masks with no click.
  5. The user adds a positive click (missing part) or a negative click (shadow or clutter). Each click runs only the ~5 to 9 MB decoder.
  6. Refine with a guided filter or GrabCut band, threshold, then pass the mask into the existing component / hole-fill / trace / Douglas-Peucker stages.
- Download budget: prefer lazy loading. The SlimSAM quantized model (~14 MB) plus U²-Netp (4.7 MB) gives a sub-20 MB "light mode". Lazy-load ISNet or BiRefNet as a "high quality" option. Cache the models in the Cache API or OPFS (transformers.js caches automatically).
- Cross-view consistency: the three photos are of the same object, so use the same model and threshold for all three. Show the hull preview live, so users can see which view's silhouette causes fins.
- Licence-safe default stack, all MIT or Apache-2.0: onnxruntime-web or transformers.js + ISNet or BiRefNet_lite + SlimSAM / MobileSAM / EdgeSAM + MediaPipe tasks-vision. Avoid imgly (AGPL) and BRIA RMBG (non-commercial) unless the project is explicitly non-commercial and open-source.

### Gaps
- I found no end-to-end quality benchmark comparing these models on product or tabletop photos with shadows. Choose by an A/B test on FormFlow's own sample photos.
- The MODNet weight licence was not verified.
- The EdgeSAM and EfficientSAM ONNX sizes were not found.
- Chrome WebGPU timings on the user's hardware are unmeasured for every model listed.
