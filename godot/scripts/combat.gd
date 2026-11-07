extends Node3D
## 射撃・爆風・設置物・回復を共有。ロック先への弾道補正は行わない。
var game
var world
var projectiles: Array[Dictionary] = []
var gadgets: Array[Dictionary] = []
var effects: Array[Dictionary] = []
var barrages: Array[Dictionary] = []
var heat_fields: Array[Dictionary] = []
var chains: Array[Dictionary] = []
var shot_count: int = 0
var hit_count: int = 0
var kill_count: int = 0

func configure(match_node) -> void:
	game = match_node
	world = game.world

func ray(from: Vector3,to: Vector3,shooter = null,mask: int = 3) -> Dictionary:
	var excluded: Array[RID] = []
	if shooter != null:
		for area in shooter.collision_areas:
			excluded.append(area.get_rid())
	var query: PhysicsRayQueryParameters3D = PhysicsRayQueryParameters3D.create(from,to,mask,excluded)
	query.collide_with_areas = true
	return world.get_world_3d().direct_space_state.intersect_ray(query)

func can_see(from: Vector3,to: Vector3,object = null) -> bool:
	var hit: Dictionary = ray(from,to,null,1)
	return hit.is_empty() or hit.position.distance_to(to)<1.0 or object!=null and hit.collider==object

func reload_slot(unit,slot: Dictionary) -> void:
	if slot.w.get("mag",0)>0 and slot.reload<=0 and slot.ammo<slot.w.mag and slot.reserve>0:
		slot.reload = slot.w.reload*unit.stats.parts.arms.reload
		game.play_sound("reload",unit.position,unit)

func spend_sp(unit,amount: float) -> void:
	unit.sp_used = true
	var slot: Dictionary = unit.slots.sp
	slot.sp = maxf(0,slot.sp-amount)
	if slot.sp<=0:
		slot.sp_overheat = true
		unit.charger_on = false
		unit.cloak = false
		unit.field_on = false
		unit.barrier_on = false
		unit.escort_on = false

func tick_weapons(unit,dt: float,control: Dictionary) -> void:
	unit.switch_time = maxf(0,unit.switch_time-dt)
	unit.attack_cd = maxf(0,unit.attack_cd-dt)
	unit.melee_time = maxf(0,unit.melee_time-dt)
	unit.recoil_wait -= dt
	if unit.recoil_wait<=0:
		unit.recoil = move_toward(unit.recoil,0,unit.recoil_recovery*dt)
		unit.recoil_yaw = move_toward(unit.recoil_yaw,0,unit.recoil_recovery*dt)
	var aim: Vector3 = control.get("aim",unit.muzzle()+unit.aim_dir()*400)
	for key in game.catalog.SLOTS:
		var sl: Dictionary = unit.slots[key]
		var w: Dictionary = sl.w
		sl.cd = maxf(sl.cd-dt,-dt)
		if sl.reload>0:
			sl.reload -= dt
			if sl.reload<=0:
				var count: int = mini(int(w.mag)-sl.ammo,sl.reserve)
				sl.ammo += count
				sl.reserve -= count
				if w.type=="escort":
					sl.ammo = int(w.mag)
		if sl.overheat>0:
			sl.overheat = maxf(0,sl.overheat-dt)
			if sl.overheat<=0:
				sl.temp = 0
		var active: bool = key==unit.selected and unit.switch_time<=0 and unit.electric_time<=0 and (unit.stun<=0 or unit.stun_kind=="land") and (not unit.repairing or w.type=="repair")
		active = active and (unit.zip_route.is_empty() or w.type!="sword")
		var trigger: bool = active and control.get("fire",false)
		var alt: bool = active and control.get("alt",false)
		if w.type=="gun":
			_tick_gun(unit,sl,dt,trigger,aim)
			if active and control.get("alt_pressed",false) and w.get("proj",{}).get("kind","")=="remote":
				detonate(unit)
		elif w.type=="sword" and active:
			_tick_sword(unit,sl,dt,trigger,control.get("boost",false))
		elif w.type=="repair":
			_tick_repair(unit,sl,dt,trigger,alt,aim)
		elif w.type=="cannon" and trigger:
			if sl.cd<=0 and not sl.sp_overheat and sl.sp>0:
				fire_shot(unit,w,aim)
				sl.cd = 60.0/w.rpm
				spend_sp(unit,100.0/w.shots)
		elif w.type=="artillery" and trigger and sl.cd<=0 and not sl.sp_overheat:
			_start_barrage(unit,w,aim)
			sl.cd = w.shots*w.get("interval",0)+w.flight
		elif w.type=="repairPost" and trigger and sl.cd<=0 and not sl.sp_overheat:
			for item in gadgets.duplicate():
				if item.owner==unit and item.kind=="repairPost":
					_remove_gadget(item)
			var spec: Dictionary = w.duplicate()
			spec.kind = "repairPost"
			spec.hp = w.postHp
			_place_gadget(unit,spec,unit.position+unit.forward()*4)
			sl.cd = 1
		elif w.type=="radarTool" and active:
			_scan(unit,unit.position,w.get("range",100),1.0)
		if key=="sp":
			_tick_special(unit,sl,dt)
		if not trigger:
			sl.held = false
		if not active:
			sl.charge = 0
			sl.hold = 0

