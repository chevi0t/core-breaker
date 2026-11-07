extends Node3D
## プレイヤーとBOTの共通機体。移動・武器・被弾の入口を共有する。
const GRAVITY: float = 34.0
const JUMP_SPEED: float = 17.0 * sqrt(1.6)
var game
var world
var catalog
var team: String = "B"
var index: int = 0
var is_player: bool = false
var callsign: String = ""
var cls: String = "assault"
var next_class: String = ""
var role: String = "plant"
var mech: Dictionary
var loadout: Dictionary
var stats: Dictionary
var slots: Dictionary = {}
var selected: String = "main"
var previous_slot: String = "main"
var switch_time: float = 0.0
var hp: float = 10000.0
var max_hp: float = 10000.0
var alive: bool = true
var downed: bool = false
var down_time: float = 0.0
var respawn_time: float = 0.0
var invulnerable: float = 0.0
var vel: Vector3 = Vector3.ZERO
var yaw: float = 0.0
var pitch: float = 0.0
var boost: float = 100.0
var max_boost: float = 100.0
var overheat: bool = false
var boost_idle: float = 0.0
var on_ground: bool = true
var dash_time: float = 0.0
var dash_dir: Vector3 = Vector3.ZERO
var long_dash: bool = false
var dash_state: String = ""
var flying: bool = false
var flight_speed: float = 0.0
var control_lock: float = 0.0
var mobility_cd: float = 0.0
var zip_route: Dictionary = {}
var zip_cd: float = 0.0
var repairing: bool = false
var pod_time: float = 0.0
var sp_used: bool = false
var planted: bool = false
var stun: float = 0.0
var stun_kind: String = ""
var jump_buffer: float = 0.0
var recoil: float = 0.0
var recoil_yaw: float = 0.0
var recoil_wait: float = 0.0
var recoil_recovery: float = .04
var scoped: bool = false
var scope_step: int = 0
var charger_on: bool = false
var charging: bool = false
var cloak: bool = false
var field_on: bool = false
var barrier_on: bool = false
var escort_on: bool = false
var weak_time: float = 0.0
var weak_mult: float = 1.0
var electric_time: float = 0.0
var jam_time: float = 0.0
var spotted_until: float = 0.0
var transfer: float = 0.0
var transfer_target: String = "base"
var transfer_from_base: bool = false
var spawn_choice: String = "base"
var attack_cd: float = 0.0
var melee_time: float = 0.0
var melee_hits: Dictionary = {}
var target = null
var locked = null
var lock_time: float = 0.0
var lock_lost: float = 0.0
var previous_target: Vector3 = Vector3.ZERO
var firing_until: float = 0.0
var bot_think: float = 0.0
var bot_goal: Vector3 = Vector3.ZERO
var bot_path: PackedVector3Array = PackedVector3Array()
var bot_path_index: int = 0
var bot_path_goal: Vector3 = Vector3.ZERO
var bot_repath: float = 0.0
var bot_stuck: float = 0.0
var bot_last: Vector3 = Vector3.ZERO
var bot_aim: Vector3 = Vector3.ZERO
var bot_use_cd: float = 0.0
var bot_initialized: bool = false
var raid_route: Array = []
var raid_index: int = 0
var score: Dictionary = {"kills":0,"deaths":0,"assists":0,"caps":0,"total":0,"damage":0.0,"heal":0.0,"core":0.0}
var damage_by: Dictionary = {}
var model: Node3D
var legs: Array[Node3D] = []
var gun: Node3D
var weapon_mesh: MeshInstance3D
var second_weapon: MeshInstance3D
var skeleton_node: Skeleton3D
var collision_areas: Array[Area3D] = []
var step_clock: float = 0.0
var hit_flash: float = 0.0
var last_damager = null

func configure(match_node, faction: String, number: int, player_control: bool, class_id: String, config: Dictionary) -> void:
	game = match_node
	world = game.world
	catalog = game.catalog
	team = faction
	index = number
	is_player = player_control
	cls = class_id
	mech = config.duplicate()
	callsign = game.player_name if is_player else ("僚機" if team == game.own_team else "敵機")+"%02d" % (number+1)
	equip(cls)
	_build_model()

