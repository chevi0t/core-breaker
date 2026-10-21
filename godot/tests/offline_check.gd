extends SceneTree
## 実際のGodot物理サーバーと共通の機体処理を使う機能検査。
var game
var failures: Array[String] = []
var checks: int = 0

func _initialize() -> void:
	call_deferred("run")

func check(ok: bool,message: String) -> void:
	checks += 1
	if not ok:
		failures.append(message)
		print("FAIL "+message)

func settle() -> void:
	await physics_frame
	await physics_frame

func isolate(id: String = "mobility") -> void:
	game.start_match(id,true)
	game.set_physics_process(false)
	for i in game.units.size():
		var unit = game.units[i]
		unit.position = Vector3(115,0,180+i*4)
		unit.vel = Vector3.ZERO
		unit.invulnerable = 0
	game.player.is_player = true
	game.player.mech = game.catalog.data.mechDefault.duplicate()
	game.player.equip("assault")
	game.player.position = Vector3(-60,0,0)
	game.player.invulnerable = 0

func run() -> void:
	game = load("res://scenes/main.tscn").instantiate()
	root.add_child(game)
	game.set_physics_process(false)
	game.random_bot_weapons = false
	await process_frame
	check(game.catalog.weapons.size()==286,"武器286種")
	var parts: int = 0
	for table in game.catalog.parts.values():
		parts += table.size()
	check(parts==72,"機体パーツ72種")
	check(game.catalog.maps.size()==11,"マップ11配置")
	for fixture in game.catalog.data.fixtures.mech:
		var st: Dictionary = game.catalog.stats(fixture.config,fixture.loadout)
		for key in ["weight","walk","dash","cruise"]:
			check(absf(st[key]-fixture[key])<.00001,"ブラウザの機体性能一致: "+key+" / "+fixture.config.legs)
	for id in game.catalog.maps:
		isolate(id)
		check(game.units.size()==int(game.world.spec.team)*2,"各マップの人数: "+id)
		check(game.world.team_color(game.own_team)==Color("3ea6ff"),"自軍は青: "+id)
		if id=="city":
			check(game.world.nav.get_point_count()==56,"市街地の点対称navを展開")
			check(game.world.nav.are_points_connected(13,40),"市街地の ~12 リンクを解決")
		var terrain_key: String = game.world.spec.get("group",id)
		for probe in game.catalog.data.fixtures.terrain[terrain_key]:
			check(absf(game.world.terrain_h(probe.x,probe.z)-probe.y)<.00001,"元のterrainHと地形高一致: "+id)
		for unit in game.units:
			check(is_finite(unit.position.y),"出撃位置の高さ: "+id)
		await settle()
	isolate()
	await settle()
	var unit = game.player
	var peak: float = 0
	for i in 100:
		unit.tick(1.0/60,{"jump":i==0})
		peak = maxf(peak,unit.position.y)
	check(absf(peak-6.62103987719496)<.00002,"通常ジャンプのブラウザ実測一致: "+str(peak))
	check(unit.on_ground,"ジャンプから接地")
	unit.boost = unit.max_boost
	unit.short_dash(Vector3.RIGHT)
	check(absf(unit.max_boost-unit.boost-9.6)<.00001,"ショートダッシュ消費9.6")
	unit.spawn()
	unit.position = Vector3(-60,0,0)
	unit.tick(1.0/60,{"jump":true})
	check(absf(unit.max_boost-unit.boost-8.8)<.00001,"ジャンプ消費8.8")
	unit.spawn()
	unit.invulnerable = 0
	unit.position = Vector3(-60,0,0)
	unit.yaw = 0
	check(game.ui.warning_direction(unit,unit.position+Vector3.RIGHT).is_equal_approx(Vector2.RIGHT),"右からの警告は右")
	check(game.ui.warning_direction(unit,unit.position+Vector3.FORWARD).is_equal_approx(Vector2.UP),"前からの警告は上")
	check(game.ui.warning_direction(unit,unit.position+Vector3.BACK).is_equal_approx(Vector2.DOWN),"後ろからの警告は下")
	var target = game.units[game.units.size()/2]
	target.position = Vector3(-40,0,0)
	target.mech = game.catalog.data.mechDefault.duplicate()
	target.equip("assault")
	target.hp = target.max_hp
	target.invulnerable = 0
	await settle()
	var old_hp: float = target.hp
	game.combat.damage_ref({"kind":"unit","unit":target,"part":"head"},unit,100,true)
	check(absf(old_hp-target.hp-130)<.001,"標準装甲への頭部1.3倍")
	var ally = game.units[1]
	old_hp = ally.hp
	game.combat.damage_ref({"kind":"unit","unit":ally,"part":"body"},unit,500)
	check(ally.hp==old_hp,"味方への射撃では耐久を減らさない")
	unit.locked = target
	target.hp = target.max_hp
	game.combat.fire_shot(unit,{"dmg":1000,"spread":0,"range":60,"rpm":600},Vector3(-60,2.65,-60))
	check(target.hp==target.max_hp,"ロック先へ弾道を補正しない")
	game.combat.fire_shot(unit,{"dmg":1000,"spread":0,"range":60,"rpm":600},target.position+Vector3(0,2.4,0))
	check(target.hp<target.max_hp,"実際のGodotレイで敵機へ命中")
	target.invulnerable = 0
	target.hp = 100
	game.combat.damage_ref({"kind":"unit","unit":target,"part":"body"},unit,1000)
	check(target.downed and not target.alive,"小さい撃破打は行動不能")
	game.combat.heal(target,target,3000)
	check(target.alive and not target.downed and absf(target.hp-target.max_hp*.3)<.01,"修理3000で耐久3割の蘇生")
	check(target.invulnerable==3,"蘇生無敵3秒")
	target.invulnerable = 0
	target.hp = 100
	var core_before: float = game.world.cores[target.team].hp
	game.combat.damage_ref({"kind":"unit","unit":target,"part":"body"},unit,8000)
	check(not target.downed and target.respawn_time==5,"大きい撃破打は即大破・5秒再出撃")
	check(absf(core_before-game.world.cores[target.team].hp-56.25)<.001,"大破時のコア減少1/160")
	for i in 101:
		target.tick(.05,{})
	check(target.alive and target.hp==target.max_hp,"時間経過で再出撃")
	isolate()
	unit = game.player
	var plant: Dictionary = game.world.plants[0]
	plant.owner = ""
	plant.gauge = 0.0
	unit.position = plant.pos+Vector3(4,0,0)
	for i in 201:
		game._update_plants(.05)
	check(plant.owner==unit.team,"1機10秒で中立プラント占拠")
	plant.owner = "R"
	plant.gauge = -100.0
	for i in 201:
		game._update_plants(.05)
	check(plant.owner=="","敵所有から10秒で中立化")
	for i in 201:
		game._update_plants(.05)
	check(plant.owner=="B","敵所有から合計20秒で占拠")
	var pod: Dictionary = game.world.pods[0]
	unit.position = pod.pos
	unit.hp = 5000
	unit.on_ground = true
	unit.vel = Vector3.ZERO
	var controls: Array[Dictionary] = []
	for agent in game.units:
		controls.append({})
	game._update_pods(.05,controls)
	check(unit.repairing,"ポッドで停止すると修理開始")
	var shots: int = game.combat.shot_count
	var pos: Vector3 = unit.position
	unit.tick(.05,{"fire":true,"boost":true,"jump":true,"jump_held":true})
	check(game.combat.shot_count==shots and unit.position.is_equal_approx(pos),"ポッド使用中は射撃・ジャンプ・ダッシュ禁止")
	controls[0] = {"wish":Vector3.RIGHT}
	game._update_pods(.05,controls)
	check(not unit.repairing,"移動入力でポッドから離脱できる")
	unit.tick(.05,controls[0])
	check(unit.position.distance_to(pos)>0,"ポッドに閉じ込められない")
	await _check_facilities_and_effects()
	await _check_weapons()
	game.start_match("wide",true)
	game.set_physics_process(false)
	await settle()
	check(game.units.size()==20,"10対10の全20機")
	game.time_left = .01
	game.simulate_step(.05)
	check(game.ended,"時間切れの勝敗画面")
	var result: Dictionary = {"passed":checks-failures.size(),"checks":checks,"failures":failures,"weapons":286,"maps":11,"jumpPeak":peak}
	print("GODOT_CHECK "+JSON.stringify(result))
	var output: String = OS.get_environment("GODOT_CHECK_REPORT")
	if not output.is_empty():
		var file: FileAccess = FileAccess.open(output,FileAccess.WRITE)
		file.store_string(JSON.stringify(result,"  "))
	game.free()
	quit(0 if failures.is_empty() else 1)

