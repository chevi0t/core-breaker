extends SceneTree
## 描画ありのGodotで、メニューと実際の3D画面を保存する。
func _initialize() -> void:
	call_deferred("run")

func run() -> void:
	var scene: PackedScene = load("res://scenes/main.tscn")
	var game = scene.instantiate()
	root.add_child(game)
	await process_frame
	await RenderingServer.frame_post_draw
	var folder: String = OS.get_environment("GODOT_CAPTURE_DIR")
	if folder.is_empty():
		folder = ProjectSettings.globalize_path("user://captures")
	DirAccess.make_dir_recursive_absolute(folder)
	root.get_texture().get_image().save_png(folder+"/menu.png")
	game.random_bot_weapons = false
	game.start_match("tidal",false)
	game.set_physics_process(false)
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	await physics_frame
	game.player.position = Vector3(-63,game.world.terrain_h(-63,350),350)
	game.player.yaw = 0
	game.player.pitch = -.08
	game.player.invulnerable = 0
	var enemy = game.units[game.units.size()/2]
	enemy.equip("assault")
	enemy.position = Vector3(-63,game.world.terrain_h(-63,335),335)
	enemy.yaw = PI
	enemy.invulnerable = 0
	enemy.locked = game.player
	game.player.locked = enemy
	game._update_camera(0)
	for i in 3:
		await process_frame
	await RenderingServer.frame_post_draw
	root.get_texture().get_image().save_png(folder+"/battle.png")
	game.combat.tick_weapons(enemy,.05,{"fire":true,"aim":game.player.position+Vector3(0,2.6,0)})
	game.combat.step(.015)
	await process_frame
	await RenderingServer.frame_post_draw
	root.get_texture().get_image().save_png(folder+"/fired.png")
	game.ui.show_pause(true)
	await process_frame
	await RenderingServer.frame_post_draw
	root.get_texture().get_image().save_png(folder+"/options.png")
	var file: FileAccess = FileAccess.open(folder+"/capture.json",FileAccess.WRITE)
	file.store_string(JSON.stringify({"engine":Engine.get_version_info().string,"fixture":"目視用の固定配置。通常の対戦成績ではない。","map":"tidal","player":[game.player.position.x,game.player.position.y,game.player.position.z],"enemy":[enemy.position.x,enemy.position.y,enemy.position.z],"actualShots":game.combat.shot_count},"  "))
	print("GODOT_CAPTURE "+folder)
	enemy = null
	game.free()
	game = null
	await process_frame
	# 音声スレッドが停止したストリームを解放するまで待つ。
	await create_timer(.15).timeout
	quit()