func equip(class_id: String) -> void:
	cls = class_id
	loadout = game.loadouts[cls].duplicate() if is_player else catalog.default_loadout(cls)
	if not is_player and game.random_bot_weapons:
		for slot in catalog.SLOTS:
			var choices: Array = catalog.armory[cls][slot]
			loadout[slot] = choices[game.rng.randi_range(0,choices.size()-1)]
	stats = catalog.stats(mech,loadout)
	max_boost = stats.parts.body.boost
	boost = max_boost
	max_hp = catalog.data.classes[cls].get("hp",10000.0)
	slots.clear()
	for slot in catalog.SLOTS:
		var id: String = loadout[slot]
		var w: Dictionary = catalog.weapons[id]
		var mag: int = int(w.get("mag",0))
		var ammo_mul: float = stats.parts.arms.ammo if slot in ["main","sub"] else 1.0
		var reserve: int = maxi(0,int(floor(mag*w.get("mags",0)*ammo_mul+.00000001))-mag)
		slots[slot] = {"id":id,"w":w,"ammo":mag,"reserve":reserve,"max_reserve":reserve,"cd":0.0,"reload":0.0,"spin":0.0,"temp":0.0,"overheat":0.0,"charge":0.0,"hold":0.0,"sp":100.0,"sp_overheat":false,"held":false,"burst":0,"conv":0.0,"shots":0}
	selected = "main"
	previous_slot = "main"
	switch_time = 0.0
	recoil = 0.0
	recoil_yaw = 0.0
	scoped = false
	charger_on = false
	cloak = false
	field_on = false
	barrier_on = false
	escort_on = false
	planted = false
	melee_time = 0.0
	electric_time = 0.0
	jam_time = 0.0
	weak_time = 0.0
	_update_weapon_model()

func spawn(at: String = "base", refill: bool = true) -> void:
	if refill:
		equip(next_class if next_class != "" else cls)
		hp = max_hp
		damage_by.clear()
	elif transfer_from_base and next_class!="" and next_class!=cls:
		var health: float = hp
		equip(next_class)
		hp = minf(health,max_hp)
	var direction: float = -1.0 if team == "B" else 1.0
	var base_z: float = world.spec.baseZ*(-direction)
	var plant = null
	for p in world.plants:
		if p.id == at and p.owner == team:
			plant = p
	if plant != null:
		var back: Vector3 = Vector3(-plant.pos.x,0,base_z-plant.pos.z).normalized()
		var distance: float = game.rng.randf_range(46,52)
		var side: float = game.rng.randf_range(-8,8)
		position = plant.pos+back*distance+Vector3(-back.z,0,back.x)*side
	else:
		position = Vector3(game.rng.randf_range(-18,18),0,base_z+direction*game.rng.randf_range(14,24))
	world.resolve(self)
	position.y = world.terrain_h(position.x,position.z)
	vel = Vector3.ZERO
	on_ground = true
	yaw = 0.0 if team == "B" else PI
	pitch = 0.0
	alive = true
	downed = false
	down_time = 0.0
	respawn_time = 0.0
	invulnerable = 2.0
	stun = 0.0
	stun_kind = ""
	dash_time = 0.0
	long_dash = false
	flying = false
	control_lock = 0.0
	mobility_cd = 0.0
	zip_route.clear()
	zip_cd = 0.0
	repairing = false
	transfer = 0.0
	next_class = ""
	locked = null
	target = null
	bot_path.clear()
	bot_repath = 0.0
	bot_think = 0.0
	if world.spec.has("vs") and world.cores[team].hp < world.spec.vs.death:
		hp = maxf(1,round(max_hp*world.cores[team].hp/world.spec.vs.death))
	_set_collision(true)
	visible = true