func _check_facilities_and_effects() -> void:
	isolate()
	var unit = game.player
	var pad: Dictionary = game.world.pads[0]
	unit.position = pad.pos
	unit.on_ground = true
	unit.mobility_cd = 0
	game._update_launchers()
	check(unit.vel.y>40 and unit.vel.x==0 and unit.vel.z==0,"ジャンプパッドは垂直に射出")
	var lift: Dictionary = game.world.lifts[0]
	unit.position = lift.from
	unit.vel = Vector3.ZERO
	unit.on_ground = true
	unit.flying = false
	unit.control_lock = 0
	var up: bool = false
	var down: bool = false
	for i in 600:
		game._update_lifts(.05)
		unit.tick(.05,{})
		up = up or unit.position.distance_to(lift.to)<.1
		if up and unit.position.distance_to(lift.from)<.1:
			down = true
			break
	check(up and down,"リフトに立って上下を往復")
	isolate("circulation")
	unit = game.player
	var zip: Dictionary = game.world.zips[0]
	unit.position = zip.bottom
	unit.invulnerable = 0
	check(unit.begin_zip(),"ジップラインに掴まる")
	for i in 160:
		unit.tick(.05,{})
		if unit.zip_route.is_empty():
			break
	check(unit.zip_route.is_empty() and unit.position.y>12,"ジップラインから高所の降り場へ出る")
	unit.position = zip.bottom
	unit.on_ground = true
	unit.zip_cd = 0
	unit.begin_zip()
	unit.tick(.05,{"jump":true})
	check(unit.zip_route.is_empty() and unit.vel.y>0,"Spaceで途中から手を離す")
	isolate()
	unit = game.player
	var target = game.units[game.units.size()/2]
	target.mech = game.catalog.data.mechDefault.duplicate()
	target.equip("assault")
	target.hp = target.max_hp
	target.position = Vector3(-40,0,0)
	target.invulnerable = 0
	await settle()
	var flare: Dictionary = game.catalog.weapons.flare.proj
	game.combat._burst(unit,target.position,flare)
	var before: float = target.hp
	game.combat.step(.25)
	check(absf(before-target.hp-(flare.dmg+flare.heatDps*.25))<.02,"熱球は接触損傷と継続損傷")
	before = target.hp
	game.combat.step(.25)
	check(absf(before-target.hp-flare.heatDps*.25)<.02,"接触損傷は同じ領域で1回だけ")
	game.combat.heat_fields.clear()
	target.hp = target.max_hp
	unit.yaw = -PI/2
	game.combat._place_gadget(unit,game.catalog.weapons.planeSensor.proj,Vector3(-40,0,0))
	var sensor: Dictionary = game.combat.gadgets.back()
	target.position = Vector3(-50,0,0)
	target.spotted_until = 0
	game.combat._planar_scan(sensor)
	check(target.spotted_until==0,"索敵カーテンの面から離れていれば映さない")
	target.position.x = -30
	game.combat._planar_scan(sensor)
	check(target.spotted_until>=game.elapsed+9.99,"面を横切った敵を記録")
	game.combat.gadgets.clear()
	target.position = Vector3(-39,0,0)
	target.hp = target.max_hp
	target.invulnerable = 0
	game.combat._place_gadget(unit,game.catalog.weapons.jumpMine.proj,Vector3(-40,0,0))
	game.combat.step(.01)
	check(game.combat.gadgets.back().triggered and target.hp==target.max_hp,"跳躍地雷は感知直後に即爆発しない")
	game.combat.step(.71)
	check(game.combat.gadgets.is_empty() and target.hp<target.max_hp,"跳躍後に爆発する")
	unit.mech = game.catalog.data.mechDefault.duplicate()
	game.loadouts.support.sp = "field"
	unit.equip("support")
	unit.position = Vector3(-60,0,0)
	unit.hp = unit.max_hp
	unit.field_on = true
	for i in [1,2]:
		game.units[i].position = unit.position+Vector3(i,0,0)
		game.units[i].hp = 100
	game.combat._tick_special(unit,unit.slots.sp,1)
	check(absf(unit.slots.sp.sp-96)<.001,"フィールドは味方2機回復で消費2倍")
	game.loadouts.support.sp = "repair"
	isolate()
	unit = game.player
	game.loadouts.heavy.sp = "artillery"
	unit.equip("heavy")
	unit.selected = "sp"
	unit.invulnerable = 0
	game.combat._start_barrage(unit,unit.slots.sp.w,Vector3(-60,0,-20))
	game.combat.step(.01)
	check(game.combat.barrages.size()==6,"榴弾砲の6発を予約")
	check(absf(unit.slots.sp.sp-(100-100.0/6))<.001,"砲撃は発射した分だけSPを消費")
	unit.select_slot("main")
	check(game.combat.barrages.size()==1,"解除すると未発射分だけ中止")
	game.loadouts.heavy.sp = "cannon"
	await settle()
	var own_core: Dictionary = game.world.cores.B
	var blocked: Dictionary = game.combat.ray(Vector3(2,40,own_core.pos.z),own_core.pos,unit,1)
	check(not blocked.is_empty() and blocked.collider.get_meta("ref",{}).is_empty() and blocked.position.y>22,"上からのコア射線は傘に遮られる")
	unit.hp = 5000
	unit.position = Vector3(0,0,game.world.spec.baseZ-15)
	unit.on_ground = true
	unit.begin_transfer("base")
	unit.next_class = "support"
	unit.tick(11,{})
	check(unit.cls=="support" and unit.hp==5000,"基地からのエリア移動は耐久を維持して兵装変更")
	game.large_demo = true
	game.start_match("tidal",true)
	game.set_physics_process(false)
	check(game.units.size()==100,"100機は潮路の任意デモとして生成")
	var victim = game.units[0]
	var core_before: float = game.world.cores[victim.team].hp
	game.combat.wreck(victim,victim)
	check(absf(core_before-game.world.cores[victim.team].hp-11.25)<.001,"デモ時の大破コア損失は1/800")
	game.large_demo = false

