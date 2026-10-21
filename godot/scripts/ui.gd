extends Control
## ネイティブのメニューとHUD。ブラウザのDOMや保存領域から独立している。
var game
var font: SystemFont
var menu: Control
var pause_panel: Control
var result_panel: Control
var map_select: OptionButton
var class_select: OptionButton
var team_select: OptionButton
var name_input: LineEdit
var weapon_selects: Dictionary = {}
var part_selects: Dictionary = {}
var map_ids: Array = []
var pilot_texture: Texture2D
var score_scroll: int = 0
var accent: Color = Color("5fd0c0")
var ink: Color = Color("dbe8f1")
var muted: Color = Color("8ca2b4")

func configure(match_node) -> void:
	game = match_node

func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	font = SystemFont.new()
	font.font_names = PackedStringArray(["Noto Sans CJK JP","Yu Gothic","Meiryo","DejaVu Sans"])
	pilot_texture = load("res://assets/pilots.png")
	var skin: Theme = Theme.new()
	skin.default_font = font
	skin.default_font_size = 16
	skin.set_color("font_color","Label",ink)
	skin.set_color("font_color","Button",ink)
	skin.set_stylebox("normal","Button",_style(Color("243748"),Color("426075")))
	skin.set_stylebox("hover","Button",_style(Color("314b5e"),accent))
	skin.set_stylebox("pressed","Button",_style(Color("173e43"),accent))
	theme = skin
	_build_menu()
	_build_pause()

func _style(color: Color,border: Color) -> StyleBoxFlat:
	var style: StyleBoxFlat = StyleBoxFlat.new()
	style.bg_color = color
	style.border_color = border
	style.set_border_width_all(1)
	style.set_corner_radius_all(5)
	style.content_margin_left = 16
	style.content_margin_right = 16
	style.content_margin_top = 9
	style.content_margin_bottom = 9
	return style

func _panel(width: float) -> Array:
	var center: CenterContainer = CenterContainer.new()
	center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(center)
	var card: PanelContainer = PanelContainer.new()
	card.custom_minimum_size.x = width
	card.add_theme_stylebox_override("panel",_style(Color(.045,.075,.11,.97),Color("365466")))
	center.add_child(card)
	var column: VBoxContainer = VBoxContainer.new()
	column.add_theme_constant_override("separation",9)
	card.add_child(column)
	return [center,column]

func _label(parent: Node,text: String,point_size: int = 16,color: Color = Color.WHITE) -> Label:
	var label: Label = Label.new()
	label.text = text
	label.add_theme_font_size_override("font_size",point_size)
	label.add_theme_color_override("font_color",color)
	parent.add_child(label)
	return label

func _button(parent: Node,text: String,action: Callable) -> Button:
	var button: Button = Button.new()
	button.text = text
	button.custom_minimum_size.y = 40
	button.pressed.connect(action)
	parent.add_child(button)
	return button

func _row(parent: Node,label: String) -> HBoxContainer:
	var row: HBoxContainer = HBoxContainer.new()
	parent.add_child(row)
	var title: Label = _label(row,label,15,muted)
	title.custom_minimum_size.x = 110
	return row