func _tick_gun(unit,sl: Dictionary,dt: float,trigger: bool,aim: Vector3) -> void:
	var w: Dictionary = sl.w
	if w.get("spin",0)>0:
		sl.spin = clampf(sl.spin+(dt/w.spin if trigger else -dt/w.get("spinDown",1.0)),0,1)
	if not trigger and w.get("heat",0)>0:
		sl.temp = maxf(0,sl.temp-100.0/w.get("cool",3.0)*dt)
	if w.has("settle"):
		sl.conv = minf(1,sl.conv+dt/w.settle) if unit.scoped and Vector2(unit.vel.x,unit.vel.z).length()<3 else maxf(0,sl.conv-dt)
	if sl.reload>0 or sl.overheat>0:
		sl.burst = 0
		sl.charge = 0
		return
	if sl.ammo<=0:
		reload_slot(unit,sl)
		return
	var shot_weapon: Dictionary = w
	if w.has("chargeTime"):
		if trigger:
			if sl.cd<=0:
				sl.charge = minf(w.chargeTime,sl.charge+dt)
				if sl.charge>=w.chargeTime and w.has("chargeHold"):
					sl.hold += dt
					if sl.hold>w.chargeHold:
						sl.overheat = w.get("ohTime",2.0)
						sl.charge = 0
						sl.hold = 0
			return
		if sl.charge<=0 or sl.cd>0:
			return
		var q: float = minf(1,sl.charge/w.chargeTime)
		shot_weapon = w.duplicate(true)
		shot_weapon.dmg = w.get("dmg",0)*(1+(w.get("chargeMul",1)-1)*q)
		shot_weapon.spread = w.get("spread",0)*(1+(w.get("chargeFocus",1)-1)*q)
		if q>.99999:
			if w.has("chargeBlast"):
				shot_weapon.blast = w.chargeBlast
			if w.has("chargeOrb"):
				shot_weapon.proj = w.chargeOrb
		if w.has("chargeStages"):
			shot_weapon.proj.dmg = w.chargeStages[2 if q>.99999 else 1 if q>=.5 else 0]
		sl.charge = 0
		sl.hold = 0
		trigger = true
	if not trigger and sl.burst<=0:
		return
	if w.get("semi",false) and unit.is_player and sl.held:
		return
	if w.get("spin",0)>0 and sl.spin<1:
		return
	var fired: bool = false
	while sl.cd<=0 and sl.ammo>0:
		sl.ammo -= 1
		sl.cd += 60.0/w.get("rpm",60.0)
		fire_shot(unit,shot_weapon,aim,sl)
		fired = true
		if w.has("heat"):
			sl.temp += 100.0/w.heat
			if sl.temp>=100:
				sl.overheat = w.ohTime
				break
		if w.has("burst"):
			if sl.burst<=0:
				sl.burst = int(w.burst)
			sl.burst -= 1
			if sl.burst<=0:
				sl.cd += w.gap
				break
		if w.get("semi",false) and unit.is_player or w.has("chargeTime"):
			sl.held = true
			break
	if sl.ammo<=0:
		reload_slot(unit,sl)
	if w.get("back",false) and fired:
		unit.select_slot(unit.previous_slot if unit.previous_slot!=unit.selected else "main")

func fire_shot(unit,w: Dictionary,aim: Vector3,slot: Dictionary = {}) -> void:
	shot_count += 1
	unit.firing_until = game.elapsed+.26
	game.play_sound(w.get("sfx","ar"),unit.position,unit,w.get("sfxRate",1.0))
	if w.has("drone"):
		var drone_spec: Dictionary = w.drone.duplicate()
		drone_spec.kind = "drone"
		_place_gadget(unit,drone_spec,unit.position+Vector3(0,12,0))
		return
	var hands: int = 2 if w.get("dual",false) else 1
	var volley: Dictionary = {}
	for hand in hands:
		var from: Vector3 = unit.muzzle()
		if hand==1:
			from -= Vector3(cos(unit.yaw),0,-sin(unit.yaw))*1.6
		var direction: Vector3 = (aim-from).normalized()
		if w.has("proj"):
			launch_projectile(unit,w.proj,from,direction,aim,w)
			continue
		var spread: float = w.get("spread",0)
		if w.has("scope"):
			spread += w.get("sway",.02)*(1-slot.get("conv",0)) if unit.scoped else w.get("hip",.5)*(w.get("hipMove",1.0) if Vector2(unit.vel.x,unit.vel.z).length()>3 or not unit.on_ground else 1.0)
		spread /= unit.stats.parts.head.aim
		var pellets: int = int(w.get("pellets",1))
		for i in pellets:
			var dir: Vector3 = direction.rotated(Vector3.UP,(i-(pellets-1)/2.0)*w.get("fan",0))
			dir = (dir+Vector3(game.rng.randf_range(-.5,.5),game.rng.randf_range(-.5,.5),game.rng.randf_range(-.5,.5))*spread).normalized()
			var far: float = w.get("range",400.0)
			var hit: Dictionary = ray(from,from+dir*far,unit)
			var end: Vector3 = hit.position if not hit.is_empty() else from+dir*far
			var laser: bool = w.get("series","")=="il" or w.get("key","").begins_with("lightSniper")
			var color: Color = Color("a4ff42") if w.get("energy",false) else Color("ffaf68") if unit.team!=game.own_team else Color("ffe9b1")
			if i==0:
				if laser:
					beam(from,end,color,.12,.4)
				else:
					_tracer(from,end,color,w)
			if not hit.is_empty():
				var ref: Dictionary = hit.collider.get_meta("ref",{})
				var amount: float = w.get("dmg",0)
				if w.has("falloff"):
					var f: Array = w.falloff
					amount *= lerpf(1,f[2],clampf((from.distance_to(end)-f[0])/(f[1]-f[0]),0,1))
				var real: float = damage_ref(ref,unit,amount,ref.get("part","")=="head",w,end,false,false)
				if ref.get("kind","")=="unit":
					var victim = ref.unit
					volley[victim] = volley.get(victim,0.0)+real
				if w.get("directBlast",0)>0 or w.get("blast",0)>0:
					explode(unit,end,{"dmg":amount,"blast":w.get("directBlast",w.get("blast",0)),"core":false},ref.get("unit",null))
				impact(end,Color("ffe5a4") if ref.get("part","")=="head" else color)
	for victim in volley:
		jolt(victim,unit.position,volley[victim]*w.get("knockMult",1),false)
	unit.recoil = minf(.35,unit.recoil+w.get("recoil",.004)/unit.stats.parts.arms.recoil)
	unit.recoil_yaw = clampf(unit.recoil_yaw+game.rng.randf_range(-1,1)*w.get("recoilH",0)/unit.stats.parts.arms.recoil,-.25,.25)
	unit.recoil_wait = w.get("recoilDelay",0)
	unit.recoil_recovery = w.get("recoilRecovery",.04)
	if slot.has("conv"):
		slot.conv = minf(slot.conv,.15)

