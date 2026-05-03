---
name: Common bug patterns found in reviews
description: Recurring structural defects - exception catch paths missing state cleanup, early return paths leaving stale markers/caches
type: project
---

## Pattern: Exception catch paths missing state cleanup
- refreshGitDiffAsync catches gitStatusAsync error and returns without clearing currentGitChangedStoreRows
- Result: stale markers remain visible after git communication failure

## Pattern: Early return paths leaving stale state
- applyGitDiffHighlight L2634: storeRows===false early return without clearing git changed markers
- General: any method that has multiple return paths should ensure all mutable state is consistent at each exit point

## Pattern: Dual update causing transient inconsistency
- When two related pieces of state are updated via separate setter calls that each trigger redraw, the intermediate state after the first call but before the second is visible
- ScrollbarMarkerTrack: setErrorRows + setGitChangedRows each call redraw(), so between the two calls the canvas shows mixed old/new data
