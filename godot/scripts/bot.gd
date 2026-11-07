extends RefCounted
## 索敵は視線・レーダー・設置物の情報を使う。操作はプレイヤーと共通。
var game

func _init(match_node) -> void:
	game = match_node

func control(unit,dt: float) -> Dictionary:
	var result: Dictionary = {"wish":Vector3.ZERO,"fire":false,"boost":false,"jump":false,"jump_held":false,"alt":false}
	if not unit.alive:
		return result
	var world = game.world
	unit.bot_think -= dt
	unit.bot_repath -= dt
	unit.bot_use_cd -= dt
	var enemy_core: Dictionary = world.cores["R" if unit.team=="B" else "B"]
	if not unit.bot_initialized:
		unit.bot_initialized = true
		unit.bot_goal = unit.position
		if world.spec.has("raidRoutes") and unit.role=="attack":
			var routes: Array = world.spec.raidRoutes
			if not routes.is_empty():
				var route: Dictionary = routes[unit.index%routes.size()]
				unit.raid_route = route.get("pointsR",route.points) if unit.team=="R" else route.points
	if unit.bot_think<=0:
		unit.bot_think = .18+game.rng.randf()*.12
		unit.target = null
		var nearest: float = 105.0
		for candidate in game.units:
			if not candidate.alive or candidate.team==unit.team:
				continue
			var distance: float = unit.position.distance_to(candidate.position)
			var noticed: bool = distance<(105 if candidate.spotted_until>game.elapsed else 70)
			if candidate.cloak and candidate.spotted_until<game.elapsed and distance>12:
				noticed = false
			if noticed and distance<nearest and game.combat.can_see(unit.position+Vector3(0,3,0),candidate.position+Vector3(0,2.4,0)):
				nearest = distance
				unit.target = candidate
		unit.bot_goal = _goal(unit,enemy_core)
	var target = unit.target
	var aim: Vector3 = unit.bot_goal+Vector3(0,2.5,0)
	if is_instance_valid(target) and target.alive:
		aim = target.position+Vector3(0,2.6,0)
		var factor: float = 1-exp(-dt*(5.0 if target.dash_state=="short" else 11.0))
		unit.bot_aim = unit.bot_aim.lerp(aim,factor) if unit.bot_aim!=Vector3.ZERO else aim
		aim = unit.bot_aim
		var distance: float = unit.position.distance_to(target.position)
		var to_target: Vector3 = aim-unit.muzzle()
		var desired_yaw: float = atan2(-to_target.x,-to_target.z)
		unit.yaw = lerp_angle(unit.yaw,desired_yaw,minf(1,dt*8))
		unit.pitch = lerpf(unit.pitch,atan2(to_target.y,Vector2(to_target.x,to_target.z).length()),minf(1,dt*8))
		var sp_type: String = unit.slots.sp.w.type
		if unit.bot_use_cd<=0:
			unit.bot_use_cd = 1.2
			if unit.cls=="support" and sp_type=="repair" and unit.hp<unit.max_hp*.6:
				unit.select_slot("sp")
			elif distance<6 and unit.slots.aux.w.type=="sword":
				unit.select_slot("aux")
			elif distance>35 and unit.slots.sub.w.has("scope"):
				unit.select_slot("sub")
				unit.scoped = true
			elif distance>14 and distance<55 and unit.slots.sub.w.has("proj") and unit.slots.sub.ammo>0 and game.rng.randf()<.35:
				unit.select_slot("sub")
			else:
				unit.select_slot("main")
			if sp_type in ["barrier","camo","escort"] and not unit.slots.sp.sp_overheat:
				if not unit.barrier_on and not unit.cloak and not unit.escort_on:
					unit.select_slot("sp")
		var angular: float = absf(wrapf(desired_yaw-unit.yaw,-PI,PI))
		var w: Dictionary = unit.slots[unit.selected].w
		var ready: bool = unit.recoil<atan2(1.2,maxf(1,distance)) and absf(unit.recoil_yaw)<atan2(1.2,maxf(1,distance))
		result.fire = angular<.14 and ready and game.combat.can_see(unit.muzzle(),aim)
		if w.has("chargeTime"):
			result.fire = result.fire and unit.slots[unit.selected].charge<w.chargeTime
		unit.locked = target if distance<unit.stats.parts.head.lock and not w.get("noLock",false) else null
		if unit.selected=="sp" and sp_type=="repair":
			result.alt = true
			result.fire = false
		if world.spec.has("vs") or unit.role!="attack" and unit.position.distance_to(unit.bot_goal)>30:
			unit.bot_goal = target.position
		if distance<28:
			var sideways: Vector3 = Vector3(cos(unit.yaw),0,-sin(unit.yaw))*(1 if int(game.elapsed/2+unit.index)%2==0 else -1)
			result.wish = sideways
			if distance<12:
				result.wish = (sideways-unit.forward()).normalized()
	elif not world.spec.has("vs") and unit.role=="attack" and unit.position.distance_to(Vector3(enemy_core.pos.x,0,enemy_core.pos.z))<40:
		var side: float = 1 if unit.index%2==0 else -1
		aim = enemy_core.pos+Vector3(side*5.5,0,0)
		var to_core: Vector3 = aim-unit.muzzle()
		unit.yaw = atan2(-to_core.x,-to_core.z)
		unit.pitch = atan2(to_core.y,Vector2(to_core.x,to_core.z).length())
		unit.select_slot("main")
		result.fire = true
		unit.locked = null
	else:
		unit.locked = null
		var direction: Vector3 = unit.bot_goal-unit.position
		if direction.length()>2:
			unit.yaw = lerp_angle(unit.yaw,atan2(-direction.x,-direction.z),minf(1,dt*5))
		unit.pitch = lerpf(unit.pitch,0,minf(1,dt*4))
		_support(unit,result,dt)
	if result.wish.length_squared()<.01 and unit.position.distance_to(unit.bot_goal)>4:
		result.wish = _steer(unit,dt)
	if unit.bot_stuck>.5 and unit.on_ground and unit.boost>25:
		result.jump = true
		unit.short_dash(result.wish)
		unit.bot_stuck = 0
	if unit.bot_goal.y>unit.position.y+1.5 and not unit.on_ground:
		result.jump_held = true
	if not unit.scoped and result.wish.length_squared()>.01 and not unit.repairing:
		result.boost = unit.boost>20 and unit.position.distance_to(unit.bot_goal)>18 and not result.fire
		if result.boost and unit.dash_time<=0 and not unit.long_dash:
			unit.short_dash(result.wish)
	if not result.has("aim"):
		result.aim = aim
	return result