func damage_ref(ref: Dictionary,by,amount: float,head: bool = false,w: Dictionary = {},at: Vector3 = Vector3.ZERO,melee: bool = false,do_jolt: bool = true) -> float:
	if ref.is_empty() or amount<=0:
		return 0.0
	if ref.kind=="unit":
		var unit = ref.unit
		if not unit.alive or unit.invulnerable>0 or unit.team==by.team and unit!=by:
			return 0.0
		if unit.barrier_on and not melee and unit.slots.sp.sp>0:
			var incoming: Vector3 = (by.position-unit.position).normalized()
			var arc: float = unit.slots.sp.w.get("arc",180)*PI/360
			if unit.forward().dot(incoming)>=cos(arc):
				spend_sp(unit,100*amount/unit.slots.sp.w.shieldHp)
				impact(at,Color("77dfff"))
				return 0
		var armor: float = unit.stats.parts[ref.get("part","body")].armor
		var real: float = amount*armor*(w.get("head",1.3) if head else 1.0)*(unit.weak_mult if unit.weak_time>0 else 1.0)
		unit.hp -= real
		unit.hit_flash = .18
		unit.last_damager = by
		unit.damage_by[by] = unit.damage_by.get(by,0.0)+real
		if by!=unit:
			by.score.damage += real
		hit_count += 1
		if by.is_player:
			game.hit_marker = .18
			game.play_sound("headshot" if head else "hit",at,by)
		if unit.cloak:
			spend_sp(unit,real/maxf(1,unit.slots.sp.w.get("hitHp",4000))*100)
		if unit.hp<=0:
			kill(unit,by,real)
		elif do_jolt:
			jolt(unit,at if melee else by.position,real,melee)
		return real
	if ref.get("team","")==by.team and ref.kind!="barricade":
		return 0.0
	if ref.kind=="core":
		ref.hp = maxf(0,ref.hp-amount*.1)
		by.score.core += amount
		by.score.total += int(amount/100)
		game.check_finish()
		return amount*.1
	if not ref.get("alive",true):
		return 0.0
	ref.hp -= amount
	if ref.hp<=0:
		ref.alive = false
		if ref.has("node"):
			ref.node.visible = false
			if ref.node is CollisionObject3D:
				ref.node.collision_layer = 0
		if ref.has("obstacle"):
			world.obstacles.erase(ref.obstacle)
			world.rebuild_obstacle_index()
		by.score.total += 5
	return amount

func jolt(unit,origin: Vector3,amount: float,melee: bool) -> void:
	if not unit.alive or unit.repairing or unit.control_lock>0:
		return
	var down: bool = amount>=(6000 if melee else 7000)
	if amount<(3000 if melee else 3500):
		return
	unit.stun_kind = "down" if down else "stagger"
	unit.stun = 1.8 if down else .65
	var push: Vector3 = unit.position-origin
	push.y = 0
	push = push.normalized()*(14 if down else 9)
	unit.vel.x = push.x
	unit.vel.z = push.z
	if down:
		unit.vel.y = 12
		unit.on_ground = false
	unit.dash_time = 0
	unit.long_dash = false
	unit.melee_time = 0
	unit.transfer = 0
	unit.drop_zip(false)