func _build_menu() -> void:
	var pair: Array = _panel(780)
	menu = pair[0]
	var column: VBoxContainer = pair[1]
	_label(column,"CORE BREAKER",32,ink)
	_label(column,"GODOT EDITION  /  オフライン対戦",14,accent)
	var profile: HBoxContainer = _row(column,"プレイヤー名")
	name_input = LineEdit.new()
	name_input.text = game.player_name
	name_input.max_length = 20
	name_input.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	profile.add_child(name_input)
	name_input.text_changed.connect(func(value):game.player_name=value.strip_edges();game.save_settings())
	var map_row: HBoxContainer = _row(column,"戦場")
	map_select = OptionButton.new()
	map_select.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	map_select.clip_text = true
	for id in game.catalog.maps:
		if game.catalog.maps[id].get("testOnly",false):
			continue
		map_ids.append(id)
		var spec: Dictionary = game.catalog.maps[id]
		map_select.add_item(spec.name+"  [%d対%d]" % [spec.team,spec.team])
	map_row.add_child(map_select)
	map_select.select(maxi(0,map_ids.find(game.map_id)))
	map_select.item_selected.connect(func(i):game.map_id=map_ids[i])
	var team_row: HBoxContainer = _row(column,"出撃側")
	team_select = OptionButton.new()
	team_select.add_item("南側から出撃（自軍は青）")
	team_select.add_item("北側から出撃（自軍は青）")
	team_select.select(0 if game.own_team=="B" else 1)
	team_select.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	team_row.add_child(team_select)
	team_select.item_selected.connect(func(i):game.own_team="B" if i==0 else "R";game.save_settings())
	var pilot_row: HBoxContainer = _row(column,"パイロット")
	var pilot: OptionButton = OptionButton.new()
	for i in 8:
		pilot.add_item("ねこ %d" % (i+1))
	pilot.select(game.pilot_index)
	pilot_row.add_child(pilot)
	pilot.item_selected.connect(func(i):game.pilot_index=i;game.save_settings())
	var demo: CheckBox = CheckBox.new()
	demo.text = "50対50デモ（潮路搬送区のみ）"
	pilot_row.add_child(demo)
	demo.toggled.connect(func(on):game.large_demo=on)
	var loadout_row: HBoxContainer = HBoxContainer.new()
	column.add_child(loadout_row)
	var weapon_column: VBoxContainer = VBoxContainer.new()
	weapon_column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	loadout_row.add_child(weapon_column)
	var class_row: HBoxContainer = _row(weapon_column,"兵装")
	class_select = OptionButton.new()
	for id in game.catalog.CLASS_IDS:
		class_select.add_item(game.catalog.data.classes[id].name)
	class_select.select(game.catalog.CLASS_IDS.find(game.chosen_class))
	class_select.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	class_row.add_child(class_select)
	class_select.item_selected.connect(func(i):game.chosen_class=game.catalog.CLASS_IDS[i];_populate_weapons())
	for i in 4:
		var slot: String = game.catalog.SLOTS[i]
		var row: HBoxContainer = _row(weapon_column,["1 主武器","2 副武器","3 補助装備","4 特別装備"][i])
		var picker: OptionButton = OptionButton.new()
		picker.clip_text = true
		picker.custom_minimum_size.x = 230
		picker.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(picker)
		weapon_selects[slot] = picker
		picker.item_selected.connect(func(index):game.loadouts[game.chosen_class][slot]=game.catalog.armory[game.chosen_class][slot][index];game.save_settings())
	var part_column: VBoxContainer = VBoxContainer.new()
	part_column.custom_minimum_size.x = 230
	loadout_row.add_child(part_column)
	_label(part_column,"機体パーツ",16,accent)
	var parts: Array = ["head","body","arms","legs"]
	for i in 4:
		var slot: String = parts[i]
		_label(part_column,["頭部","胴部","腕部","脚部"][i],13,muted)
		var picker: OptionButton = OptionButton.new()
		var keys: Array = game.catalog.parts[slot].keys()
		for key in keys:
			picker.add_item(game.catalog.parts[slot][key].model)
		picker.select(keys.find(game.mech[slot]))
		picker.item_selected.connect(func(index):game.mech[slot]=keys[index];game.save_settings())
		part_column.add_child(picker)
		part_selects[slot] = picker
	_populate_weapons()
	var buttons: HBoxContainer = HBoxContainer.new()
	column.add_child(buttons)
	var start: Button = _button(buttons,"出撃",func():game.player_name=name_input.text.strip_edges();game.player_name="パイロット" if game.player_name.is_empty() else game.player_name;game.save_settings();game.start_match(game.map_id))
	start.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_button(buttons,"オプション",func():menu.hide();pause_panel.show())
	_button(buttons,"終了",func():get_tree().quit())
	_label(column,"WASD 移動  /  マウス 照準・左射撃  /  Shift ブースト  /  Space ジャンプ",12,muted)
	_label(column,"1–4 武器  /  R 装填  /  Z X C V 次の兵装  /  H 転送  /  E ジップ  /  M 地図  /  Tab スコア",12,muted)

func _populate_weapons() -> void:
	for slot in weapon_selects:
		var picker: OptionButton = weapon_selects[slot]
		picker.clear()
		var keys: Array = game.catalog.armory[game.chosen_class][slot]
		for key in keys:
			var w: Dictionary = game.catalog.weapons[key]
			picker.add_item(w.get("model","")+" "+w.name)
		picker.select(keys.find(game.loadouts[game.chosen_class][slot]))

