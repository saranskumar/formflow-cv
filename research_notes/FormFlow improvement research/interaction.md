# Interaction design for bare-hand mid-air 3D sketching with a single webcam (FormFlow)

Scope: evidence-based improvements for FormFlow (MediaPipe hand landmarks in a browser; pinch = draw/place, thumb+middle = grab, other-hand fist = orbit, peace sign = pan, two-hand pinch = zoom; depth set by a movable "glass" plane via keys/voice; 3-plane orthographic front/side/top workspace). Problems: depth without a depth sensor, gorilla arm, accidental pinches, precision.

Note on method: about 20 searches/fetches. Two primary PDFs could not be read (the SFU server refused connections for Multiplanes and Smart3DGuides), so those findings come from abstracts and publication pages. The Arora et al. CHI 2017 PDF was read in full text. Items marked as inference are engineering reasoning, not study results.

## 1. What mid-air/VR sketching research and products say (planes, snapping, beautification, guides)

### Takeaway
The strongest evidence is that freehand mid-air strokes are inaccurate, mostly in depth, and that drawing onto a surface (physical or virtual) plus visual guides improves accuracy a lot. FormFlow's "glass plane" + orthographic 3-plane workspace is the same idea as the research systems (Multiplanes, SymbiosisSketch, Lift-Off). Recommended next steps: auto-generated snapping planes from existing strokes, a grid on the active plane, non-constraining guides, and an explicit switch between freeform and controlled modes.