func kill(unit,by,hit: float) -> void:
	if not unit.alive:
		return
	unit.hp = 0
	unit.alive = false
	unit.downed = true
	unit.down_time = 10
	unit.last_damager = by
	unit.vel = Vector3.ZERO
	unit.transfer = 0
	unit.locked = null
	unit.cloak = false
	unit.barrier_on = false
	unit.field_on = false
	unit.charger_on = false
	unit._set_collision(false)
	unit.score.deaths += 1
	if by!=unit:
		by.score.kills += 1
		by.score.total += 10
		for helper in unit.damage_by:
			if helper!=by and helper!=unit and is_instance_valid(helper):
				helper.score.assists += 1
				helper.score.total += 3
	kill_count += 1
	game.add_feed(by.callsign+" → "+unit.callsign)
	if hit>=7000 or by==unit:
		wreck(unit,by)
	elif not unit.is_player and not _reviver_near(unit):
		unit.down_time = 1

func _reviver_near(unit) -> bool:
	for ally in game.units:
		if ally!=unit and ally.alive and ally.team==unit.team and ally.slots.sp.w.type in ["repair","repairPost"] and not ally.slots.sp.sp_overheat and ally.position.distance_to(unit.position)<120:
			return true
	return false

func wreck(unit,by = null) -> void:
	if unit.respawn_time>0:
		return
	unit.alive = false
	unit.downed = false
	unit.respawn_time = 5
	unit.visible = false
	unit._set_collision(false)
	var penalty: float = world.spec.get("vs",{}).get("death",11.25 if game.units.size()>=100 else 56.25)
	world.cores[unit.team].hp = maxf(0,world.cores[unit.team].hp-penalty)
	if unit.is_player:
		game.killcam_target = by
	impact(unit.position+Vector3(0,2,0),Color("ff9e4f"),2)
	game.play_sound("explode",unit.position,unit)
	game.check_finish()

func heal(unit,by,amount: float) -> void:
	if unit.team!=by.team or not unit.alive and not unit.downed:
		return
	if unit.downed:
		unit.hp += amount
		if unit.hp>=3000:
			unit.alive = true
			unit.downed = false
			unit.hp = unit.max_hp*.3
			unit.invulnerable = 3
			unit.stun = 0
			unit._set_collision(true)
			by.score.total += 10
			game.add_feed(by.callsign+" が "+unit.callsign+" を再始動")
	else:
		var actual: float = minf(amount,unit.max_hp-unit.hp)
		unit.hp += actual
		by.score.heal += actual

func launch_projectile(unit,spec: Dictionary,from: Vector3,direction: Vector3,aim: Vector3,weapon: Dictionary = {}) -> void:
	var velocity: Vector3 = direction*spec.get("speed",30.0)
	if spec.get("grav",0)>0:
		var flat: Vector3 = aim-from
		flat.y = 0
		var speed: float = spec.get("speed",30.0)
		var g: float = spec.grav
		var dist: float = flat.length()
		var rise: float = aim.y-from.y
		var disc: float = speed*speed*speed*speed-g*(g*dist*dist+2*rise*speed*speed)
		var angle: float = atan((speed*speed-sqrt(maxf(0,disc)))/maxf(.01,g*dist)) if disc>=0 else PI/4
		velocity = flat.normalized()*cos(angle)*speed+Vector3.UP*sin(angle)*speed
	var color: Color = Color("ff69c7") if weapon.get("series","")=="lp" else Color("a4ff42") if weapon.get("energy",false) or spec.get("energy",0)!=0 else Color("ffb058")
	var shot: Dictionary = {"owner":unit,"spec":spec.duplicate(true),"pos":from,"vel":velocity,"life":spec.get("fuse",spec.get("life",8.0)),"stuck":false,"color":color,"mesh":null,"weapon":weapon}
	if world.visible_geometry:
		var mesh: MeshInstance3D = MeshInstance3D.new()
		var sphere: SphereMesh = SphereMesh.new()
		sphere.radius = .55 if weapon.get("series","") in ["lp","lq"] else .2
		sphere.height = sphere.radius*2
		mesh.mesh = sphere
		mesh.material_override = world.material(color,true)
		mesh.position = from
		add_child(mesh)
		shot.mesh = mesh
	projectiles.append(shot)
	if weapon.get("series","")=="lp":
		impact(from,color,.65)

func explode(owner,at: Vector3,spec: Dictionary,exclude_unit = null) -> void:
	var radius: float = spec.get("blast",5.0)
	impact(at,Color("ffaf64"),minf(3,radius*.2))
	game.play_sound("gas" if spec.has("weak") else "explode",at,owner)
	for unit in game.units:
		if not unit.alive or unit==exclude_unit:
			continue
		var target: Vector3 = unit.position+Vector3(0,2,0)
		var distance: float = at.distance_to(target)
		if distance>radius:
			continue
		if spec.get("occluded",false) and not can_see(at+Vector3.UP*.15,target):
			continue
		if spec.has("weak") and unit.team!=owner.team:
			unit.weak_time = spec.weak.time
			unit.weak_mult = spec.weak.mult
		elif spec.get("jamSeconds",0)>0 and unit.team!=owner.team:
			unit.jam_time = spec.jamSeconds
		elif spec.get("stunSeconds",0)>0 and unit.team!=owner.team:
			unit.electric_time = spec.stunSeconds
		else:
			var factor: float = maxf(0,1-distance/radius) if spec.get("linear",false) else 1-.5*distance/radius
			var damage: float = spec.get("dmg",0)*factor
			var actual: float = damage_ref({"kind":"unit","unit":unit,"part":"body"},owner,damage,false,{},at,false,false)
			jolt(unit,at,actual*spec.get("knockMult",1),false)
	for target in world.facilities:
		if target.alive and target.pos.distance_to(at)<radius:
			damage_ref(target,owner,spec.get("dmg",0)*(1-.5*target.pos.distance_to(at)/radius))