func select_slot(slot: String) -> void:
	if not slots.has(slot) or melee_time>0:
		return
	if not zip_route.is_empty() and (slots[slot].w.get("plant",false) or slots[slot].w.type=="artillery"):
		return
	if slot == "sp" and slots.sp.w.type in ["charger","camo","field","barrier","escort"]:
		if repairing or not alive or slots.sp.sp_overheat or slots.sp.cd>0:
			return
		match slots.sp.w.type:
			"charger": charger_on = not charger_on
			"camo": cloak = not cloak
			"field": field_on = not field_on
			"barrier": barrier_on = not barrier_on
			"escort": escort_on = not escort_on
		slots.sp.cd = .5
		return
	if slot == selected:
		return
	if is_player and slots[selected].w.type=="artillery":
		game.cancel_artillery(self)
	previous_slot = selected
	selected = slot
	switch_time = .8/stats.parts.arms.swap
	planted = slots[slot].w.get("plant",false) or slots[slot].w.type in ["artillery","radarTool"]
	if is_player and slots[slot].w.type=="artillery":
		game.map_open = true
		game.artillery_target = position+forward()*minf(100,slots[slot].w.range/2)
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	scoped = false
	scope_step = 0
	game.play_sound("switch",position,self)
	_update_weapon_model()

func short_dash(wish: Vector3) -> bool:
	if overheat or boost<=0 or dash_time>0 or control_lock>0 or stun>0 or repairing or planted or transfer>0 or not zip_route.is_empty():
		return false
	boost = maxf(0,boost-9.6)
	overheat = boost<=0
	boost_idle = 0.0
	dash_dir = (wish if wish.length_squared()>.01 else forward()).normalized()
	dash_time = .24
	long_dash = false
	vel.x = dash_dir.x*stats.dash
	vel.z = dash_dir.z*stats.dash
	if vel.y<0:
		vel.y *= .3
	game.play_sound("dash",position,self)
	return true

func forward() -> Vector3:
	return Vector3(-sin(yaw),0,-cos(yaw))

func aim_dir() -> Vector3:
	var vertical: float = clampf(pitch+recoil,-1.45,1.45)
	return Vector3(-sin(yaw+recoil_yaw)*cos(vertical),sin(vertical),-cos(yaw+recoil_yaw)*cos(vertical))

func muzzle() -> Vector3:
	return position+Vector3(0,2.65,0)+forward()*1.6+Vector3(cos(yaw),0,-sin(yaw))*.8