func _build_pause() -> void:
	var pair: Array = _panel(580)
	pause_panel = pair[0]
	var column: VBoxContainer = pair[1]
	_label(column,"オプション",27,ink)
	for spec in [["master","全体音量",0,1,.01],["sfx","効果音",0,1,.01],["music","BGM",0,1,.01],["fov","視野角",60,100,1],["sensitivity","マウス感度",.2,3,.05]]:
		var row: HBoxContainer = _row(column,spec[1])
		var slider: HSlider = HSlider.new()
		slider.min_value = spec[2]
		slider.max_value = spec[3]
		slider.step = spec[4]
		slider.value = game.options[spec[0]]
		slider.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(slider)
		var value: Label = _label(row,"%.2f" % slider.value,14,ink)
		value.custom_minimum_size.x = 55
		slider.value_changed.connect(func(amount):game.options[spec[0]]=amount;value.text="%.2f" % amount;game.save_settings())
	var hud_row: HBoxContainer = _row(column,"HUD")
	var hud: OptionButton = OptionButton.new()
	hud.add_item("アーケード")
	hud.add_item("メカニカル")
	hud.select(1 if game.options.hud=="mechanical" else 0)
	hud_row.add_child(hud)
	hud.item_selected.connect(func(i):game.options.hud="arcade" if i==0 else "mechanical";game.save_settings())
	_button(column,"戻る",_close_options)
	_button(column,"出撃画面へ",func():game.playing=false;game.paused=false;game.music.stop();pause_panel.hide();show_menu())
	_label(column,"音源：Freesound の作者の皆さま、Centurion_of_war さんに感謝します。",12,muted)
	_label(column,"出典とライセンスは assets/audio/CREDITS.md に同梱しています。",12,muted)
	pause_panel.hide()

func _close_options() -> void:
	pause_panel.hide()
	game.paused = false
	if game.playing and not game.ended:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	else:
		menu.show()

func show_menu() -> void:
	if menu!=null:
		menu.show()
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	if result_panel!=null:
		result_panel.queue_free()
		result_panel = null

func show_battle() -> void:
	menu.hide()
	pause_panel.hide()
	if result_panel!=null:
		result_panel.queue_free()
		result_panel = null

func show_pause(open: bool) -> void:
	pause_panel.visible = open

func show_results() -> void:
	var pair: Array = _panel(660)
	result_panel = pair[0]
	var column: VBoxContainer = pair[1]
	var own: float = game.world.cores[game.own_team].hp
	var enemy: float = game.world.cores["R" if game.own_team=="B" else "B"].hp
	_label(column,"勝利" if own>enemy else "敗北" if own<enemy else "引き分け",36,accent)
	_label(column,"自軍 %.1f%%   /   敵軍 %.1f%%" % [own/game.world.cores.B.maxHp*100,enemy/game.world.cores.R.maxHp*100],20,ink)
	var ranked: Array = game.units.duplicate()
	ranked.sort_custom(func(a,b):return a.score.total>b.score.total)
	for unit in ranked.slice(0,8):
		_label(column,"%-12s   %3dpt   撃破 %2d / 大破 %2d / 占拠 %2d" % [unit.callsign,unit.score.total,unit.score.kills,unit.score.deaths,unit.score.caps],15,game.world.team_color(unit.team))
	_button(column,"同じ条件で再戦",func():game.start_match(game.map_id))
	_button(column,"出撃画面へ",func():game.playing=false;show_menu())

func _text(at: Vector2,text: String,point_size: int = 16,color: Color = Color.WHITE) -> void:
	draw_string(font,at,text,HORIZONTAL_ALIGNMENT_LEFT,-1,point_size,color)

func _bar(rect: Rect2,fraction: float,color: Color) -> void:
	draw_rect(rect,Color(.02,.05,.08,.8))
	draw_rect(Rect2(rect.position,Vector2(rect.size.x*clampf(fraction,0,1),rect.size.y)),color)