func _tick_sword(unit,sl: Dictionary,dt: float,trigger: bool,strong: bool) -> void:
	var w: Dictionary = sl.w
	if w.has("chargeWave") or w.get("meleeCharge",false):
		if trigger:
			sl.charge += dt
			return
		if sl.charge<=0:
			return
		trigger = true
	if not trigger or unit.attack_cd>0:
		return
	var action: Dictionary = w.get("strong",w.get("normal",{})) if strong else w.get("normal",{})
	if action.is_empty():
		return
	unit.attack_cd = action.get("time",.8)
	unit.melee_time = unit.attack_cd
	game.play_sound("swing",unit.position,unit)
	var charged: bool = sl.charge>=w.get("chargeTime",INF)
	sl.charge = 0
	if charged and w.has("chargeWave"):
		var wave: Dictionary = w.chargeWave.duplicate()
		wave.speed = wave.get("speed",100)
		wave.blast = wave.get("width",4)
		wave.life = wave.get("range",100)/wave.speed
		wave.impact = true
		launch_projectile(unit,wave,unit.muzzle(),unit.aim_dir(),unit.muzzle()+unit.aim_dir()*200,{"energy":true})
	for victim in game.units:
		if not victim.alive or victim.team==unit.team:
			continue
		var delta: Vector3 = victim.position-unit.position
		if delta.length()>action.get("reach",4.0)+1.3 or absf(delta.y)>3:
			continue
		if unit.forward().dot(delta.normalized())<-.2:
			continue
		damage_ref({"kind":"unit","unit":victim,"part":"body"},unit,action.get("dmg",3000),false,{},unit.position,true)
		beam(unit.muzzle(),victim.position+Vector3(0,2,0),Color("86ffb3"),.25,.18)

func _tick_repair(unit,sl: Dictionary,dt: float,trigger: bool,alt: bool,aim: Vector3) -> void:
	if sl.sp_overheat or sl.sp<=0:
		return
	if not trigger and not alt:
		return
	var target = unit if alt else null
	if not alt:
		var best: float = 6
		for ally in game.units:
			if ally.team!=unit.team or not ally.alive and not ally.downed or ally==unit:
				continue
			var at: Vector3 = ally.position+Vector3(0,2,0)
			var dir: Vector3 = (aim-unit.muzzle()).normalized()
			var t: float = clampf((at-unit.muzzle()).dot(dir),0,sl.w.range)
			var distance: float = at.distance_to(unit.muzzle()+dir*t)
			if distance<best and at.distance_to(unit.position)<=sl.w.range and can_see(unit.muzzle(),at):
				best = distance
				target = ally
	if target!=null:
		heal(target,unit,sl.w.heal*dt*(1 if target==unit else 1.2))
		spend_sp(unit,100.0/sl.w.use*dt)
		beam(unit.muzzle(),target.position+Vector3(0,2,0),Color(.3,1,.65,.7),.08,.06)
		game.play_sound("heal",unit.position,unit)
	else:
		for facility in world.facilities:
			if facility.team!=unit.team or facility.kind=="barricade" or facility.alive and facility.hp>=facility.maxHp:
				continue
			var delta: Vector3 = facility.pos-unit.muzzle()
			if delta.length()<sl.w.range and delta.normalized().dot((aim-unit.muzzle()).normalized())>.97:
				heal_facility(facility,unit,sl.w.heal*.7*dt)
				spend_sp(unit,100.0/sl.w.use*dt)
				beam(unit.muzzle(),facility.pos,Color(.3,1,.65,.7),.08,.06)
				break

func _tick_special(unit,sl: Dictionary,dt: float) -> void:
	var active: bool = unit.charging or unit.cloak or unit.field_on or unit.barrier_on or unit.escort_on
	if active and not unit.charging:
		var healed_allies: int = 0
		if unit.field_on:
			for ally in game.units:
				if ally.team==unit.team and ally.alive and ally.hp<ally.max_hp and ally.position.distance_to(unit.position)<sl.w.get("radius",15):
					heal(ally,unit,sl.w.get("heal",700)*dt)
					if ally!=unit:
						healed_allies += 1
		spend_sp(unit,100.0/sl.w.get("use",30.0)*(1+.5*healed_allies)*dt)
		if unit.escort_on and sl.cd<=0 and sl.reload<=0:
			if sl.ammo<=0:
				sl.reload = sl.w.reload
			else:
				var target = null
				var closest: float = sl.w.range
				for enemy in game.units:
					var delta: Vector3 = enemy.position-unit.position
					if enemy.alive and enemy.team!=unit.team and delta.length()<closest and delta.normalized().dot(unit.forward())>=cos(sl.w.arc*PI/360) and can_see(unit.muzzle(),enemy.position+Vector3(0,2,0)):
						closest = delta.length()
						target = enemy
				if target!=null:
					fire_shot(unit,sl.w,target.position+Vector3(0,2,0))
					sl.cd = 60.0/sl.w.rpm
					sl.ammo -= 1
	var post_active: bool = false
	if sl.w.type=="repairPost":
		for gadget in gadgets:
			if gadget.owner==unit and gadget.kind=="repairPost":
				post_active = true
	if not active and not post_active and not unit.sp_used and sl.w.has("charge"):
		var charge: float = sl.w.charge if sl.sp_overheat else sl.w.get("chargeKeep",sl.w.charge)
		sl.sp = minf(100,sl.sp+100.0/charge*unit.stats.parts.body.sp/100*unit.stats.parts.body.supply*dt)
		if sl.sp>=100:
			sl.sp_overheat = false

