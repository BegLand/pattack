Just add to your existing scripts like the following.

    load_code("pattack")

Should override standard attack and use_skill.

Do not use any cooldown management code.
That means:
- No reduce_cooldowns
- No is_on_cooldown()
- No can_attack()

Only range check allowed
