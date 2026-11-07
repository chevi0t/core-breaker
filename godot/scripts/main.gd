extends Node3D
const Catalog = preload("res://scripts/catalog.gd")
const MapWorld = preload("res://scripts/world.gd")
const MechUnit = preload("res://scripts/unit.gd")
const BattleCombat = preload("res://scripts/combat.gd")
const BotDriver = preload("res://scripts/bot.gd")
const BattleUI = preload("res://scripts/ui.gd")
const Geometry = preload("res://scripts/geometry.gd")
const BOT_CLASSES = ["assault","support","heavy","assault","raid","heavy","support","raid","assault","heavy"]
const BOT_ROLES = ["attack","plant","defend","attack","plant","plant","attack","defend","plant","attack"]
var catalog
var world
var combat
var bot
var geometry
var ui
var units: Array = []
var player = null
var camera: Camera3D
var rng: RandomNumberGenerator = RandomNumberGenerator.new()
var playing: bool = false
var paused: bool = false
var ended: bool = false
var all_bots: bool = false
var random_bot_weapons: bool = true
var own_team: String = "B"
var player_name: String = "パイロット"
var chosen_class: String = "assault"
var pilot_index: int = 0
var large_demo: bool = false
var map_id: String = "wide"
var mech: Dictionary
var loadouts: Dictionary = {}
var options: Dictionary = {"master":.65,"sfx":.65,"music":.25,"fov":70.0,"sensitivity":1.0,"hud":"arcade"}
var elapsed: float = 0.0
var time_left: float = 0.0
var capture_events: int = 0
var feed: Array[Dictionary] = []
var hit_marker: float = 0.0
var map_open: bool = false
var artillery_target: Vector3 = Vector3.ZERO
var artillery_confirm: bool = false
var pressed: Dictionary = {}
var mouse_pressed: bool = false
var alt_pressed: bool = false
var killcam_target = null
var report_path: String = ""
var auto_seconds: float = 0.0
var audio_cache: Dictionary = {}
var audio_pool: Array[AudioStreamPlayer] = []
var audio_cooldowns: Dictionary = {}
var music: AudioStreamPlayer
var render_enabled: bool = true

class TurretOwner:
	extends RefCounted
	var team: String
	var position: Vector3
	var callsign: String = "防衛砲台"
	var is_player: bool = false
	var alive: bool = true
	var collision_areas: Array = []
	var score: Dictionary = {"damage":0.0,"kills":0,"deaths":0,"assists":0,"caps":0,"heal":0.0,"total":0,"core":0.0}

func _ready() -> void:
	catalog = Catalog.new()
	geometry = Geometry.new(catalog)
	rng.seed = 20261021
	mech = catalog.data.mechDefault.duplicate()
	for cls in Catalog.CLASS_IDS:
		loadouts[cls] = catalog.default_loadout(cls)
	_load_settings()
	render_enabled = DisplayServer.get_name()!="headless"
	_setup_environment()
	ui = BattleUI.new()
	ui.configure(self)
	add_child(ui)
	bot = BotDriver.new(self)
	var args: PackedStringArray = OS.get_cmdline_user_args()
	if args.has("--autoplay"):
		map_id = argument(args,"--map","wide")
		auto_seconds = float(argument(args,"--seconds","120"))
		report_path = argument(args,"--report","")
		rng.seed = int(argument(args,"--seed","20261021"))
		start_match(map_id,true)
	else:
		ui.show_menu()

func argument(args: PackedStringArray,key: String,fallback: String) -> String:
	var index: int = args.find(key)
	return args[index+1] if index>=0 and index+1<args.size() else fallback