func _start_barrage(unit,w: Dictionary,at: Vector3) -> void:
	var target: Vector3 = at
	var delta: Vector3 = target-unit.position
	if delta.length()>w.range:
		target = unit.position+delta.normalized()*w.range
	for i in int(w.shots):
		var p: Vector3 = target+Vector3(game.rng.randf_range(-w.scatter,w.scatter),0,game.rng.randf_range(-w.scatter,w.scatter))
		p.y = world.terrain_h(p.x,p.z)
		barrages.append({"owner":unit,"pos":p,"life":w.flight+i*w.get("interval",0),"launch_at":game.elapsed+i*w.get("interval",0),"launched":false,"cost":100.0/w.shots,"spec":{"dmg":w.dmg,"blast":w.blast,"linear":true,"occluded":true}})

func _place_gadget(owner,spec: Dictionary,at: Vector3) -> void:
	var kind: String = spec.get("kind","mine")
	if kind=="sonar":
		_scan(owner,at,spec.get("scan",80),spec.get("keep",10))
		return
	var count: int = 0
	for gadget in gadgets:
		if gadget.owner==owner and gadget.kind==kind:
			count += 1
	if count>=spec.get("max",10):
		for gadget in gadgets:
			if gadget.owner==owner and gadget.kind==kind:
				_remove_gadget(gadget)
				break
	var item: Dictionary = {"kind":kind,"owner":owner,"team":owner.team,"spec":spec,"pos":at,"base":at,"dir":owner.forward(),"planar_prev":{},"triggered":false,"trigger_time":0.0,"alive":true,"hp":spec.get("hp",3000.0),"life":spec.get("dur",INF),"cd":0.0,"node":null,"ammo":spec.get("gun",{}).get("mag",1),"reload":0.0}
	if spec.has("hover"):
		item.pos.y += spec.hover
	if spec.has("airDeploy"):
		item.pos.y += spec.get("riseHeight",3)
	if world.visible_geometry:
		item.node = world.add_box(item.pos+Vector3(0,.35,0),Vector3(.8,.7,.8),world.team_color(owner.team),item)
	gadgets.append(item)

func detonate(owner) -> void:
	for gadget in gadgets.duplicate():
		if gadget.owner==owner and gadget.kind=="remote":
			explode(owner,gadget.pos,gadget.spec)
			_remove_gadget(gadget)

func _scan(owner,at: Vector3,radius: float,keep: float) -> void:
	for enemy in game.units:
		if enemy.alive and enemy.team!=owner.team and enemy.position.distance_to(at)<radius:
			enemy.spotted_until = maxf(enemy.spotted_until,game.elapsed+keep)

func _remove_gadget(item: Dictionary) -> void:
	if item.get("node")!=null and is_instance_valid(item.node):
		item.node.queue_free()
	gadgets.erase(item)