func tick(dt: float, control: Dictionary) -> void:
	invulnerable = maxf(0,invulnerable-dt)
	hit_flash = maxf(0,hit_flash-dt)
	if not alive:
		if downed:
			down_time -= dt
			if down_time<=0:
				game.combat.wreck(self,last_damager)
		else:
			respawn_time -= dt
			if respawn_time<=0:
				spawn(spawn_choice if is_player else game.bot_spawn(self))
		return
	weak_time = maxf(0,weak_time-dt)
	sp_used = false
	zip_cd = maxf(0,zip_cd-dt)
	electric_time = maxf(0,electric_time-dt)
	jam_time = maxf(0,jam_time-dt)
	if transfer>0:
		transfer -= dt
		if transfer<=0:
			spawn(transfer_target,false)
		return
	var wish: Vector3 = control.get("wish",Vector3.ZERO)
	var boost_held: bool = control.get("boost",false)
	var jump: bool = control.get("jump",false)
	var jump_held: bool = control.get("jump_held",false)
	if not zip_route.is_empty():
		if stun>0 or electric_time>0 or jump and is_player:
			drop_zip(jump)
		else:
			_tick_zip(dt)
			game.combat.tick_weapons(self,dt,control)
			return
	if repairing or planted or electric_time>0:
		wish = Vector3.ZERO
		boost_held = false
		jump = false
		jump_held = false
		vel.x = 0
		vel.z = 0
	jump_buffer = maxf(0,jump_buffer-dt)
	if jump and not on_ground:
		jump_buffer = .3
	if stun>0:
		stun -= dt
		if stun_kind=="down" and not on_ground and jump_held and boost_held and boost>=32:
			boost -= 32
			stun_kind = "roll"
			vel.y = maxf(vel.y,6)
		if stun_kind!="land":
			wish = Vector3.ZERO
			boost_held = false
			jump = false
			jump_held = false
		long_dash = false
	var speed: float = stats.walk
	var direction: Vector3 = wish
	var accel: float = 10.0 if on_ground else 3.0
	var gravity: float = GRAVITY
	dash_state = ""
	charging = charger_on and boost_held and dash_time<=0 and control_lock<=0 and not slots.sp.sp_overheat
	if charging:
		direction = wish if slots.sp.w.get("omni",false) and wish.length_squared()>.01 else forward()
		speed = slots.sp.w.speed
		accel = 6
		dash_time = 0
		long_dash = false
		dash_state = "charge"
		game.combat.spend_sp(self,100.0/slots.sp.w.use*dt)
	elif dash_time>0:
		dash_time -= dt
		speed = stats.dash
		direction = dash_dir
		accel = 30
		gravity *= .35
		boost_idle = 0
		dash_state = "short"
		if dash_time<=0 and boost_held and not overheat:
			long_dash = true
	elif long_dash:
		if not boost_held or overheat or boost<=0:
			long_dash = false
		else:
			speed = stats.cruise
			direction = wish if wish.length_squared()>.01 else forward()
			accel = 2.0 if flying else 8.0
			boost = maxf(0,boost-11.04*dt)
			boost_idle = 0
			dash_state = "long"
			overheat = boost<=0
	var hover: bool = dash_state=="" and jump_held and not on_ground and control_lock<=0 and vel.y<0 and not overheat and boost>0
	if hover:
		dash_state = "hover"
	if dash_state=="":
		boost_idle += dt
		if boost_idle>.5:
			boost = minf(max_boost,boost+50*dt)
		if overheat and boost>=max_boost:
			overheat = false
		if overheat:
			speed = stats.walk*.55
	mobility_cd -= dt
	if flying:
		if control_lock>0:
			control_lock -= dt
			accel = 0
			boost = minf(max_boost,boost+60*dt)
		elif dash_state in ["","hover"]:
			accel = 1.5 if wish.length_squared()>.01 else 0.0
			var horizontal: Vector2 = Vector2(vel.x,vel.z)
			if horizontal.length()>flight_speed:
				horizontal = horizontal.normalized()*flight_speed
				vel.x = horizontal.x
				vel.z = horizontal.y
	if stun>0:
		accel = 10.0 if stun_kind=="land" else .3 if stun_kind in ["down","roll"] else 4.0 if on_ground else 1.0
	var k: float = 1-exp(-accel*dt)
	vel.x = lerpf(vel.x,direction.x*speed,k)
	vel.z = lerpf(vel.z,direction.z*speed,k)
	if jump and on_ground and not overheat and boost>=8.8:
		vel.y = JUMP_SPEED
		on_ground = false
		boost -= 8.8
		boost_idle = 0
		game.play_sound("jump",position,self)
	vel.y -= gravity*dt
	if hover:
		vel.y = maxf(vel.y,-1.2)
		boost = maxf(0,boost-9.6*dt)
		boost_idle = 0
		overheat = boost<=0
	var before: Vector3 = position
	var was_ground: bool = on_ground
	if not world.step_to(self,position.x+vel.x*dt,position.z):
		vel.x = 0
	if not world.step_to(self,position.x,position.z+vel.z*dt):
		vel.z = 0
	if vel.y>0:
		var ceiling: float = world.ceiling_at(position)
		if position.y+vel.y*dt+4>ceiling:
			position.y = ceiling-4
			vel.y = 0
	position.y += vel.y*dt
	var ground: float = world.ground_at(position.x,position.z,position.y-vel.y*dt)
	var moved: float = Vector2(position.x-before.x,position.z-before.z).length()
	var follow: bool = was_ground and vel.y<=0 and position.y-ground<maxf(.3,moved*1.2)
	if position.y<=ground or follow:
		if not was_ground and -vel.y>28 and stun<=0 and jump_buffer<=0:
			stun = minf(1,.5+(-vel.y-28)*.05)
			stun_kind = "land"
		position.y = ground
		vel.y = 0
		on_ground = true
		flying = false
	else:
		on_ground = false
	position.x = clampf(position.x,-world.spec.size[0]+1.3,world.spec.size[0]-1.3)
	position.z = clampf(position.z,-world.spec.size[1]+1.3,world.spec.size[1]-1.3)
	game.combat.tick_weapons(self,dt,control)