func _setup_environment() -> void:
	var sky: WorldEnvironment = WorldEnvironment.new()
	var environment: Environment = Environment.new()
	environment.background_mode = Environment.BG_COLOR
	environment.background_color = Color("637c91")
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	environment.ambient_light_color = Color("b3c6d2")
	environment.ambient_light_energy = .35
	environment.tonemap_mode = Environment.TONE_MAPPER_LINEAR
	sky.environment = environment
	add_child(sky)
	var sun: DirectionalLight3D = DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-52,-25,0)
	sun.light_energy = .85
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 180
	add_child(sun)
	camera = Camera3D.new()
	camera.far = 1800
	camera.near = .2
	camera.current = true
	add_child(camera)
	music = AudioStreamPlayer.new()
	music.stream = load("res://assets/audio/bgm.ogg")
	if music.stream is AudioStreamOggVorbis:
		music.stream.loop = true
	add_child(music)

func _exit_tree() -> void:
	# 終了時にミキサー側へ再生を残さない。
	if is_instance_valid(music):
		music.stop()
		music.stream = null
	for voice in audio_pool:
		if is_instance_valid(voice):
			voice.stop()
			voice.stream = null
	audio_cache.clear()

func start_match(id: String,autoplay: bool = false) -> void:
	if not catalog.maps.has(id):
		push_error("マップが存在しません: "+id)
		return
	playing = false
	for unit in units:
		unit.free()
	units.clear()
	player = null
	if is_instance_valid(combat):
		combat.free()
	if is_instance_valid(world):
		world.free()
	world = MapWorld.new()
	add_child(world)
	world.configure(catalog.maps[id],own_team,render_enabled)
	world.build_ziplines()
	combat = BattleCombat.new()
	add_child(combat)
	combat.configure(self)
	map_id = id
	all_bots = autoplay
	var count: int = 50 if large_demo and world.spec.get("group","")=="tidal" else int(world.spec.team)
	for faction in [own_team,"R" if own_team=="B" else "B"]:
		for i in count:
			var is_human: bool = faction==own_team and i==0 and not autoplay
			var cls: String = chosen_class if is_human else BOT_CLASSES[i%BOT_CLASSES.size()]
			var unit = MechUnit.new()
			add_child(unit)
			unit.configure(self,faction,i,is_human,cls,mech if is_human else catalog.random_mech(cls,rng))
			unit.role = BOT_ROLES[i%BOT_ROLES.size()]
			units.append(unit)
			if faction==own_team and i==0:
				player = unit
			unit.spawn("base" if is_human else bot_spawn(unit))
	elapsed = 0
	time_left = world.spec.time
	capture_events = 0
	ended = false
	paused = false
	playing = true
	feed.clear()
	killcam_target = null
	pressed.clear()
	ui.show_battle()
	if not autoplay and render_enabled:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	if render_enabled:
		music.volume_db = linear_to_db(maxf(.0001,options.master*options.music))
		music.play()
	_update_camera(0)

func _physics_process(dt: float) -> void:
	if not playing or paused or ended:
		return
	simulate_step(dt)
	if auto_seconds>0 and (elapsed>=auto_seconds or ended):
		write_report()
		get_tree().quit()

func simulate_step(dt: float) -> void:
	if ended:
		return
	elapsed += dt
	time_left -= dt
	hit_marker = maxf(0,hit_marker-dt)
	_update_lifts(dt)
	var controls: Array[Dictionary] = []
	for unit in units:
		controls.append(player_control(unit) if unit.is_player else bot.control(unit,dt))
	_update_pods(dt,controls)
	for i in units.size():
		units[i].tick(dt,controls[i])
	_update_launchers()
	_update_plants(dt)
	_update_facilities(dt)
	combat.step(dt)
	for entry in feed.duplicate():
		entry.life -= dt
		if entry.life<=0:
			feed.erase(entry)
	check_finish()
	pressed.clear()
	mouse_pressed = false
	alt_pressed = false
	artillery_confirm = false