func _draw() -> void:
	if game==null or font==null:
		return
	ink = Color("b7d2c7") if game.options.hud=="mechanical" else Color("dbe8f1")
	muted = Color("7e9d90") if game.options.hud=="mechanical" else Color("8ca2b4")
	var screen: Vector2 = get_viewport_rect().size
	if not game.playing:
		draw_rect(Rect2(Vector2.ZERO,screen),Color("101c28"))
		for i in range(0,int(screen.x),80):
			draw_line(Vector2(i,0),Vector2(i,screen.y),Color(.2,.4,.45,.08))
		return
	if game.player==null or game.world==null:
		return
	var unit = game.player
	var own: Dictionary = game.world.cores[game.own_team]
	var enemy: Dictionary = game.world.cores["R" if game.own_team=="B" else "B"]
	var center: Vector2 = screen/2
	var own_color: Color = Color("3ea6ff")
	var foe_color: Color = Color("ff8a2a")
	_bar(Rect2(Vector2(center.x-320,27),Vector2(250,12)),own.hp/own.maxHp,own_color)
	_bar(Rect2(Vector2(center.x+70,27),Vector2(250,12)),enemy.hp/enemy.maxHp,foe_color)
	_text(Vector2(center.x-320,22),"自軍 %.1f%%" % (own.hp/own.maxHp*100),13,own_color)
	_text(Vector2(center.x+70,22),"敵軍 %.1f%%" % (enemy.hp/enemy.maxHp*100),13,foe_color)
	_text(Vector2(center.x-28,39),"%02d:%02d" % [int(game.time_left)/60,int(game.time_left)%60],22,ink)
	var plant_x: float = center.x-game.world.plants.size()*27
	for plant in game.world.plants:
		var color: Color = game.world.team_color(plant.owner) if plant.owner!="" else muted
		draw_circle(Vector2(plant_x,65),13,Color(color,.7))
		_text(Vector2(plant_x-6,71),plant.id,16,ink)
		if plant.capturing:
			draw_arc(Vector2(plant_x,65),17,-PI/2,-PI/2+TAU*absf(plant.gauge)/100,24,color,2,true)
		plant_x += 54
	if unit.alive:
		var w: Dictionary = unit.slots[unit.selected].w
		if game.options.hud=="mechanical":
			for sx in [-1,1]:
				for sy in [-1,1]:
					var corner: Vector2 = center+Vector2(sx*30,sy*25)
					draw_line(corner,corner+Vector2(-sx*10,0),ink,1)
					draw_line(corner,corner+Vector2(0,-sy*8),ink,1)
		else:
			draw_arc(center,29,0,TAU,48,Color(.75,.88,.95,.5),1,true)
		var ammo: float = float(unit.slots[unit.selected].ammo)/maxf(1,w.get("mag",0)) if w.has("mag") else unit.slots.sp.sp/100
		draw_arc(center,33,PI/2,PI/2+PI*ammo,32,Color("74d2e5"),3,true)
		draw_arc(center,33,-PI/2,-PI/2+PI*unit.hp/unit.max_hp,32,own_color,3,true)
		draw_arc(center,42,-PI/2,-PI/2+PI*unit.boost/unit.max_boost,32,Color("f4d375") if not unit.overheat else Color("f26157"),3,true)
		draw_line(center+Vector2(-5,0),center+Vector2(5,0),ink,1)
		draw_line(center+Vector2(0,-5),center+Vector2(0,5),ink,1)
		_draw_warnings(unit,center)
		if game.hit_marker>0:
			for s in [-1,1]:
				draw_line(center+Vector2(s*8,8),center+Vector2(s*15,15),Color("ffe4a0"),2)
				draw_line(center+Vector2(s*8,-8),center+Vector2(s*15,-15),Color("ffe4a0"),2)
		if is_instance_valid(unit.locked) and not game.camera.is_position_behind(unit.locked.position):
			var locked_at: Vector2 = game.camera.unproject_position(unit.locked.position+Vector3(0,2.5,0))
			draw_rect(Rect2(locked_at-Vector2(22,30),Vector2(44,60)),Color("ffdf8c"),false,2)
		if unit.scoped:
			draw_circle(center,screen.y*.32,Color(.02,.07,.08,.08))
			draw_line(Vector2(0,center.y),Vector2(screen.x,center.y),Color(.2,.5,.4,.4))
			draw_line(Vector2(center.x,0),Vector2(center.x,screen.y),Color(.2,.5,.4,.4))
		if unit.transfer>0:
			_text(center+Vector2(-120,85),"エリア移動 %s / %.1f秒" % [unit.transfer_target,unit.transfer],19,accent)
		if unit.repairing:
			_text(center+Vector2(-60,85),"補給・修理中",18,accent)
	else:
		_text(center+Vector2(-150,-30),"行動不能：Fで再出撃へ" if unit.downed else "再出撃まで %.1f秒" % maxf(0,unit.respawn_time),23,ink)
		_text(center+Vector2(-150,5),"出撃地点："+unit.spawn_choice+"  ホイールで変更",16,accent)
		_text(center+Vector2(-150,35),"Z 強襲 / X 重火力 / C 遊撃 / V 支援",15,muted)
	_draw_status(unit,screen)
	_draw_minimap(Rect2(Vector2(screen.x-230,95),Vector2(210,235)),false)
	for i in game.feed.size():
		_text(Vector2(22,118+i*23),game.feed[i].text,14,ink)
	_draw_tags(unit)
	if game.map_open:
		_draw_minimap(big_map_rect(),true)
		if unit.slots[unit.selected].w.type=="artillery":
			_text(big_map_rect().position+Vector2(15,26),"クリックで砲撃地点を指定 / 右クリックで解除",15,ink)
	if Input.is_physical_key_pressed(KEY_TAB):
		_draw_scoreboard(screen)
	_text(Vector2(22,screen.y-12),game.world.spec.name+"    F3 オプション",12,muted)