func begin_transfer(destination: String = "base") -> void:
	if world.spec.has("vs") or not alive or transfer>0 or not on_ground or stun>0 or repairing or melee_time>0:
		return
	transfer_target = destination
	transfer = minf(10,2.5+maxf(0,stats.weight-4700)*4.5/730)
	transfer_from_base = absf(position.z)>world.spec.baseLine and signf(position.z)==(1 if team=="B" else -1)
	if transfer_from_base:
		transfer *= .5
	vel = Vector3.ZERO
	dash_time = 0
	long_dash = false
	locked = null

func begin_zip() -> bool:
	if not alive or not zip_route.is_empty() or zip_cd>0 or stun>0 or repairing or transfer>0 or planted or melee_time>0 or electric_time>0:
		return false
	var best = null
	var best_t: float = 0
	var distance: float = 3
	for line in world.zips:
		var t: float = clampf((position-line.bottom).dot(line.dir)/line.length,0,.9)
		var d: float = position.distance_to(line.bottom+line.dir*line.length*t)
		if d<distance:
			distance = d
			best = line
			best_t = t
	if best==null:
		return false
	zip_route = {"line":best,"t":best_t,"catch":0.0,"offset":position-best.bottom-best.dir*best.length*best_t,"top":false}
	dash_time = 0
	long_dash = false
	flying = false
	on_ground = false
	return true

func drop_zip(hop: bool = true) -> void:
	if zip_route.is_empty():
		return
	vel = zip_route.line.dir*16*.4
	if hop:
		vel.y = maxf(6,vel.y)
	zip_route.clear()
	zip_cd = .6

func _tick_zip(dt: float) -> void:
	var line: Dictionary = zip_route.line
	on_ground = false
	boost_idle += dt
	if boost_idle>.5:
		boost = minf(max_boost,boost+50*dt)
	if not zip_route.top:
		zip_route.t = minf(1,zip_route.t+16*dt/line.length)
		zip_route.catch = minf(1,zip_route.catch+dt/.2)
		position = line.bottom+line.dir*line.length*zip_route.t+zip_route.offset*(1-zip_route.catch)
		vel = line.dir*16
		zip_route.top = zip_route.t>=1 and zip_route.catch>=1
		return
	var land: Vector3 = line.land
	var delta: Vector3 = land-position
	delta.y = 0
	if delta.length()>16*.7*dt:
		position += delta.normalized()*16*.7*dt
		position.y = maxf(line.top.y,land.y)+.3
		vel = delta.normalized()*16*.7
	else:
		position = land+Vector3(0,.05,0)
		vel = delta.normalized()*3
		zip_route.clear()
		zip_cd = .6

func _set_collision(enabled: bool) -> void:
	for area in collision_areas:
		area.collision_layer = 2 if enabled else 0

