# Ranking flags

Items below item level 50 that are among a slot's 3 best for a build, starting from empty gear. Each is either
truly special or valued wrongly by the simulator: look at how its effect works before trusting it. Written by
`scripts/check-rankings.ts` after every measurement; do not edit by hand. An item that is fine goes into
`src/config/sim-issues.json` under "fine" and leaves this list; one that is wrong goes under "wrong" and is kept out of the lists.

- Oathbound Bracers (274599, rare 39, wrist): top 3 for 8 builds (Enhancement Shaman #3, Rogue: Combat SS #2, Rogue: Combat BS #3, …)
- Flurry Axe (871, epic 47, weapon): top 3 for 6 builds (Warrior: Fury (Pre-BiS) #1, Rogue: Combat SS #1, Rogue: Combat Venom #1, …); its effect is measured at up to 28.3
- Gloves of Holy Might (867, epic 42, hands): top 3 for 6 builds (Rogue: Combat SS #3, Rogue: Combat BS #2, Rogue: Combat Venom #2, …); its effect is measured at up to 8.7
- Gut Ripper (2164, epic 45, weapon): top 3 for 2 builds (Rogue: Subtlety Hemo #3, Hunter: Survival (melee) #3); its effect is measured at up to 8.9
- Precisely Calibrated Boomstick (2100, epic 48, ranged): top 3 for 2 builds (Rogue: Asn Muti #3, Hunter: Survival (melee weave) #2)
- Kang the Decapitator (2291, epic 49, weapon): top 3 for 1 build (Hunter: Survival (melee weave) #3); its effect is measured at up to 15.9