func _check_weapons() -> void:
	isolate()
	var unit = game.player
	for cls in game.catalog.CLASS_IDS:
		for slot in game.catalog.SLOTS:
			var choices: Array = game.catalog.armory[cls][slot]
			for key in choices:
				game.loadouts[cls][slot] = key
				unit.equip(cls)
				unit.selected = slot
				unit.position = Vector3(-60,0,0)
				unit.repairing = false
				unit.stun = 0
				unit.electric_time = 0
				unit.invulnerable = 0
				var w: Dictionary = unit.slots[slot].w
				var before: int = game.combat.shot_count
				var control: Dictionary = {"fire":true,"aim":Vector3(-100,2.5,-60)}
				var duration: float = w.get("chargeTime",w.get("spin",0))+.2
				for i in int(ceil(duration/.05)):
					game.combat.tick_weapons(unit,.05,control)
				if w.has("chargeTime") or w.has("chargeWave") or w.get("meleeCharge",false):
					control.fire = false
					game.combat.tick_weapons(unit,.05,control)
				if w.type=="gun":
					check(game.combat.shot_count>before,"発射できる: "+key)
				else:
					check(is_finite(unit.slots[slot].sp),"特殊装備の状態: "+key)
				for shot in game.combat.projectiles:
					check(is_finite(shot.vel.length()),"飛翔弾の有限な初速: "+key)
				game.combat.projectiles.clear()
				game.combat.gadgets.clear()
				game.combat.barrages.clear()
			game.loadouts[cls][slot] = choices[0]
