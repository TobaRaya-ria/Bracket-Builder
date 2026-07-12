# Prabowo look mechanics

Prabowo is a compact pixel-art humanoid with a separate head, visible pupils and brows, a rigid navy suit, red tie, lapel pins, planted shoes, and no held prop. The natural look motion is persona-preserving: keep the shoes, hips, torso scale, suit, tie, and medals anchored; let the eyes lead, then follow with a small near-rigid head/neck turn and restrained shoulder shift. Preserve facial proportions, hair silhouette, calm confident expression, and the original eye construction. Do not warp the skull, slide loose pupils outside the eye apertures, or rotate/tilt the whole sprite.

## Motion budget

Each 22.5-degree step moves the pupils/eye surfaces, eyelids/brows, nose-facing cue, head angle, and shoulders by one small even increment. The feet and lower body stay registered. Head-size, body-height, baseline, palette, pixel scale, outline weight, suit geometry, tie, and medals do not pop or change. The suit and attached details follow the torso rigidly; there is no prop lag.

## Cardinal pose families

- **000 up:** Both shoes and torso remain planted and frontal. Pupils move toward the top of their original eye apertures, upper eyelids open slightly, brows lift subtly, chin rises a little, and the forehead/hair relationship shows a restrained upward head pitch. Both body sides remain similarly visible.
- **090 screen-right:** Pupils, nose tip, face center, and chin shift unmistakably toward the viewer's screen-right. The head turns slightly right, exposing a little more of the screen-left cheek/ear while the screen-right cheek narrows; shoulders follow minimally. The tie and medals stay attached to the suit.
- **180 down:** The body remains frontal and planted. Pupils move toward the bottom of the eye apertures, upper lids lower slightly, brows angle down, chin tucks, and a little less neck/shirt is visible. Both body sides remain similarly visible.
- **270 screen-left:** Exact semantic inverse of 090. Pupils, nose tip, face center, and chin shift unmistakably toward screen-left. The head turns left, exposing a little more of the screen-right cheek/ear while the screen-left cheek narrows; shoulders follow minimally. The tie and medals stay attached.

## Intermediate and boundary continuity

Diagonals blend the neighboring cardinal families evenly. The right-half row progresses up → right → down without backtracking; the left-half row progresses down → left → up. The 157.5-to-180 and 337.5-to-000 boundaries must be one ordinary step. Keep the confident identity and readable pixel-art silhouette in every pose; no neutral/front pose, replacement eyes, whole-body rocking, detached effects, shadows, text, or guide marks.