func _draw_status(unit,screen: Vector2) -> void:
	var y: float = screen.y-160
	if pilot_texture!=null:
		var tile: Vector2 = pilot_texture.get_size()/Vector2(4,2)
		var region: Rect2 = Rect2(Vector2(game.pilot_index%4,int(game.pilot_index/4))*tile,tile)
		draw_texture_rect_region(pilot_texture,Rect2(Vector2(18,y-35),Vector2(144,144)),region)
		_text(Vector2(24,y+125),game.player_name,17,ink)
	draw_rect(Rect2(Vector2(168,y+16),Vector2(220,96)),Color(.035,.065,.095,.75))
	_text(Vector2(180,y+37),game.catalog.data.classes[unit.cls].name+"  HP %d / %d" % [unit.hp,unit.max_hp],14,muted)
	_bar(Rect2(Vector2(180,y+48),Vector2(192,10)),unit.hp/unit.max_hp,Color("55aaff"))
	_bar(Rect2(Vector2(180,y+68),Vector2(192,7)),unit.boost/unit.max_boost,Color("e1c26b"))
	_bar(Rect2(Vector2(180,y+85),Vector2(192,7)),unit.slots.sp.sp/100,accent)
	if unit.charger_on or unit.cloak or unit.field_on or unit.barrier_on or unit.escort_on:
		_text(Vector2(180,y+109),unit.slots.sp.w.name+" 作動中",12,accent)
	for i in 4:
		var slot: Dictionary = unit.slots[game.catalog.SLOTS[i]]
		var at: Vector2 = Vector2(screen.x-365,screen.y-174+i*34)
		var active: bool = unit.selected==game.catalog.SLOTS[i]
		if active:
			draw_rect(Rect2(at-Vector2(8,23),Vector2(350,32)),Color(.06,.16,.2,.85))
		var ammo: String = "%d / %d" % [slot.ammo,slot.reserve] if slot.w.has("mag") else "%d%%" % slot.sp
		if slot.reload>0:
			ammo = "装填 %.1f" % slot.reload
		_text(at,str(i+1)+" "+slot.w.name,14,ink if active else muted)
		_text(at+Vector2(245,0),ammo,13,accent if active else muted)

func _draw_warnings(unit,center: Vector2) -> void:
	for enemy in game.units:
		if not enemy.alive or enemy.team==unit.team or enemy.locked!=unit:
			continue
		var direction: Vector2 = warning_direction(unit,enemy.position)
		var tangent: Vector2 = direction.orthogonal()
		var fired: bool = enemy.firing_until>game.elapsed
		var at: Vector2 = center+direction*63
		var length: float = 22 if fired else 16
		var half_width: float = 8 if fired else 6
		var points: PackedVector2Array = PackedVector2Array([at+direction*length*.5,at-direction*length*.5+tangent*half_width,at-direction*length*.5-tangent*half_width])
		draw_colored_polygon(points,Color(1,.22,.17,.65) if fired else Color(1,.62,.17,.55))

func warning_direction(unit,source: Vector3) -> Vector2:
	var delta: Vector3 = source-unit.position
	var angle: float = unit.yaw-atan2(-delta.x,-delta.z)-PI/2
	return Vector2(cos(angle),sin(angle))

