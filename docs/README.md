# FormFlow Documentation

**Project:** FormFlow - From Gesture to Geometry  
**Type:** Computer Vision / Rapid 3D Prototyping  
**Course:** Introduction to Computer Vision  
**Author:** Solo project  
**Scope:** OpenCV, MediaPipe Hands, Open3D, geometry (no custom AI/ML training)

---

## Documents

| Document | Description |
| -------- | ----------- |
| [Idea Brief](./idea-brief.md) | Concise proposal: problem, solution, stack, workflow, architecture, expected output |
| [Product Requirements (PRD)](./prd.md) | Full product definition, modes, requirements, MVP, phases, evaluation |
| [System Architecture](./architecture.md) | Component design, data flow, reconstruction approach |
| [Computer Vision Pipeline](./pipeline.md) | Hand tracking, stroke processing, contours, multi-view alignment |

### Execution plan

| Document | Description |
| -------- | ----------- |
| [Roadmap](./plan/00-roadmap.md) | Phases, parallel tracks, MVP definition, cut lines |
| [Feature catalog](./plan/features.md) | Every feature with ID, priority, phase, PRD traceability |
| [Master checklist](./plan/checklist.md) | One-page tick list, demo-day checklist |
| [Tech spec](./plan/tech-spec.md) | Environment, repo layout, coordinate conventions, gestures, parameters |
| [Decisions & risks](./plan/decisions-and-risks.md) | Decisions, risk register, open questions |
| Phase docs | [`plan/phases/`](./plan/phases/) phases 0-9 with task-level checklists |

---

## One-line definition

FormFlow is a webcam-based computer vision application that uses hand gestures as a virtual pencil to either sketch in 3D or draw Front, Top, and Side views, then reconstructs an approximate interactive 3D prototype using image processing and multi-view geometry.

**Core principle:** Draw it. Reconstruct it. Experience it.

---

## Presentation

Slide deck for the idea presentation: [`../ppt.html`](../ppt.html)