func _process(dt: float) -> void:
	if playing and render_enabled:
		for unit in units:
			unit.update_visual(dt)
		_update_camera(dt)
	ui.queue_redraw()

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		pressed[event.physical_keycode] = true
		if event.physical_keycode in [KEY_ESCAPE,KEY_F3] and playing:
			paused = not paused
			Input.mouse_mode = Input.MOUSE_MODE_VISIBLE if paused else Input.MOUSE_MODE_CAPTURED
			ui.show_pause(paused)
		if event.physical_keycode==KEY_M and playing and not paused:
			map_open = not map_open
		if event.physical_keycode==KEY_F and player!=null and player.downed:
			combat.wreck(player,player.last_damager)
	if not playing or paused or ended or player==null:
		return
	if event is InputEventMouseMotion and Input.mouse_mode==Input.MOUSE_MODE_CAPTURED and player.alive:
		var sensitivity: float = .002*options.sensitivity*(camera.fov/options.fov)
		player.yaw -= event.relative.x*sensitivity
		player.pitch = clampf(player.pitch-event.relative.y*sensitivity,-1.35,1.35)
	if event is InputEventMouseButton and event.pressed:
		if event.button_index==MOUSE_BUTTON_LEFT:
			mouse_pressed = true
			if player.alive and player.slots[player.selected].w.type=="artillery" and map_open:
				var target: Vector3 = ui.map_world_at(event.position)
				if Vector2(target.x-player.position.x,target.z-player.position.z).length()<=player.slots.sp.w.range:
					artillery_target = target
					artillery_confirm = true
		if event.button_index==MOUSE_BUTTON_RIGHT:
			alt_pressed = true
			if player.slots[player.selected].w.type in ["artillery","cannon"]:
				player.select_slot(player.previous_slot if player.previous_slot!="sp" else "main")
			if player.slots[player.selected].w.has("scopeHigh"):
				player.scope_step = (player.scope_step+1)%3
		if event.button_index in [MOUSE_BUTTON_WHEEL_UP,MOUSE_BUTTON_WHEEL_DOWN]:
			if held(KEY_TAB):
				ui.score_scroll += 3 if event.button_index==MOUSE_BUTTON_WHEEL_DOWN else -3
				return
			if not player.alive or player.transfer>0:
				cycle_spawn(1 if event.button_index==MOUSE_BUTTON_WHEEL_DOWN else -1)
			else:
				var i: int = Catalog.SLOTS.find(player.selected)
				i = posmod(i+(1 if event.button_index==MOUSE_BUTTON_WHEEL_DOWN else -1),4)
				player.select_slot(Catalog.SLOTS[i])

func held(key: Key) -> bool:
	return Input.is_physical_key_pressed(key)

func player_control(unit) -> Dictionary:
	var input: Vector2 = Vector2(float(held(KEY_D))-float(held(KEY_A)),float(held(KEY_S))-float(held(KEY_W))).normalized()
	var wish: Vector3 = Vector3(input.x,0,input.y).rotated(Vector3.UP,unit.yaw)
	for i in 4:
		if pressed.has(KEY_1+i):
			unit.select_slot(Catalog.SLOTS[i])
		if pressed.has([KEY_Z,KEY_X,KEY_C,KEY_V][i]):
			unit.next_class = Catalog.CLASS_IDS[i]
	if pressed.has(KEY_R):
		combat.reload_slot(unit,unit.slots[unit.selected])
	if pressed.has(KEY_Q):
		cycle_lock(unit)
	if pressed.has(KEY_H):
		if unit.transfer>0:
			unit.transfer = 0
		else:
			unit.begin_transfer(unit.spawn_choice)
	if pressed.has(KEY_SHIFT):
		unit.short_dash(wish)
	if pressed.has(KEY_E):
		if unit.zip_route.is_empty():
			unit.begin_zip()
		else:
			unit.drop_zip()
	var w: Dictionary = unit.slots[unit.selected].w
	unit.scoped = unit.scope_step>0 if w.has("scopeHigh") else w.has("scope") and Input.is_mouse_button_pressed(MOUSE_BUTTON_RIGHT)
	var from: Vector3 = camera.global_position
	var direction: Vector3 = -camera.global_basis.z
	var hit: Dictionary = combat.ray(from,from+direction*1000,unit)
	var aim: Vector3 = hit.position if not hit.is_empty() else from+direction*1000
	var control: Dictionary = {"wish":wish,"boost":held(KEY_SHIFT),"jump":pressed.has(KEY_SPACE),"jump_held":held(KEY_SPACE),"fire":Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT),"fire_pressed":mouse_pressed,"alt":Input.is_mouse_button_pressed(MOUSE_BUTTON_RIGHT),"alt_pressed":alt_pressed,"aim":aim}
	if w.type=="artillery":
		control.aim = artillery_target
		control.fire = artillery_confirm
	_update_lock(unit,get_physics_process_delta_time())
	return control

