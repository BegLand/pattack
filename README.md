Just add to your existing scripts like the following.

    load_code("pattack")

Should override standard attack and use_skill.

Do not use can_attack(), use is_in_range() only.
Do not break on measured cooldowns or influence cooldowns.
