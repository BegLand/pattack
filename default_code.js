//even with 400ms, can attack smooth
load_code("pattack")
var attack_mode=true
setInterval(function(){

        heal();
	loot();

	if(!attack_mode || character.rip || is_moving(character)) return;

	var target=get_targeted_monster();
	if(!target)
	{
		target=get_nearest_monster({min_xp:100,max_att:120});
		if(target) change_target(target);
		else
		{
			set_message("No Monsters");
			return;
		}
	}
	
	if(!is_in_range(target))
	{
		move(
			character.x+(target.x-character.x)/2,
			character.y+(target.y-character.y)/2
			);
		// Walk half the distance
	}
	else if(is_in_range(target))
	{
		set_message("Attacking");
		attack(target);
	}

},400); // Loops every 1/4 seconds.