func _draw_minimap(rect: Rect2,full: bool) -> void:
	draw_rect(rect,Color(.025,.05,.075,.92))
	draw_rect(rect,Color(.25,.45,.55,.8),false,1)
	var spec: Dictionary = game.world.spec
	var scale: float = minf(rect.size.x/(spec.size[0]*2+20),rect.size.y/(spec.size[1]*2+20))
	var center: Vector2 = rect.get_center()
	for obstacle in game.world.obstacles:
		var at: Vector2 = center+Vector2(obstacle.minX,obstacle.minZ)*scale
		var dims: Vector2 = Vector2(obstacle.maxX-obstacle.minX,obstacle.maxZ-obstacle.minZ)*scale
		draw_rect(Rect2(at,dims),Color(.33,.4,.43,.75))
	for plant in game.world.plants:
		var at: Vector2 = center+Vector2(plant.pos.x,plant.pos.z)*scale
		draw_circle(at,5 if full else 3,game.world.team_color(plant.owner) if plant.owner!="" else muted)
		if full:
			_text(at+Vector2(7,4),plant.id,15,ink)
	for unit in game.units:
		if not unit.alive:
			continue
		if unit.team!=game.own_team and unit.spotted_until<game.elapsed:
			continue
		var at: Vector2 = center+Vector2(unit.position.x,unit.position.z)*scale
		draw_circle(at,4 if unit==game.player else 2,ink if unit==game.player else game.world.team_color(unit.team))
	for team in ["B","R"]:
		var at: Vector2 = center+Vector2(0,spec.baseZ*(1 if team=="B" else -1))*scale
		draw_rect(Rect2(at-Vector2(4,4),Vector2(8,8)),game.world.team_color(team))
	if full and game.player.slots[game.player.selected].w.type=="artillery":
		var origin: Vector2 = center+Vector2(game.player.position.x,game.player.position.z)*scale
		draw_arc(origin,game.player.slots.sp.w.range*scale,0,TAU,64,Color(.4,1,.8,.7),1,true)
		var at: Vector2 = center+Vector2(game.artillery_target.x,game.artillery_target.z)*scale
		draw_circle(at,5,Color("ffc16a"))

func big_map_rect() -> Rect2:
	var screen: Vector2 = get_viewport_rect().size
	var side: float = minf(screen.y-100,650)
	return Rect2(screen/2-Vector2(side/2,side/2),Vector2(side,side))

func map_world_at(at: Vector2) -> Vector3:
	var rect: Rect2 = big_map_rect()
	var spec: Dictionary = game.world.spec
	var scale: float = minf(rect.size.x/(spec.size[0]*2+20),rect.size.y/(spec.size[1]*2+20))
	var point: Vector2 = (at-rect.get_center())/scale
	return Vector3(point.x,game.world.terrain_h(point.x,point.y),point.y)

func _draw_tags(viewer) -> void:
	for unit in game.units:
		if unit==viewer or not unit.alive or game.camera.is_position_behind(unit.position):
			continue
		if unit.position.distance_to(viewer.position)>130:
			continue
		if unit.team!=viewer.team and (unit.cloak or not game.combat.can_see(game.camera.global_position,unit.position+Vector3(0,3.8,0))):
			continue
		var at: Vector2 = game.camera.unproject_position(unit.position+Vector3(0,5,0))
		var color: Color = game.world.team_color(unit.team)
		_text(at+Vector2(-25,-7),unit.callsign,12,color)
		_bar(Rect2(at+Vector2(-25,0),Vector2(50,4)),unit.hp/unit.max_hp,color)

func _draw_scoreboard(screen: Vector2) -> void:
	var rect: Rect2 = Rect2(Vector2(screen.x/2-340,90),Vector2(680,screen.y-180))
	draw_rect(rect,Color(.025,.055,.085,.95))
	_text(rect.position+Vector2(22,30),"スコア       撃破 / 大破 / 支援 / 占拠",19,ink)
	var ranked: Array = game.units.duplicate()
	ranked.sort_custom(func(a,b):return a.score.total>b.score.total)
	var rows: int = maxi(1,int((rect.size.y-80)/24))
	score_scroll = clampi(score_scroll,0,maxi(0,ranked.size()-rows))
	for i in mini(rows,ranked.size()):
		var unit = ranked[i+score_scroll]
		_text(rect.position+Vector2(22,58+i*24),"%-14s  %4dpt      %2d / %2d / %2d / %2d" % [unit.callsign,unit.score.total,unit.score.kills,unit.score.deaths,unit.score.assists,unit.score.caps],14,game.world.team_color(unit.team))
	if ranked.size()>rows:
		_text(rect.position+Vector2(22,rect.size.y-12),"Tab＋ホイールでスクロール",12,muted)