func cancel_artillery(unit) -> void:
	for barrage in combat.barrages.duplicate():
		if barrage.owner==unit and barrage.get("launch_at",0)>elapsed:
			combat.barrages.erase(barrage)
	map_open = false
	artillery_confirm = false
	if unit.is_player:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED

func cycle_lock(unit) -> void:
	var candidates: Array = []
	for enemy in units:
		var delta: Vector3 = enemy.position+Vector3(0,2.5,0)-unit.position-Vector3(0,4.6,0)
		if enemy.alive and enemy.team!=unit.team and not enemy.cloak and delta.length()<unit.stats.parts.head.lock and unit.aim_dir().angle_to(delta.normalized())<.5 and combat.can_see(unit.position+Vector3(0,3,0),enemy.position+Vector3(0,2.5,0)):
			candidates.append(enemy)
	if candidates.is_empty():
		unit.locked = null
		return
	var index: int = candidates.find(unit.locked)
	unit.locked = candidates[(index+1)%candidates.size()]
	unit.previous_target = unit.locked.position+Vector3(0,2.5,0)
	unit.lock_lost = 0

func _update_lock(unit,dt: float) -> void:
	if unit.slots[unit.selected].w.get("noLock",false) or unit.jam_time>0:
		unit.locked = null
		return
	if is_instance_valid(unit.locked) and unit.locked.alive:
		var target = unit.locked
		var at: Vector3 = target.position+Vector3(0,2.5,0)
		var delta: Vector3 = at-unit.position-Vector3(0,4.6,0)
		var desired_yaw: float = atan2(-delta.x,-delta.z)
		var desired_pitch: float = atan2(delta.y,Vector2(delta.x,delta.z).length())
		var range_limit: float = unit.stats.parts.head.lock*(1.5 if target.spotted_until>elapsed else 1.0)
		var visible_target: bool = not target.cloak and combat.can_see(unit.position+Vector3(0,3,0),at)
		unit.lock_lost = 0.0 if visible_target else unit.lock_lost+dt
		if delta.length()>range_limit*1.3 or absf(wrapf(desired_yaw-unit.yaw-unit.recoil_yaw,-PI,PI))>.55 or absf(desired_pitch-unit.pitch-unit.recoil)>.6 or unit.lock_lost>.6:
			unit.locked = null
			return
		var old_delta: Vector3 = unit.previous_target-unit.position-Vector3(0,4.6,0)
		var old_yaw: float = atan2(-old_delta.x,-old_delta.z)
		var old_pitch: float = atan2(old_delta.y,Vector2(old_delta.x,old_delta.z).length())
		var scale: float = .35 if target.dash_state=="short" else 1.0
		unit.yaw += clampf(wrapf(desired_yaw-old_yaw,-PI,PI),-4*dt,4*dt)*scale
		unit.pitch += clampf(desired_pitch-old_pitch,-4*dt,4*dt)*scale
		var margin: float = atan2(1.3,maxf(1,delta.length()))
		var offset_yaw: float = wrapf(desired_yaw-unit.yaw-unit.recoil_yaw,-PI,PI)
		var offset_pitch: float = desired_pitch-unit.pitch-unit.recoil
		if absf(offset_yaw)>margin:
			unit.yaw += signf(offset_yaw)*minf(absf(offset_yaw)-margin,.8*dt)*scale
		if absf(offset_pitch)>atan2(1.3,maxf(1,delta.length())):
			unit.pitch += signf(offset_pitch)*minf(absf(offset_pitch)-margin,.8*dt)*scale
		unit.previous_target = at
		return
	unit.locked = null
	var best = null
	var best_angle: float = .13
	for enemy in units:
		if not enemy.alive or enemy.team==unit.team or enemy.cloak:
			continue
		var delta: Vector3 = enemy.position+Vector3(0,2.5,0)-unit.position-Vector3(0,4.6,0)
		if delta.length()>unit.stats.parts.head.lock*(1.5 if enemy.spotted_until>elapsed else 1.0):
			continue
		var angle: float = unit.aim_dir().angle_to(delta.normalized())
		if angle<best_angle and combat.can_see(unit.position+Vector3(0,3,0),enemy.position+Vector3(0,2.5,0)):
			best = enemy
			best_angle = angle
	if best!=null:
		unit.lock_time += dt
		if unit.lock_time>=.15:
			unit.locked = best
			unit.previous_target = best.position+Vector3(0,2.5,0)
			unit.lock_lost = 0
			play_sound("lock",unit.position,unit)
	else:
		unit.lock_time = 0