func _goal(unit,enemy_core: Dictionary) -> Vector3:
	var world = game.world
	if unit.hp<unit.max_hp*.35:
		var nearest = game.nearest_pod(unit)
		if nearest!=null:
			return nearest.pos
	if world.spec.has("vs"):
		if is_instance_valid(unit.target):
			return unit.target.position
		return Vector3(-25 if unit.index%2==0 else 25,0,-30 if unit.team=="B" else 30)
	if unit.role=="defend":
		for radar in world.facilities:
			if radar.kind=="radar" and radar.team==unit.team and radar.alive:
				for enemy in game.units:
					if enemy.alive and enemy.team!=unit.team and absf(enemy.position.z)>world.spec.baseLine and signf(enemy.position.z)==(1 if unit.team=="B" else -1):
						if unit.position.distance_to(enemy.position)>150 and unit.transfer<=0:
							unit.begin_transfer("base")
						return enemy.position
		var s: float = 1 if unit.team=="B" else -1
		return Vector3((unit.index%3-1)*18,0,s*(world.spec.baseZ-35))
	if unit.role=="attack":
		if unit.raid_index<unit.raid_route.size():
			var waypoint: Vector3 = world.nav_vector(unit.raid_route[unit.raid_index])
			if unit.position.distance_to(waypoint)<8:
				unit.raid_index += 1
			else:
				return waypoint
		return Vector3(11 if unit.index%2==0 else -11,world.terrain_h(11,enemy_core.pos.z),enemy_core.pos.z+(9 if unit.team=="B" else -9))
	var goal: Vector3 = enemy_core.pos
	var best: float = INF
	for plant in world.plants:
		if plant.owner==unit.team:
			continue
		var distance: float = unit.position.distance_to(plant.pos)
		if distance<best:
			best = distance
			goal = plant.pos+Vector3((unit.index%3-1)*5,0,3)
	return goal