func step(dt: float) -> void:
	for shot in projectiles.duplicate():
		shot.life -= dt
		shot.age = shot.get("age",0.0)+dt
		if shot.spec.has("airDeploy") and shot.age>=shot.spec.airDeploy:
			_place_gadget(shot.owner,shot.spec,shot.pos)
			shot.life = -1
		var hit: Dictionary = {}
		if not shot.stuck:
			shot.vel.y -= shot.spec.get("grav",0)*dt
			var next: Vector3 = shot.pos+shot.vel*dt
			hit = ray(shot.pos,next,shot.owner)
			shot.pos = hit.position if not hit.is_empty() else next
		if not hit.is_empty():
			var kind: String = shot.spec.get("kind","")
			if shot.spec.has("chainCount"):
				if hit.normal.y>.5:
					var dir: Vector3 = shot.vel
					dir.y = 0
					chains.append({"owner":shot.owner,"spec":shot.spec,"pos":shot.pos,"dir":dir.normalized(),"left":int(shot.spec.chainCount),"cd":0.0})
					shot.life = -1
				else:
					shot.vel = shot.vel.bounce(hit.normal)*.7
					shot.pos += hit.normal*.15
			elif kind in ["mine","fmine","remote","sensor","airsensor","fansensor","planeSensor","ammo","sentry","airTurret","flyTurret","sonar"]:
				_place_gadget(shot.owner,shot.spec,shot.pos)
				shot.life = -1
			elif shot.spec.get("impact",false) or shot.spec.get("rocket",false) or shot.spec.get("grav",0)==0:
				var ref: Dictionary = hit.collider.get_meta("ref",{})
				if ref.get("kind","")=="core" and shot.spec.get("core",false):
					damage_ref(ref,shot.owner,shot.spec.get("dmg",0))
				_burst(shot.owner,shot.pos,shot.spec)
				shot.life = -1
			else:
				shot.stuck = true
		if shot.life<=0:
			if shot.life>-1 and shot.spec.has("fuse"):
				_burst(shot.owner,shot.pos,shot.spec)
			if shot.mesh!=null:
				shot.mesh.queue_free()
			projectiles.erase(shot)
		elif shot.mesh!=null:
			shot.mesh.position = shot.pos
	for barrage in barrages.duplicate():
		if not barrage.launched and game.elapsed>=barrage.launch_at:
			if not barrage.owner.alive or barrage.owner.selected!="sp" or barrage.owner.slots.sp.sp_overheat:
				barrages.erase(barrage)
				continue
			barrage.launched = true
			spend_sp(barrage.owner,barrage.cost)
		barrage.life -= dt
		if barrage.life<2 and barrage.life>0 and int(barrage.life*10)%4==0:
			beam(barrage.pos,barrage.pos+Vector3(0,4,0),Color(1,.35,.1,.4),.15,.07)
		if barrage.life<=0:
			explode(barrage.owner,barrage.pos,barrage.spec)
			barrages.erase(barrage)
	for gadget in gadgets.duplicate():
		gadget.life -= dt
		gadget.cd -= dt
		if not gadget.alive or gadget.life<=0:
			_remove_gadget(gadget)
			continue
		var spec: Dictionary = gadget.spec
		if gadget.kind=="sensor" and spec.get("planar",false):
			_planar_scan(gadget)
		elif gadget.kind in ["sensor","airsensor","fansensor","planeSensor","drone"]:
			_scan(gadget.owner,gadget.pos,spec.get("scan",65),spec.get("keep",5))
		if spec.get("roamSpeed",0)>0:
			var next: Vector3 = gadget.pos+gadget.dir*spec.roamSpeed*dt
			if ray(gadget.pos,next,gadget.owner,1).is_empty():
				gadget.pos = next
			else:
				_remove_gadget(gadget)
				continue
		if gadget.node!=null:
			gadget.node.position = gadget.pos+Vector3(0,.35,0)
		if gadget.kind=="repairPost":
			if gadget.owner.slots.sp.sp_overheat or not gadget.owner.alive and not gadget.owner.downed:
				_remove_gadget(gadget)
				continue
			if not gadget.owner.repairing:
				spend_sp(gadget.owner,100.0/spec.get("use",80)*dt)
		if gadget.triggered:
			gadget.trigger_time += dt
			var delay: float = spec.get("jumpDelay",spec.get("detDelay",0))
			if spec.has("jumpHeight"):
				var t: float = clampf(gadget.trigger_time/maxf(.001,delay),0,1)
				gadget.pos.y = gadget.base.y+spec.jumpHeight*t
			if gadget.trigger_time>=delay:
				explode(gadget.owner,gadget.pos,spec)
				_remove_gadget(gadget)
				continue
		if gadget.kind=="drone":
			gadget.pos += gadget.owner.forward()*spec.get("speed",28)*dt
			if gadget.node!=null:
				gadget.node.position = gadget.pos
		for unit in game.units:
			if not unit.alive and not unit.downed:
				continue
			var distance: float = unit.position.distance_to(gadget.pos)
			if gadget.kind in ["mine","fmine","jumpMine","delayMine"] and unit.team!=gadget.team and distance<spec.get("trigger",3) and not gadget.triggered:
				if spec.has("jumpDelay") or spec.has("detDelay"):
					gadget.triggered = true
				else:
					explode(gadget.owner,gadget.pos,spec)
					_remove_gadget(gadget)
				break
			if gadget.kind=="ammo" and distance<spec.get("pickupRange",4):
				for slot in ["main","sub"]:
					unit.slots[slot].ammo = int(unit.slots[slot].w.mag)
					unit.slots[slot].reserve = unit.slots[slot].max_reserve
				_remove_gadget(gadget)
				break
			if gadget.kind=="repairPost" and unit.team==gadget.team and distance<spec.get("radius",15):
				if not gadget.owner.repairing and (unit.hp<unit.max_hp or unit.downed):
					heal(unit,gadget.owner,spec.get("heal",700)*dt)
					spend_sp(gadget.owner,spec.get("healDrain",3.75)*dt)
			if gadget.kind in ["sentry","airTurret","flyTurret"] and unit.alive and unit.team!=gadget.team and distance<spec.get("gun",{}).get("range",60) and gadget.cd<=0:
				if can_see(gadget.pos+Vector3.UP,unit.position+Vector3(0,2,0)):
					var gun: Dictionary = spec.get("gun",{"dmg":300,"rpm":300})
					if spec.get("downOnly",false) and unit.position.y>gadget.pos.y:
						continue
					damage_ref({"kind":"unit","unit":unit,"part":"body"},gadget.owner,gun.get("dmg",300))
					beam(gadget.pos+Vector3.UP,unit.position+Vector3(0,2,0),world.team_color(gadget.team),.06,.08)
					gadget.ammo -= 1
					gadget.cd = 60.0/gun.get("rpm",300) if gadget.ammo>0 else gun.get("reload",2)
					if gadget.ammo<=0:
						gadget.ammo = int(gun.get("mag",1))
	for field in heat_fields.duplicate():
		var step_time: float = minf(dt,field.life)
		for unit in game.units:
			if not unit.alive or unit.position.distance_to(field.pos)>field.spec.blast or not can_see(field.pos+Vector3.UP*.2,unit.position+Vector3(0,2,0)):
				continue
			var amount: float = field.spec.heatDps*step_time+(0 if field.touched.has(unit) else field.spec.dmg)
			field.touched[unit] = true
			damage_ref({"kind":"unit","unit":unit,"part":"body"},field.owner,amount,false,{},field.pos,false,false)
		field.life -= dt
		if field.life<=0:
			heat_fields.erase(field)
	for chain in chains.duplicate():
		chain.cd -= dt
		if chain.cd<=0:
			explode(chain.owner,chain.pos,chain.spec)
			chain.left -= 1
			chain.cd += chain.spec.chainGap
			var next: Vector3 = chain.pos+chain.dir*chain.spec.chainStep
			if chain.left<=0 or not ray(chain.pos+Vector3.UP,next+Vector3.UP,null,1).is_empty():
				chains.erase(chain)
			else:
				next.y = world.terrain_h(next.x,next.z)
				chain.pos = next
	for effect in effects.duplicate():
		effect.life -= dt
		if effect.life<=0:
			effect.node.queue_free()
			effects.erase(effect)
		elif effect.get("expand",false):
			effect.node.scale += Vector3.ONE*dt*4
		elif effect.has("travel"):
			effect.travel += dt*900
			var a: Vector3 = effect.start+effect.dir*minf(effect.distance,maxf(0,effect.travel-effect.length))
			var b: Vector3 = effect.start+effect.dir*minf(effect.travel,effect.distance)
			effect.node.position = (a+b)/2
			effect.node.mesh.height = maxf(.01,a.distance_to(b))