func _update_camera(dt: float) -> void:
	if player==null:
		return
	var follow = player
	if not player.alive and player.respawn_time>2.5 and is_instance_valid(killcam_target):
		follow = killcam_target
	var pitch: float = player.pitch+player.recoil
	var yaw: float = player.yaw+player.recoil_yaw
	var at: Vector3 = follow.position+Vector3(0,4.6,0)
	var direction: Vector3 = Vector3(-sin(yaw)*cos(pitch),sin(pitch),-cos(yaw)*cos(pitch))
	var desired: Vector3 = at-direction*8+Vector3(cos(yaw),0,-sin(yaw))*2.2
	if combat!=null:
		var wall: Dictionary = combat.ray(at,desired,player,1)
		if not wall.is_empty():
			desired = wall.position+wall.normal*.4
	camera.position = desired
	camera.look_at(desired+direction,Vector3.UP)
	var zoom: float = 1.3 if is_instance_valid(player.locked) else 1.0
	if player.scoped:
		var w: Dictionary = player.slots[player.selected].w
		zoom = w.get("scopeHigh",w.get("scope",2.5)) if player.scope_step==2 else w.get("scope",2.5)
	camera.fov = lerpf(camera.fov,options.fov/zoom,minf(1,dt*14)) if dt>0 else options.fov/zoom

func _update_plants(dt: float) -> void:
	for plant in world.plants:
		var count: Dictionary = {"B":0,"R":0}
		for unit in units:
			if unit.alive and unit.position.y-plant.pos.y<6 and Vector2(unit.position.x-plant.pos.x,unit.position.z-plant.pos.z).length()<16:
				count[unit.team] += 1
		var net: int = count.B-count.R
		var before: String = plant.owner
		plant.capturing = net!=0
		if net!=0:
			plant.gauge = clampf(plant.gauge+signf(net)*10*(1+.5*(abs(net)-1))*dt,-100,100)
		if plant.owner=="B" and plant.gauge<=0 or plant.owner=="R" and plant.gauge>=0:
			plant.owner = ""
		if plant.owner=="" and absf(plant.gauge)>=100:
			plant.owner = "B" if plant.gauge>0 else "R"
		if before!=plant.owner:
			capture_events += 1
			add_feed("プラント"+plant.id+" "+("中立化" if plant.owner=="" else "確保"))
			if plant.disc!=null:
				plant.disc.material_override = world.material(Color(world.team_color(plant.owner),.25) if plant.owner!="" else Color(.65,.7,.75,.22),true)
			for unit in units:
				if unit.alive and unit.team==plant.owner and unit.position.distance_to(plant.pos)<16:
					unit.score.caps += 1
					unit.score.total += 5

func nearest_pod(unit):
	var best = null
	var distance: float = 90
	for pod in world.pods:
		if pod.plant!="":
			var owned: bool = false
			for plant in world.plants:
				if plant.id==pod.plant and plant.owner==unit.team:
					owned = true
			if not owned:
				continue
		elif signf(pod.pos.z)!=(1 if unit.team=="B" else -1):
			continue
		var d: float = unit.position.distance_to(pod.pos)
		if d<distance:
			distance = d
			best = pod
	return best

