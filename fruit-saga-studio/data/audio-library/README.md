# Licensed audio library (optional)

Out of the box every music bed and sound effect is **generated procedurally**
with FFmpeg — original audio, no copyright issues. To use your own
**properly licensed** files instead, drop them here. They are picked by file-name prefix:

```
music/dark-epic_main-theme.mp3      → used when the episode mood is "dark-epic"
music/tense_drone.wav               → mood "tense"
music/whimsical_…  music/heroic_…   → other moods (set per series or per episode tone)

sfx/footsteps_gravel.wav            → cue type "footsteps"
sfx/sword_…  sfx/magic_…  sfx/hit_…  sfx/whoosh_…  sfx/creature_…  sfx/riser_…
sfx/heartbeat_…  sfx/thunder_…  sfx/creak_…  sfx/clank_…  sfx/rustle_…
sfx/wind_…  sfx/rain_…  sfx/forest_ambience_…  sfx/village_ambience_…
sfx/fire_ambience_…  sfx/water_ambience_…  sfx/cave_ambience_…
```

Several files with the same prefix rotate between cues. Music is looped/trimmed
to the episode length and automatically ducked under the narration.

Never use soundtrack recordings from films or games you do not have a licence for.
The contents of `music/` and `sfx/` are git-ignored.