func beam(from: Vector3,to: Vector3,color: Color,radius: float,life: float) -> MeshInstance3D:
	if not world.visible_geometry or effects.size()>160 or from.distance_to(to)<.01:
		return null
	var node: MeshInstance3D = MeshInstance3D.new()
	var cylinder: CylinderMesh = CylinderMesh.new()
	cylinder.top_radius = radius
	cylinder.bottom_radius = radius
	cylinder.height = from.distance_to(to)
	cylinder.radial_segments = 6
	node.mesh = cylinder
	node.material_override = world.material(color,true)
	node.position = (from+to)/2
	node.quaternion = Quaternion(Vector3.UP,(to-from).normalized())
	add_child(node)
	effects.append({"node":node,"life":life})
	return node

func impact(at: Vector3,color: Color,size: float = .4) -> void:
	if not world.visible_geometry or effects.size()>160:
		return
	var node: MeshInstance3D = MeshInstance3D.new()
	var sphere: SphereMesh = SphereMesh.new()
	sphere.radius = size
	sphere.height = size*2
	node.mesh = sphere
	node.position = at
	node.material_override = world.material(Color(color,.6),true)
	add_child(node)
	effects.append({"node":node,"life":.18,"expand":true})

func _tracer(from: Vector3,to: Vector3,color: Color,w: Dictionary) -> void:
	var length: float = clampf(135*60.0/w.get("rpm",600),4,24)
	var distance: float = from.distance_to(to)
	var direction: Vector3 = (to-from).normalized()
	var node = beam(from,from+direction*minf(length,distance),color,.07,distance/900+.025)
	if node!=null:
		effects.back().merge({"travel":minf(length,distance),"start":from,"dir":direction,"distance":distance,"length":length})

func _burst(owner,at: Vector3,spec: Dictionary) -> void:
	if spec.has("heatDps"):
		heat_fields.append({"owner":owner,"pos":at,"spec":spec,"life":spec.heatDur,"touched":{}})
		impact(at,Color("ff8a39"),spec.blast*.4)
	else:
		explode(owner,at,spec)

func _planar_scan(gadget: Dictionary) -> void:
	for unit in game.units:
		if not unit.alive or unit.team==gadget.team:
			continue
		var cur: Vector3 = unit.position+Vector3(0,2.4,0)-gadget.pos
		var previous: Vector3 = gadget.planar_prev.get(unit,cur)
		var d: float = cur.dot(gadget.dir)
		var pd: float = previous.dot(gadget.dir)
		var at: Vector3 = previous.lerp(cur,pd/(pd-d)) if pd*d<0 else cur
		var plane_depth: float = at.dot(gadget.dir)
		if sqrt(maxf(0,at.length_squared()-plane_depth*plane_depth))<=gadget.spec.scan+1.3 and (absf(d)<=1.3 or pd*d<0):
			unit.spotted_until = maxf(unit.spotted_until,game.elapsed+gadget.spec.keep)
		gadget.planar_prev[unit] = cur

func heal_facility(facility: Dictionary,by,amount: float) -> void:
	if facility.team!=by.team:
		return
	if facility.alive:
		facility.hp = minf(facility.maxHp,facility.hp+amount)
	else:
		facility.revive = facility.get("revive",0.0)+amount
		if facility.revive>=7000:
			facility.alive = true
			facility.hp = 7000
			facility.revive = 0
			facility.node.visible = true
			facility.node.collision_layer = 1
			by.score.total += 10