func _update_pods(dt: float,controls: Array[Dictionary]) -> void:
	for i in units.size():
		var unit = units[i]
		unit.repairing = false
		if not unit.alive:
			continue
		var pod = nearest_pod(unit)
		var needs_repair: bool = unit.hp<unit.max_hp
		for slot in Catalog.SLOTS:
			var sl: Dictionary = unit.slots[slot]
			if sl.w.get("mag",0)>0 and not sl.w.get("noResupply",false) and (sl.ammo<sl.w.mag or sl.reserve<sl.max_reserve):
				needs_repair = true
		if pod!=null and unit.position.distance_to(pod.pos)<3 and unit.on_ground and controls[i].get("wish",Vector3.ZERO).length_squared()<.01 and needs_repair:
			unit.repairing = true
			unit.vel = Vector3.ZERO
			unit.hp = minf(unit.max_hp,unit.hp+1200*dt)
			var previous_second: int = int(unit.pod_time)
			var first: bool = unit.pod_time<=0
			unit.pod_time += dt
			for slot in Catalog.SLOTS:
				var sl: Dictionary = unit.slots[slot]
				if not sl.w.get("noResupply",false) and sl.w.get("mag",0)>0:
					if first and sl.ammo>0 and sl.reload<=0:
						sl.ammo = int(sl.w.mag)
					if int(unit.pod_time)>previous_second:
						sl.reserve = mini(sl.max_reserve,sl.reserve+int(sl.w.mag))
					if unit.pod_time>=10:
						sl.reserve = sl.max_reserve
			play_sound("pod",unit.position,unit)
		else:
			unit.pod_time = 0

func _update_launchers() -> void:
	for unit in units:
		if not unit.alive or not unit.on_ground or unit.flying or unit.mobility_cd>0 or unit.repairing:
			continue
		for cat in world.cats:
			if unit.position.distance_to(cat.pos)<2.6:
				var delta: Vector3 = cat.exit-unit.position
				unit.vel = Vector3(delta.x/2.8,34*2.8/2+delta.y/2.8,delta.z/2.8)
				unit.flight_speed = Vector2(unit.vel.x,unit.vel.z).length()
				unit.flying = true
				unit.on_ground = false
				unit.control_lock = 1
				unit.mobility_cd = 3
				unit.dash_time = 0
				unit.long_dash = false
				play_sound("catapult",unit.position,unit)
		for pad in world.pads:
			if unit.position.distance_to(pad.pos)<pad.radius:
				unit.vel = Vector3(0,sqrt(2*34*pad.rise),0)
				unit.flight_speed = unit.stats.walk
				unit.flying = true
				unit.on_ground = false
				unit.mobility_cd = 3

func _update_lifts(dt: float) -> void:
	for lift in world.lifts:
		lift.timer -= dt
		if lift.timer>0:
			continue
		var destination: Vector3 = lift.to if lift.up else lift.from
		var next: Vector3 = lift.pos.move_toward(destination,lift.speed*dt)
		var delta: Vector3 = next-lift.pos
		var riders: Array = []
		var blocked: bool = false
		for unit in units:
			if not unit.alive:
				continue
			if absf(unit.position.y-lift.pos.y)<.15 and absf(unit.position.x-lift.pos.x)<lift.size[0]/2+1 and absf(unit.position.z-lift.pos.z)<lift.size[1]/2+1 and unit.on_ground:
				riders.append(unit)
				if delta.y>0 and world.ceiling_at(unit.position)<unit.position.y+delta.y+4:
					blocked = true
			elif delta.y<0 and absf(unit.position.x-next.x)<lift.size[0]/2+1.3 and absf(unit.position.z-next.z)<lift.size[1]/2+1.3 and unit.position.y+4>next.y-.6 and unit.position.y<next.y:
				blocked = true
		for o in world.obstacles:
			if o==lift.obstacle:
				continue
			if next.x+lift.size[0]/2>o.minX and next.x-lift.size[0]/2<o.maxX and next.z+lift.size[1]/2>o.minZ and next.z-lift.size[1]/2<o.maxZ and next.y>o.get("bottom",-INF)+.01 and next.y-.6<o.top-.01:
				blocked = true
		if blocked:
			continue
		lift.pos = next
		lift.node.position = next-Vector3(0,.3,0)
		for rider in riders:
			rider.position += delta
		lift.obstacle.merge({"minX":next.x-lift.size[0]/2,"maxX":next.x+lift.size[0]/2,"minZ":next.z-lift.size[1]/2,"maxZ":next.z+lift.size[1]/2,"top":next.y,"bottom":next.y-.6},true)
		if next.distance_to(destination)<.01:
			lift.up = not lift.up
			lift.timer = lift.wait

