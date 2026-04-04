---
name: ScrollbarMarkerTrack review findings
description: 2026-04-04 review of ScrollbarMarkerTrack - single shared instance across tabs, dual redraw per update, ResizeObserver observe target not updated on reattach
type: project
---

## Key findings
- Editor owns single ScrollbarMarkerTrack, all tabs share it via connectScrollbarMarkerTrack
- setErrorRows/setGitChangedRows each call redraw() separately causing transient inconsistency
- ResizeObserver.observe() target not updated in reattach() (currently safe because leftSlot is stable)
- refreshGitDiffAsync exception catch path does not clear markers
- destroy() method exists but is never called (dead code)
- applyGitDiffHighlight L2634 early return when storeRows===false does not clear markers