func _build_model() -> void:
	model = Node3D.new()
	add_child(model)
	var color: Color = world.team_color(team)
	var series: String = stats.parts.body.series
	var bulk: float = 1.2 if series in ["bulwark","bastion"] else .86 if series in ["swift","harrier"] else 1.0
	for descriptor in [["legs",Vector3(0,.85,0),Vector3(1.65*bulk,1.7,.95)],["body",Vector3(0,2.35,0),Vector3(1.65*bulk,1.4,.95)],["head",Vector3(0,3.55,0),Vector3(1.0*bulk,.9,.9)],["arms",Vector3(0,2.5,0),Vector3(2.5*bulk,.8,.7)]]:
		var area: Area3D = Area3D.new()
		area.position = descriptor[1]
		area.collision_layer = 2
		area.collision_mask = 0
		area.monitoring = false
		area.monitorable = false
		area.set_meta("ref",{"kind":"unit","unit":self,"part":descriptor[0]})
		var collision: CollisionShape3D = CollisionShape3D.new()
		var box: BoxShape3D = BoxShape3D.new()
		box.size = descriptor[2]
		collision.shape = box
		area.add_child(collision)
		add_child(area)
		collision_areas.append(area)
	if not world.visible_geometry:
		return
	skeleton_node = game.geometry.skeleton()
	model.add_child(skeleton_node)
	var skin: Skin = game.geometry.skin()
	for slot in ["head","body","arms","legs"]:
		var mesh: MeshInstance3D = MeshInstance3D.new()
		mesh.name = "Armor_"+slot
		mesh.mesh = game.geometry.mesh_file(catalog.data.geometry.parts[stats.parts[slot].series][slot],color)
		mesh.skin = skin
		mesh.skeleton = NodePath("../Skeleton")
		model.add_child(mesh)
	gun = Node3D.new()
	gun.position = Vector3(1.55,2.5,-.7)
	model.add_child(gun)
	weapon_mesh = MeshInstance3D.new()
	gun.add_child(weapon_mesh)
	second_weapon = MeshInstance3D.new()
	second_weapon.position = Vector3(-1.6,2.6,-.7)
	model.add_child(second_weapon)
	_update_weapon_model()

func _mesh_box(at: Vector3,size: Vector3,color: Color) -> Node3D:
	var mesh: MeshInstance3D = MeshInstance3D.new()
	var shape: BoxMesh = BoxMesh.new()
	shape.size = size
	mesh.mesh = shape
	mesh.material_override = world.material(color)
	mesh.position = at
	model.add_child(mesh)
	return mesh

func _update_weapon_model() -> void:
	if weapon_mesh == null or not slots.has(selected):
		return
	var w: Dictionary = slots[selected].w
	weapon_mesh.mesh = game.geometry.mesh_file(catalog.data.geometry.weapons[slots[selected].id],world.team_color(team))
	second_weapon.mesh = weapon_mesh.mesh
	second_weapon.visible = w.get("dual",false)
	gun.position = Vector3(1.55,2.5,-.7)
	gun.rotation.x = -.5 if w.type=="sword" else 0.0

func update_visual(dt: float) -> void:
	if model == null:
		return
	model.rotation.y = yaw
	var speed: float = Vector2(vel.x,vel.z).length()
	step_clock += dt*minf(18,speed*.9)
	for i in legs.size():
		legs[i].rotation.x = sin(step_clock+i*PI)*minf(.5,speed*.035) if on_ground else -.25
	if skeleton_node!=null:
		for side in ["L","R"]:
			var phase: float = step_clock+(PI if side=="R" else 0.0)
			var stride: float = sin(phase)*minf(.65,speed*.04) if on_ground else -.3
			skeleton_node.set_bone_pose_rotation(skeleton_node.find_bone("thigh"+side),Quaternion(Vector3.RIGHT,stride))
			skeleton_node.set_bone_pose_rotation(skeleton_node.find_bone("shin"+side),Quaternion(Vector3.RIGHT,maxf(0,-stride)*1.2))
			skeleton_node.set_bone_pose_rotation(skeleton_node.find_bone("arm"+side),Quaternion(Vector3.RIGHT,1.05+pitch*.4))
			skeleton_node.set_bone_pose_rotation(skeleton_node.find_bone("forearm"+side),Quaternion(Vector3.RIGHT,.15))
		skeleton_node.set_bone_pose_rotation(skeleton_node.find_bone("head"),Quaternion(Vector3.RIGHT,pitch*.5))
	model.rotation.x = -1.25 if downed or stun>0 and stun_kind=="down" else .08 if dash_state!="" else 0.0
	model.position.y = -.8 if planted or repairing else 0.0
	if alive:
		model.visible = not cloak or team==game.own_team or int(game.elapsed*12)%4==0
		if invulnerable>0:
			model.visible = int(game.elapsed*12)%2==0