func _update_facilities(dt: float) -> void:
	for facility in world.facilities:
		if not facility.alive:
			continue
		if facility.kind=="radar":
			for enemy in units:
				if enemy.alive and enemy.team!=facility.team and absf(enemy.position.z)>world.spec.baseLine and signf(enemy.position.z)==(1 if facility.team=="B" else -1):
					enemy.spotted_until = elapsed+1
		if facility.kind!="turret":
			continue
		facility.cd -= dt
		if facility.cd>0:
			continue
		var nearest = null
		var distance: float = 70
		for unit in units:
			var d: float = facility.pos.distance_to(unit.position)
			if unit.alive and unit.team!=facility.team and not unit.cloak and d<distance and combat.can_see(facility.pos,unit.position+Vector3(0,2,0),facility.node):
				nearest = unit
				distance = d
		if nearest!=null:
			var owner: TurretOwner
			if not facility.has("owner"):
				owner = TurretOwner.new()
				owner.team = facility.team
				owner.position = facility.pos
				facility.owner = owner
			else:
				owner = facility.owner
			var aim: Vector3 = nearest.position+Vector3(0,2,0)+nearest.vel*distance/70
			combat.launch_projectile(owner,{"dmg":1800,"blast":5,"speed":70,"life":3,"impact":true},facility.pos,(aim-facility.pos).normalized(),aim)
			facility.burst -= 1
			facility.cd = 1 if facility.burst>0 else 3
			if facility.burst<=0:
				facility.burst = 3

func bot_spawn(unit) -> String:
	if world.spec.has("vs") or unit.role=="defend" or rng.randf()>.6:
		return "base"
	var choices: Array = spawn_points(unit.team)
	return choices.back() if choices.size()>1 else "base"

func spawn_points(team: String) -> Array:
	var result: Array = ["base"]
	var owned: Array = []
	for plant in world.plants:
		if plant.owner==team:
			owned.append(plant)
	owned.sort_custom(func(a,b):return a.pos.z>b.pos.z if team=="B" else a.pos.z<b.pos.z)
	for plant in owned:
		result.append(plant.id)
	return result

func cycle_spawn(step: int) -> void:
	var choices: Array = spawn_points(player.team)
	player.spawn_choice = choices[posmod(choices.find(player.spawn_choice)+step,choices.size())]
	if player.transfer>0:
		player.transfer_target = player.spawn_choice

func check_finish() -> void:
	if world==null or ended:
		return
	if world.cores.B.hp<=0 or world.cores.R.hp<=0 or time_left<=0:
		ended = true
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
		music.stop()
		ui.show_results()

func add_feed(message: String) -> void:
	feed.append({"text":message,"life":7.0})
	if feed.size()>5:
		feed.pop_front()