### Cited Findings
- Arora et al. (CHI 2017) ran controlled studies. A missing physical drawing surface is a major cause of inaccuracy in VR drawing, and the effect depends on the surface's orientation. Visual guidance improves positional accuracy but can hurt the aesthetic quality of strokes. — [Arora et al. 2017, Autodesk Research PDF](https://research.autodesk.com/app/uploads/2023/03/experimental-evaluation-of-sketching.pdf_recSPFZ4RbLaE2Uio.pdf)
- Same paper, discussion section: a physical surface improves accuracy by 22% over unguided mid-air drawing, and a *virtual* surface alone improves it by up to 17%. Grids improved accuracy by 17% and scaffolding curves by 57%. Tracing over an existing curve hurt drawing quality, and the authors say a rendered grid "may provide the right balance between accuracy and aesthetics." — [Arora et al. 2017 PDF](https://research.autodesk.com/app/uploads/2023/03/experimental-evaluation-of-sketching.pdf_recSPFZ4RbLaE2Uio.pdf)
- Same paper: compared with traditional sketching, projecting strokes onto virtual planes in VR was 53% worse and drawing on a physical surface in VR was only 20% worse. Participants could not make circle endpoints meet their start points, which the authors tie to depth-perception problems. They suggest fog, 3D grids, and semi-transparent automatic surfacing as depth cues. — [Arora et al. 2017 PDF](https://research.autodesk.com/app/uploads/2023/03/experimental-evaluation-of-sketching.pdf_recSPFZ4RbLaE2Uio.pdf)
- Same paper: designers in pilot sessions wanted to switch back and forth between freeform and controlled sketching modes. — [Arora et al. 2017 PDF](https://research.autodesk.com/app/uploads/2023/03/experimental-evaluation-of-sketching.pdf_recSPFZ4RbLaE2Uio.pdf)
- Multiplanes (Barrera Machuca, Asente, Stuerzlinger, Lu, Kim; SUI 2018, demo at UIST '17) generates snapping planes and beautification trigger points from previous strokes, the current stroke, and the controller pose. It beautifies strokes toward the most probable intended shape while they are being drawn. Users can hit trigger points to start beautification explicitly. — [Multiplanes, SFU pub page](https://vvise.iat.sfu.ca/pubs/machuca2018multiplanes); [Adobe Research](https://research.adobe.com/publication/multiplanes-assisted-freehand-vr-drawing)
- Smart3DGuides (Barrera Machuca, Stuerzlinger, Asente; VRST 2019) identified common freehand VR stroke mistakes and designed non-constraining visual guides. In user studies these guides improved the shape-likeness and stroke quality of drawings, and participants found them useful and easy to use. — [Adobe Research page](https://research.adobe.com/publication/smart3dguides-making-unconstrained-immersive-3d-drawing-more-accurate); [paper PDF](https://vvise.iat.sfu.ca/user/data/papers/smart3dguides.pdf)
- SymbiosisSketch (Arora, Kazi, Grossman, Fitzmaurice, Singh; CHI 2018) combines in-air 3D strokes with 2D tablet strokes drawn on surfaces built from 3D curves. The surfaces act as canvases and as occluding shape proxies. The authors report the hybrid beat either traditional sketching or drawing in air alone. — [Autodesk Research](https://www.research.autodesk.com/publications/symbiosissketch-combining-2d-3d-sketching-for-designing-detailed-3d-objects-in-situ); [preprint PDF](https://research.autodesk.com/app/uploads/2023/03/symbiosissketch-combining-2d-.pdf_recfYOmXDTL1DDli7.pdf)
- Lift-Off (Jackson & Keefe, IEEE TVCG 2016): artists import 2D sketches into VR as reference planes, then select 2D curves and "lift" them into space as 3D scaffolding, using a bimanual interface. — [IV Lab](https://ivlab.cs.umn.edu/Jackson-2016-LiftOff.html); [PDF](https://ivlab.cs.umn.edu/static/data/standalone/media/3d-drawing/LiftOff.pdf)
- Mockup Builder (de Araujo, Casiez, Jorge, Hachet; GI 2012 / C&G 2013) combines tracked hands above a multitouch table with touch on the surface, and follows Guiard's asymmetric bimanual model. — [HAL](https://hal.archives-ouvertes.fr/hal-00687891v1)
- Open Brush (the Tilt Brush successor) ships grid and angle snapping, snap-to-guides, a plane guide, axis-restricted snapping, and "Lazy Input" stroke smoothing like ZBrush's Lazy Mouse. — [Open Brush docs](https://docs.openbrush.app/differences-between-open-brush-and-tilt-brush); [CG Channel](https://www.cgchannel.com/2022/02/download-free-virtual-reality-3d-sketching-app-open-brush/)
- Gravity Sketch puts snapping on a non-dominant-hand modifier (the "Shift Trigger"), and since v6.0 sets input smoothing per brush preset. — [Gravity Sketch glossary](https://help.gravitysketch.com/hc/en-us/articles/19823735929117-gravity-sketch-glossary); [v6.0 release notes](https://help.gravitysketch.com/hc/en-us/articles/11454341897245-version-6-0-release)
- Vremiere (Nguyen, DiVerdi, Hertzmann, Liu) is in-headset VR *video editing*, at CHI 2017 not UIST 2017. It is not a sketching paper. Its only relevance is as a method example: interviews with professionals, then a prototype, then expert review. — [Adobe Research](https://research.adobe.com/publication/vremiere-in-headset-virtual-reality-video-editing); [project page](https://web.cecs.pdx.edu/~fliu/project/vremiere)

### Inferences
- **Improvement: always draw on a plane, never in free depth.** FormFlow already does this. The evidence (virtual surface +17%) supports keeping projection onto the glass plane as the default, with a grid rendered on it (+17%).
- **Improvement: Multiplanes-style auto planes.** When a stroke ends, fit a plane to its 3D points (PCA). Offer the plane through it, plus planes perpendicular to it through its endpoints, as one-pinch-selectable "glass" candidates. Combine this with the 3 orthographic planes. This replaces most of the key/voice depth adjustment with selecting the next plane from existing geometry, which needs no depth sensing.
- **Improvement: non-constraining guides (Smart3DGuides) instead of hard tracing.** Show a faint ghost of the inferred shape (line, circle, plane intersection) during the stroke rather than snapping the raw stroke onto it. Snap only at stroke end, and only when confidence is high. Arora's finding that tracing hurts aesthetics supports this.
- **Improvement: an explicit freeform/controlled mode toggle**, as designers requested. A non-dominant-hand modifier is the best fit, following Gravity Sketch's Shift Trigger. For example, hold an open palm with the off hand to enable snapping. That gesture should not clash with the off-hand fist used for orbit.
- **Depth cues for a 2D screen:** fog/depth tinting, drop lines from the cursor to the ground grid, and the glass plane rendered semi-transparent. All are cheap in three.js. They follow Arora's depth-perception recommendations.

### Gaps
- Quantitative Multiplanes and Smart3DGuides results (accuracy %, n) were not retrieved because the SFU PDF server refused connections.
- No study found that evaluates these techniques on a 2D monitor with webcam hand tracking. All the cited studies used HMDs with 6-DoF controllers.
- Quill's snapping/guide features were not documented in the sources found.

## 2. Depth control from a monocular hand (palm size, MediaPipe z/world landmarks, second hand, push-pull)

### Takeaway
MediaPipe's z values are not camera distance. Image-space z is relative to the wrist, and world landmarks are metric but centered on the hand. Absolute hand depth from one RGB camera is therefore noisy. The practical options are (a) relative depth from changes in apparent hand scale, used as a clutched push/pull rate or offset control, and (b) avoiding continuous depth input altogether by picking planes and using orthographic views. Continuous absolute palm-size depth should not be the main drawing depth.

### Cited Findings
- MediaPipe Hand Landmarker: in normalized landmarks, z is depth with "the depth at the wrist being the origin". Smaller values are closer to the camera, and the magnitude uses roughly the same scale as x. World landmarks are real-world 3D coordinates in meters with the origin at the hand's geometric center. — [MediaPipe Hand Landmarker Web guide](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js)
- Developers on the MediaPipe forum have struggled to get usable absolute Z for apps such as Unity. — [MediaPipe Google Group thread](https://groups.google.com/g/mediapipe/c/UeM1Kl7SyCc)
- A Fujitsu research paper (MVA 2013) estimates relative hand depth from monocular video. It tracks the change in apparent hand scale over frames and classifies the accumulated change as push or pull. — [MVA 2013 paper](https://www.mva-org.jp/Proceedings/2013USB/papers/09-11.pdf)
- Fujitsu's 2013 press release claims push/pull detection from a single PC/tablet camera at about 90% accuracy, used to zoom maps and images in and out. This is a vendor claim, not a peer-reviewed user study. — [Fujitsu press release](https://info.archives.global.fujitsu/global/about/resources/news/press-releases/2013/0520-01.html)
- An IEICE 2011 paper measured 3D hand position relative to a projected screen from hand width in a monocular webcam, which enabled 3D operations on projected objects. — [IEICE abstract](https://ken.ieice.org/ken/paper/20110222G0eJ/eng/)
- A 2015 work (per an aggregator listing) proposed machine learning to recognize gestures and estimate metric hand depth from monocular RGB video for mobile 3D interaction. — [AMiner listing](https://www.aminer.cn/pub/5550447c45ce0a409eb4e38e/joint-estimation-of-d-hand-position-and-gestures-from-monocular-video-for)
- Even with perfect 6-DoF tracking, depth is the hardest axis for users. Arora et al. found depth inaccuracies common, with endpoints of drawn circles failing to meet. — [Arora et al. 2017 PDF](https://research.autodesk.com/app/uploads/2023/03/experimental-evaluation-of-sketching.pdf_recSPFZ4RbLaE2Uio.pdf)

### Inferences
- **Improvement: a scale-invariant depth proxy.** Use the pixel distance between rigid landmarks, for example wrist (0) to index MCP (5) plus index MCP (5) to pinky MCP (17). Do not use fingertip spread, which changes with pose. Apparent size is roughly proportional to 1/distance (pinhole model). Calibrate per user by holding the hand at "near" and "far" for one second each. Low-pass the value with a 1€ filter (Q4). Treat it as *relative*.
- **Improvement: clutched push-pull for the glass plane.** While holding a dedicated "depth" pose (for example a thumb+ring pinch, or the off hand open), map the change in hand scale since clutch start to plane offset. Releasing freezes the plane. This is the same clutch pattern used for orbit, so it is learnable. It also avoids depth drift while drawing, because depth never changes during a stroke.
- **Improvement: depth from the second hand.** The off hand's vertical position, or the distance between both hands' wrists in the image, can drive plane depth like a slider while the dominant hand draws. Distances within the image plane are far more reliable from a webcam than z. This follows Guiard-style asymmetric bimanual roles, where the non-dominant hand sets the frame of reference (as in Mockup Builder).
- **Avoid:** using MediaPipe image z or the world-landmark z for absolute cursor depth, since neither is camera distance per the docs.
- **Keep orthographic views as the precision path:** drawing in the side view sets depth exactly with x/y motion. A small inset view showing the cursor's depth position (side view) during front-view drawing would make depth visible.

### Gaps
- No peer-reviewed user study was found that compares palm-size depth, push-pull, or second-hand depth for webcam sketching. The accuracy and jitter of MediaPipe-based palm-scale depth would need a pilot measurement in FormFlow itself.
- MediaPipe has no published error figures for its z output.

## 3. Pinch reliability, feedback, and the Midas touch problem

### Takeaway
Use hysteresis (separate engage/release thresholds), normalize pinch distance by hand size, debounce over a few frames, and give strong visual + audio feedback because there is no haptic contact. Reserve pinch for one core action and keep the gesture set small. Hard-to-see multi-finger poses (for example thumb+middle while other fingers curl) are less reliable.

### Cited Findings
- Ultraleap recommends pinch strength (0–1) with an activation threshold around 0.8, and a separate lower release value (hysteresis) to stop flicker near the threshold. — [Ultraleap Pinch and Grab Detection](https://docs.ultraleap.com/xr-and-tabletop/xr/unity/plugin/features/pinch-and-grab-detection.html)
- Ultraleap advises fading hand visuals as hands approach the edges of the interaction zone so users know tracking is about to drop. It also advises enough space around UI components to avoid accidentally triggering neighbors. — [Ultraleap design principles](https://docs.ultraleap.com/xr-guidelines/Getting%20started/design-principles.html); [Ultraleap UI components](https://docs.ultraleap.com/xr-guidelines/Components/ui-components.html)
- Meta hand-tracking best practices: use a clean index-thumb pinch with the other fingers relaxed and spread, and avoid grabs with several fingers curled, which reduce tracking accuracy. Prefer one core interaction plus a few extra gestures. Plan for gesture variability with forgiving recognition and in-app reminders. Provide visual and audio feedback that the gesture was recognized and what happened. Minimize visuals that flash on and off. — [Meta hands best practices](https://developers.meta.com/vr/design/hands-best-practices/)
- Meta: use pinch for selection with visual and audio confirmation to make up for missing haptics. Hand tracking has delays and lower accuracy during fast movements, so interactions should be forgiving. Continuously test gestures for accidental activations. — [Meta hands interaction types](https://developers.meta.com/horizon/design/hands-interaction-types/); [Meta gesture design](https://developers.meta.com/vr/design/hands-gesture-design/)
- Meta microgestures: small thumb-based movements (for example thumb tap, thumb swipe). Because pinch is reserved for selection, thumb tap can be used for contextual actions. — [Meta microgestures](https://developers.meta.com/horizon/design/design-microgestures/)
- In mid-air selection research, pinch was relatively fast but error-prone and physically and cognitively demanding (Dube & Arif, as summarized in search results). — [eScholarship PDF](https://escholarship.org/content/qt4v91504d/qt4v91504d.pdf)
- The Midas touch problem (credited to Jacob 1990) arises when an always-on input treats looking as selecting. Dwell is the usual fix, but too short a dwell causes wrong selections and too long slows users down. — [Penkar et al. 2012](https://www.cs.auckland.ac.nz/~lutteroth/publications/PenkarLutterothWeber2012-EyeDwellParameters.pdf); [arXiv 2603.15991](https://arxiv.org/pdf/2603.15991)
- Reported dwell values: typical gaze dwell is about 600–1200 ms. One study found 700 ms optimal for eye-only selection, and 200 ms when combined with a hand action. — [arXiv 2411.06726](https://arxiv.org/pdf/2411.06726); [record](https://searchworks.jioinstitute.edu.in/articles/edb__148905610)
- Longer dwell reduces false activations in gesture/mirror interfaces but slows interaction and hurts the experience. — [Springer chapter](https://unpaywall.org/10.1007%2F978-3-319-39516-6_7)

### Inferences
- **Improvement: normalized pinch with hysteresis.** Compute d = |thumbTip(4) − indexTip(8)| / handScale, where handScale = |wrist(0) − middleMCP(9)|, so the threshold works at any camera distance. Engage when d < ~0.25, release when d > ~0.4. These values need tuning. Require 2–3 consecutive frames to engage, and a few frames, or about 80–120 ms, to release, so tracking dropouts don't break strokes.
- **Improvement: stroke "arming" to defeat Midas touch.** Commit a stroke only after the pinch has held for a short time (~100–150 ms) or moved a minimum distance. Discard strokes shorter than N mm or shorter than ~150 ms as accidental. Auto-undo a stroke if tracking confidence drops during it.
- **Improvement: feedback without haptics.** Show a cursor ring that shrinks as fingers approach the threshold (a pre-pinch "proximity" state), a color change and click sound on engage, and a softer sound on release. Fade the hand overlay near the camera frame edges (Ultraleap).
- **Improvement: reduce gesture ambiguity.** Thumb+middle grab and the peace-sign pan both use curled or extended middle and ring fingers, which can be confused with each other or with pinch. Consider fewer static poses: modes held by the off hand, plus a dwell-free mode palette.
- **Destructive actions** (clear, delete) should be confirmed or undoable. FormFlow's fist-undo already fires once per hold, which is the right pattern.

### Gaps
- No webcam/MediaPipe-specific study of pinch false-positive rates was found. Threshold numbers above are suggested starting points, not cited values.
- Jacob (1990) original paper not fetched. It is cited via secondary sources.

## 4. Fatigue (gorilla arm): elbow-rested interaction, reduced-amplitude mapping, clutching, Consumed Endurance

### Takeaway
Fatigue is driven by holding the arm extended and raised. The evidence supports elbow-anchored or rested postures, offset/scaled (non-1:1) mappings with clutching, and measuring fatigue with Consumed Endurance (CE) or its newer successor NICER. A desktop webcam setup can exploit this well: let users draw with the elbow on the desk and map a small hand region to the full workspace.

### Cited Findings
- Consumed Endurance (Hincapié-Ramos, Guo, Moghadasian, Irani; CHI 2014, pp. 1063–1072, DOI 10.1145/2556288.2557130) is a metric that quantifies arm fatigue of mid-air interactions. A companion CE Workbench tool appeared at DIS '14. — [BibTeX/record](https://bibtex.github.io/CHI-2014-Hincapie-RamosGMI.html); [dblp](https://dblp.uni-trier.de/rec/conf/chi/Hincapie-RamosGMI14.html)
- Later work citing CE reports that centralized arm positions with minimal joint extension were less tiring (Hincapié-Ramos et al. 2014). — [Springer chapter citing CE](https://link.springer.com/chapter/10.1007/978-3-319-57987-0_41)
- NICER (Li, Tag, Dai, Crowther, Dwyer, Irani, Ens; ACM TOG 2024) improves CE by adding a recovery component. — [researchr](https://researchr.org/publication/LiTDCDIE24)
- Villanueva et al. (IJHCS 2023) model cumulative subjective fatigue in mid-air pointing using active, fatigued, and rested muscle units. — [SFU pub page](https://vvise.iat.sfu.ca/pubs/villanueva2022advancedfatigue)
- Elbow-anchored interaction (Veras et al., CHI 2021, Univ. of Manitoba): with a rested arm, participants used more forearm and wrist. A spherical model mapping forearm angles to screen coordinates supported comfortable seated input across postures. — [UManitoba HCI publication](https://hci.cs.umanitoba.ca/publications/details/elbow-anchored-interaction-designing-restful-mid-air-input)
- KIT fatigue-management study (21 participants, within-subjects): ProxyHand (user-defined offset of the ray origin, so the arm can rest), SphereCast, and Radial Select reduced fatigue (measured with CE) versus baseline pointing. However, more deviation from 1:1 mapping reduced presence and embodiment. — [KIT HCI Fatigue Management Techniques](https://hci.iar.kit.edu/559.php)
- Meta guidelines: keep hands relaxed around chest level and avoid holding arms above heart level or reaching excessively. Design so arms can rest at the sides, include rest periods, and don't penalize pausing. — [Meta hands best practices](https://developers.meta.com/vr/design/hands-best-practices/)
- Ultraleap warns that poor design can cause discomfort, fatigue, or even injury. — [Ultraleap design principles](https://docs.ultraleap.com/xr-guidelines/Getting%20started/design-principles.html)
- Arora et al. note fatigue becomes a major factor in long design sessions, which motivates physical supports. — [Arora et al. 2017 PDF](https://research.autodesk.com/app/uploads/2023/03/experimental-evaluation-of-sketching.pdf_recSPFZ4RbLaE2Uio.pdf)

### Inferences
- **Improvement: an "elbow on desk" interaction box.** Let the user calibrate a small comfortable region of the camera image, for example the lower-middle 40% (hand at chest or desk height), and map it to the full canvas (gain > 1). The presence/embodiment cost found in the KIT study matters less on a 2D monitor than in VR.
- **Improvement: clutch/re-center.** Releasing the pinch and moving the hand should not move the canvas cursor ("ratchet", like lifting a mouse). Add a re-center gesture or key that resets the mapping origin to the current hand position (ProxyHand-like offset).
- **Improvement: speed-dependent gain** (pointer acceleration, CD gain): slow hand motion gives fine control, fast motion covers distance. This reduces arm amplitude. It combines well with the 1€ filter.
- **Improvement: offload continuous modes to voice/keys/off hand**, so the dominant arm drops between strokes. Fade the UI and pause cleanly when hands leave the frame (Meta: don't penalize pausing).
- **Measuring CE from a webcam:** CE needs the arm's shoulder-relative position and the torque at the shoulder. MediaPipe Pose (which gives shoulder/elbow/wrist landmarks) could approximate shoulder elevation angle and arm extension, but this is an approximation. Borg CR10 or NASA-TLX physical demand are simpler subjective alternatives.

### Gaps
- CE's formula and endurance model constants were not retrieved from the original paper (the full text wasn't accessible). Check the ACM DL before implementing.
- KIT ProxyHand exact paper title/venue not found.
- No study found on fatigue for webcam (non-HMD) desktop mid-air sketching specifically.

## 5. Stroke beautification, snapping, and recognition ($1/$P, curve fitting, constraint inference)

### Takeaway
A practical pipeline: filter the raw samples (1€ filter), smooth the stroke (lazy-mouse style), recognize primitives (line/arc/circle/rectangle) by geometric fitting or $-family recognizers on the stroke projected to the glass plane, snap to existing geometry (endpoints, planes, axes), and keep the raw stroke so the user can undo the beautification. Research cautions that aggressive guidance can reduce stroke quality and that 2D smoothing assumptions may not hold in 3D.

### Cited Findings
- 1€ filter (Casiez, Roussel, Vogel; CHI 2012) is a first-order low-pass filter whose cutoff adapts to speed. A low cutoff at low speed reduces jitter, and the cutoff rises with speed to reduce lag. It has two parameters (mincutoff, beta). The authors suggest starting with mincutoff ≈ 1 Hz, tuning beta first, then adjusting for slow-motion jitter and fast-motion lag. The paper reports less lag than other filters at the same jitter reduction. TypeScript/JS implementations exist (npm "1eurofilter"). — [Casiez 1€ page](https://cristal.univ-lille.fr/~casiez/1euro); [HAL paper](https://hal.archives-ouvertes.fr/hal-00670496); [npm](https://www.npmjs.com/package/1eurofilter)
- The $1 recognizer (Wobbrock, Wilson, Li 2007) is a 2-D single-stroke recognizer for rapid prototyping. $P (Vatavu, Anthony, Wobbrock; ICMI 2012) treats gestures as point clouds and ignores stroke number, order, and direction. It matches $1 on unistrokes and beats $N on multistrokes. $Q is a faster variant (reported 142× speedup). JavaScript source code is available under a BSD license. — [$-family project page](https://depts.washington.edu/acelab/proj/dollar/index.html); [$P page](https://depts.washington.edu/acelab/proj/dollar/pdollar.html)
- Multiplanes beautifies strokes toward the most likely intended shape during drawing, and offers explicit trigger points. — [Multiplanes](https://vvise.iat.sfu.ca/pubs/machuca2018multiplanes)
- Arora et al.: tracing over curves hurts aesthetics. They also note their results contrast with the assumptions behind 2D curve smoothing (they cite Elasticurves), so novel stroke processing methods may be needed. Their reference list also cites piecewise clothoid sketching (McCrae & Singh 2008) and True2Form 3D curve-network regularization (Xu et al. 2014). — [Arora et al. 2017 PDF](https://research.autodesk.com/app/uploads/2023/03/experimental-evaluation-of-sketching.pdf_recSPFZ4RbLaE2Uio.pdf)
- Open Brush's Lazy Input auto-smooths freehand strokes like ZBrush's Lazy Mouse. Open Brush also supports snapping strokes to guides and only along selected axes. — [CG Channel on Open Brush](https://www.cgchannel.com/2022/02/download-free-virtual-reality-3d-sketching-app-open-brush/); [Open Brush docs](https://docs.openbrush.app/differences-between-open-brush-and-tilt-brush)

### Inferences
- **Improvement: a 3-stage stroke pipeline.** (1) Apply the 1€ filter per landmark at capture. (2) Apply lazy-string smoothing: the pen point follows the cursor only when it is farther than radius r away. (3) At stroke end, run a primitive fitter on the 2D projection in the glass plane. Least-squares line fit, accepted if max deviation / length < ε. Algebraic circle fit (Kasa/Taubin) for circles and arcs, accepted if radial RMS / r < ε and closure gap is small. Corner detection (for example a ShortStraw-style approach) for polylines and rectangles. $P works for symbol-like shapes (star, arrow, triangle) and for command gestures. Geometric fitting is better than template matching for parametric primitives, because $1/$P normalize away size and orientation.
- **Improvement: constraint inference/snapping.** Snap endpoints to nearby endpoints (closing loops fixes Arora's "circle endpoints don't meet" failure). Snap near-axis lines to x/y/z axes within ~5–10° and near-parallel lines to existing directions. Show the inferred constraint as a ghost before committing (Smart3DGuides style). Keep beautification undoable in one gesture and keep the raw stroke stored.
- **Improvement: per-mode beautification.** Leave freeform mode raw except for smoothing. In controlled mode, apply snapping and primitives. This matches the freeform/controlled toggle designers asked for.

### Gaps
- No found study quantifies $1/$P accuracy on mid-air webcam strokes, which are much noisier than touch strokes.
- Specific beautification-accuracy numbers from Multiplanes not retrieved.

## 6. Evaluation methods suitable for a student project

### Takeaway
A small within-subjects study (about 8–16 participants) comparing the baseline against improved techniques, using task completion time, accuracy (distance to a target shape), error counts (accidental strokes and undos), SUS, NASA-TLX, and a fatigue measure (CE approximation or subjective rating), is consistent with how the cited papers evaluated similar techniques.

### Cited Findings
- SUS: the average score across about 500 studies is about 68, and above 68 counts as above average. SUS scores are not percentages. Brooke himself published no benchmarks. The 68 figure comes from later aggregation (Sauro/MeasuringU). — [MeasuringU SUS](https://www.measuringu.com/sus/); [UXPA Magazine](https://oldmagazine.uxpa.org/sustified)
- Precedent study designs: KIT fatigue study, 21 participants, within-subjects, measuring CE, workload, presence, and embodiment. — [KIT HCI](https://hci.iar.kit.edu/559.php). Arora et al. ran controlled stroke-accuracy studies against target curves, and released data and analysis code on GitHub. — [Arora et al. 2017 PDF](https://research.autodesk.com/app/uploads/2023/03/experimental-evaluation-of-sketching.pdf_recSPFZ4RbLaE2Uio.pdf); [GitHub listing](https://awesome.ecosyste.ms/projects/github.com%2Frarora7777%2Fvrsketchingstudychi17)
- Smart3DGuides evaluated with shape-likeness and stroke-quality measures plus participant ratings. — [Adobe Research](https://research.adobe.com/publication/smart3dguides-making-unconstrained-immersive-3d-drawing-more-accurate)
- Vremiere used interviews, then a prototype, then expert review, which is a lighter qualitative method. — [Vremiere project](https://web.cecs.pdx.edu/~fliu/project/vremiere)

### Inferences
- **Suggested protocol:** tasks such as tracing a target square on the front plane, drawing a circle on the side plane, building a simple chair or box from 6+ strokes, and placing an object at a target depth. Conditions: baseline vs. (hysteresis + 1€ + snapping), or depth via keys vs. push-pull clutch vs. off-hand slider. Counterbalance with a Latin square.
- Metrics:
  - completion time
  - mean/max distance from the target shape (Arora-style)
  - depth error separately from in-plane error
  - accidental-pinch count (strokes undone within 2 s, or strokes under a length threshold)
  - SUS
  - NASA-TLX (raw TLX, unweighted)
  - Borg CR10 or a CE approximation from MediaPipe Pose for fatigue
  - a short semi-structured interview
- Log all landmark streams to replay and compute metrics offline.

### Gaps
- NASA-TLX primary source (Hart & Staveland 1988) and its subscales were not retrieved in this session. The six subscales (mental, physical, and temporal demand; performance; effort; frustration) are standard but uncited here.
- No source found specifying minimum sample sizes for such studies.