func _steer(unit,dt: float) -> Vector3:
	var world = game.world
	var goal: Vector3 = unit.bot_goal
	if unit.bot_repath<=0 and (unit.bot_path.is_empty() or unit.bot_path_index>=unit.bot_path.size() or unit.bot_path_goal.distance_to(unit.bot_goal)>18 or unit.bot_stuck>.4):
		unit.bot_repath = 1.2+game.rng.randf()*.4
		unit.bot_path_goal = unit.bot_goal
		if unit.position.distance_to(goal)<50 and world.walk_clear(unit.position,goal):
			unit.bot_path = PackedVector3Array([goal])
		else:
			unit.bot_path = world.path_between(unit.position,goal)
		unit.bot_path_index = 0
	while unit.bot_path_index<unit.bot_path.size():
		var point: Vector3 = unit.bot_path[unit.bot_path_index]
		if Vector2(point.x-unit.position.x,point.z-unit.position.z).length()<3 and absf(point.y-unit.position.y)<2:
			unit.bot_path_index += 1
		else:
			goal = point
			break
	# 乗降設備の入口へ接近し、最終的な床へ抜ける。
	if goal.y>unit.position.y+6:
		var best: float = INF
		for pad in world.pads:
			if absf(pad.exit.y-goal.y)>3:
				continue
			var cost: float = unit.position.distance_to(pad.pos)+pad.exit.distance_to(goal)
			if cost<best and unit.on_ground:
				best = cost
				goal = pad.pos
		for lift in world.lifts:
			if absf(lift.to.y-unit.bot_goal.y)>3:
				continue
			var cost: float = unit.position.distance_to(lift.from)+lift.to.distance_to(unit.bot_goal)
			if cost<best and unit.position.y<lift.to.y-1:
				best = cost
				goal = lift.from if unit.position.y<lift.from.y+1 else lift.pos
		for line in world.zips:
			if absf(line.top.y-unit.bot_goal.y)>3:
				continue
			var cost: float = unit.position.distance_to(line.bottom)+line.land.distance_to(unit.bot_goal)
			if cost<best and unit.position.y<line.top.y-1:
				best = cost
				goal = line.bottom
				if unit.position.distance_to(line.bottom)<2.5:
					unit.begin_zip()
	var dir: Vector3 = goal-unit.position
	dir.y = 0
	var moved: float = unit.position.distance_to(unit.bot_last)
	unit.bot_stuck = unit.bot_stuck+dt if moved<dt*2 and dir.length()>5 else maxf(0,unit.bot_stuck-dt)
	unit.bot_last = unit.position
	return dir.normalized()

func _support(unit,result: Dictionary,_dt: float) -> void:
	if unit.slots.sp.w.type=="repair" and not unit.slots.sp.sp_overheat:
		var target = null
		var nearest: float = unit.slots.sp.w.range
		for ally in game.units:
			if ally.team!=unit.team or not ally.alive and not ally.downed or ally.hp>=ally.max_hp*.95:
				continue
			var distance: float = unit.position.distance_to(ally.position)
			if distance<nearest:
				nearest = distance
				target = ally
		if target!=null:
			unit.select_slot("sp")
			result.fire = target!=unit
			result.alt = target==unit
			result.aim = target.position+Vector3(0,2,0)
	elif unit.bot_use_cd<=0 and unit.slots.aux.w.type=="gun" and unit.slots.aux.ammo>0:
		unit.bot_use_cd = game.rng.randf_range(8,16)
		unit.select_slot("aux")
		result.fire = true
		result.aim = unit.position+unit.forward()*8