func play_sound(key: String,at: Vector3,unit = null,rate: float = 1.0) -> void:
	if not render_enabled or options.master<=0 or options.sfx<=0:
		return
	var spec: Dictionary = catalog.data.sfx.get(key,{"file":"beep","vol":.3,"gap":.1,"range":100})
	var token: String = key+str(unit.get_instance_id() if unit!=null else 0)
	if audio_cooldowns.get(token,-1)>elapsed:
		return
	audio_cooldowns[token] = elapsed+spec.get("gap",.1)
	var distance: float = player.position.distance_to(at) if player!=null else 0.0
	var gain: float = 1.0 if spec.get("ui",false) else pow(maxf(0,1-distance/spec.get("range",140)),2)
	if gain<.01:
		return
	var voice: AudioStreamPlayer = null
	for existing in audio_pool:
		if not existing.playing:
			voice = existing
			break
	if voice==null and audio_pool.size()<24:
		voice = AudioStreamPlayer.new()
		add_child(voice)
		audio_pool.append(voice)
	if voice==null:
		return
	var file: String = spec.file
	if not audio_cache.has(file):
		audio_cache[file] = load("res://assets/audio/"+file+".mp3")
	voice.stream = audio_cache[file]
	voice.volume_db = linear_to_db(maxf(.0001,options.master*options.sfx*spec.get("vol",.4)*gain*.5))
	voice.pitch_scale = spec.get("rate",1.0)*rate
	voice.play()

func _load_settings() -> void:
	if not FileAccess.file_exists("user://godot_profile.json"):
		return
	var saved = JSON.parse_string(FileAccess.get_file_as_string("user://godot_profile.json"))
	if not saved is Dictionary:
		return
	player_name = str(saved.get("name",player_name)).substr(0,20)
	pilot_index = clampi(int(saved.get("pilot",0)),0,7)
	own_team = "R" if saved.get("team","")=="R" else "B"
	for key in options:
		if saved.get("options",{}).has(key) and typeof(saved.options[key])==typeof(options[key]):
			options[key] = saved.options[key]
	options.master = clampf(options.master,0,1)
	options.sfx = clampf(options.sfx,0,1)
	options.music = clampf(options.music,0,1)
	options.fov = clampf(options.fov,60,100)
	options.sensitivity = clampf(options.sensitivity,.2,3)
	for slot in ["head","body","arms","legs"]:
		var key: String = saved.get("mech",{}).get(slot,"standard")
		if catalog.parts[slot].has(key):
			mech[slot] = key
	for cls in Catalog.CLASS_IDS:
		for slot in Catalog.SLOTS:
			var key: String = saved.get("loadouts",{}).get(cls,{}).get(slot,loadouts[cls][slot])
			if key in catalog.armory[cls][slot]:
				loadouts[cls][slot] = key

func save_settings() -> void:
	var file: FileAccess = FileAccess.open("user://godot_profile.json",FileAccess.WRITE)
	file.store_string(JSON.stringify({"name":player_name,"pilot":pilot_index,"team":own_team,"mech":mech,"loadouts":loadouts,"options":options}))
	if music!=null:
		music.volume_db = linear_to_db(maxf(.0001,options.master*options.music))

func write_report() -> void:
	var report: Dictionary = {"map":map_id,"seed":rng.seed,"seconds":elapsed,"remaining":time_left,"units":units.size(),"core":{"B":world.cores.B.hp,"R":world.cores.R.hp},"shots":combat.shot_count,"hits":combat.hit_count,"kills":combat.kill_count,"captures":capture_events,"ended":ended,"agents":[]}
	for unit in units:
		report.agents.append({"team":unit.team,"class":unit.cls,"role":unit.role,"hp":unit.hp,"position":[unit.position.x,unit.position.y,unit.position.z],"score":unit.score,"pathRemaining":unit.bot_path.size()-unit.bot_path_index})
	var encoded: String = JSON.stringify(report,"  ")
	if report_path!="":
		var file: FileAccess = FileAccess.open(report_path,FileAccess.WRITE)
		file.store_string(encoded)
	print("GODOT_BATTLE "+JSON.stringify({"map":map_id,"seconds":elapsed,"units":units.size(),"shots":combat.shot_count,"hits":combat.hit_count,"kills":combat.kill_count,"captures":capture_events,"core":report.core}))
