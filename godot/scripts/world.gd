extends Node3D
## 既存マップの座標と1m格子を保つ。形状・衝突・施設はGodot側で管理する。
var spec: Dictionary
var heights: PackedFloat32Array
var width: int
var depth: int
var origin_x: float
var origin_z: float
var obstacles: Array[Dictionary] = []
var plants: Array[Dictionary] = []
var facilities: Array[Dictionary] = []
var pads: Array[Dictionary] = []
var lifts: Array[Dictionary] = []
var cats: Array[Dictionary] = []
var zips: Array[Dictionary] = []
var pods: Array[Dictionary] = []
var cores: Dictionary = {}
var nav: AStar3D = AStar3D.new()
var visible_geometry: bool = true
var own_team: String = "B"
var material_cache: Dictionary = {}
var obstacle_cells: Dictionary = {}

func configure(map_data: Dictionary, own: String = "B", show_geometry: bool = true) -> void:
	spec = map_data
	own_team = own
	visible_geometry = show_geometry
	var meta: Dictionary = spec.heightmap
	width = int(meta.width)
	depth = int(meta.depth)
	origin_x = meta.x0
	origin_z = meta.z0
	heights = FileAccess.get_file_as_bytes("res://data/" + meta.file).to_float32_array()
	_build_terrain()
	for entry in spec.layout:
		for sign_value in signs(entry[0], entry[1]):
			var x: float = entry[0] * sign_value
			var z: float = entry[1] * sign_value
			var w: float = entry[2]
			var d: float = entry[3]
			var h: float = entry[4]
			var low: float = terrain_h(x, z)
			var high: float = low
			for a in [-1, 1]:
				for b in [-1, 1]:
					var y: float = terrain_h(x + a * w / 2, z + b * d / 2)
					low = minf(low, y)
					high = maxf(high, y)
			var kind: String = entry[5] if entry.size() > 5 else "box"
			var colors: Dictionary = {"house": Color("c9b6a2"), "container": Color("637968"), "hesco": Color("9b8b65"), "baseWall": Color("697989"), "prefab": Color("a1a68e"), "office": Color("8e9ba4")}
			add_box(Vector3(x, (low + high + h) / 2, z), Vector3(w, high + h - low, d), colors.get(kind, Color("939a9b")))
			obstacles.append({"minX": x-w/2, "maxX": x+w/2, "minZ": z-d/2, "maxZ": z+d/2, "top": high+h})
			if visible_geometry and kind in ["container", "house", "office", "prefab"]:
				_add_building_details(x, z, w, d, high+h, kind)
	for b in spec.get("bridges", []):
		for s in signs(b[0], b[1]):
			add_box(Vector3(b[0]*s,b[4]-b[5]/2,b[1]*s),Vector3(b[2],b[5],b[3]),Color("687783"))
			obstacles.append({"minX": b[0]*s-b[2]/2,"maxX": b[0]*s+b[2]/2,"minZ": b[1]*s-b[3]/2,"maxZ": b[1]*s+b[3]/2,"top": b[4],"bottom": b[4]-b[5]})
	for entry in spec.get("water", []):
		for s in signs(entry[0], entry[1]):
			if visible_geometry:
				add_box(Vector3(entry[0]*s,entry[4],entry[1]*s),Vector3(entry[2],0.06,entry[3]),Color("365e76"),{},false)
	_build_bases()
	_build_plants()
	_build_mobility()
	rebuild_obstacle_index()
	_build_nav()

func rebuild_obstacle_index() -> void:
	obstacle_cells.clear()
	for o in obstacles:
		var min_x: float = o.minX
		var max_x: float = o.maxX
		var min_z: float = o.minZ
		var max_z: float = o.maxZ
		for lift in lifts:
			if lift.obstacle==o:
				min_x = minf(lift.from.x,lift.to.x)-lift.size[0]/2
				max_x = maxf(lift.from.x,lift.to.x)+lift.size[0]/2
				min_z = minf(lift.from.z,lift.to.z)-lift.size[1]/2
				max_z = maxf(lift.from.z,lift.to.z)+lift.size[1]/2
		for z in range(int(floor((min_z-2)/20)),int(floor((max_z+2)/20))+1):
			for x in range(int(floor((min_x-2)/20)),int(floor((max_x+2)/20))+1):
				var cell: Vector2i = Vector2i(x,z)
				if not obstacle_cells.has(cell):
					obstacle_cells[cell] = []
				obstacle_cells[cell].append(o)

func nearby_obstacles(x: float,z: float) -> Array:
	return obstacle_cells.get(Vector2i(int(floor(x/20)),int(floor(z/20))),[])

func signs(x: float, z: float) -> Array:
	return [1] if spec.get("asym", false) or (x == 0 and z == 0) else [1, -1]

func team_color(team: String) -> Color:
	return Color("3ea6ff") if team == own_team else Color("ff8a2a")

func terrain_h(x: float, z: float) -> float:
	var fx: float = clampf(x-origin_x, 0.0, width-1.001)
	var fz: float = clampf(z-origin_z, 0.0, depth-1.001)
	var i: int = int(fx)
	var j: int = int(fz)
	var a: float = fx-i
	var b: float = fz-j
	var k: int = j*width+i
	return lerpf(lerpf(heights[k],heights[k+1],a),lerpf(heights[k+width],heights[k+width+1],a),b)

func ground_at(x: float, z: float, y: float) -> float:
	var result: float = terrain_h(x,z)
	for o in nearby_obstacles(x,z):
		if x > o.minX-.78 and x < o.maxX+.78 and z > o.minZ-.78 and z < o.maxZ+.78 and o.top <= y+.6:
			result = maxf(result,o.top)
	return result

func resolve(unit) -> void:
	for o in nearby_obstacles(unit.position.x,unit.position.z):
		if unit.position.y >= o.top-.25 or unit.position.y+4 <= o.get("bottom",-INF):
			continue
		var dx: float = unit.position.x-clampf(unit.position.x,o.minX,o.maxX)
		var dz: float = unit.position.z-clampf(unit.position.z,o.minZ,o.maxZ)
		var d2: float = dx*dx+dz*dz
		if d2 >= 1.69:
			continue
		if d2 > .000001:
			var distance: float = sqrt(d2)
			unit.position.x += dx/distance*(1.3-distance)
			unit.position.z += dz/distance*(1.3-distance)
		else:
			var pens: Array = [unit.position.x-o.minX+1.3,o.maxX-unit.position.x+1.3,unit.position.z-o.minZ+1.3,o.maxZ-unit.position.z+1.3]
			match pens.find(pens.min()):
				0: unit.position.x = o.minX-1.3
				1: unit.position.x = o.maxX+1.3
				2: unit.position.z = o.minZ-1.3
				3: unit.position.z = o.maxZ+1.3

func step_to(unit, x: float, z: float) -> bool:
	var delta: Vector2 = Vector2(x-unit.position.x,z-unit.position.z)
	var count: int = maxi(1,int(ceil(delta.length()/.5)))
	var step: Vector2 = delta/count
	var y: float = unit.position.y
	for i in count:
		var th: float = terrain_h(unit.position.x+step.x,unit.position.z+step.y)
		if th-y > .05+step.length()*1.1:
			return false
		unit.position.x += step.x
		unit.position.z += step.y
		resolve(unit)
		y = maxf(y,th)
	return true

func ceiling_at(at: Vector3) -> float:
	var height: float = INF
	for o in nearby_obstacles(at.x,at.z):
		if o.has("bottom") and o.bottom >= at.y+3.95 and at.x > o.minX-.78 and at.x < o.maxX+.78 and at.z > o.minZ-.78 and at.z < o.maxZ+.78:
			height = minf(height,o.bottom)
	return height

func _build_terrain() -> void:
	var body: StaticBody3D = StaticBody3D.new()
	var collision: CollisionShape3D = CollisionShape3D.new()
	var shape: HeightMapShape3D = HeightMapShape3D.new()
	shape.map_width = width
	shape.map_depth = depth
	shape.map_data = heights
	collision.shape = shape
	body.add_child(collision)
	add_child(body)
	if not visible_geometry:
		return
	var surface: SurfaceTool = SurfaceTool.new()
	surface.begin(Mesh.PRIMITIVE_TRIANGLES)
	var stride: int = 2
	for j in range(0,depth-1,stride):
		for i in range(0,width-1,stride):
			var p: Array[Vector3] = []
			for offset in [Vector2i(0,0),Vector2i(0,stride),Vector2i(stride,0),Vector2i(stride,stride)]:
				var x: float = origin_x+mini(i+offset.x,width-1)
				var z: float = origin_z+mini(j+offset.y,depth-1)
				p.append(Vector3(x,terrain_h(x,z),z))
			for index in [0,1,2,2,1,3]:
				var tone: float = clampf(.78+p[index].y*.012,.6,1.15)
				surface.set_color(Color("777969")*tone)
				surface.add_vertex(p[index])
	surface.generate_normals()
	var mesh: MeshInstance3D = MeshInstance3D.new()
	mesh.mesh = surface.commit()
	var mat: StandardMaterial3D = StandardMaterial3D.new()
	mat.vertex_color_use_as_albedo = true
	mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	mat.roughness = .95
	mesh.material_override = mat
	add_child(mesh)

func material(color: Color, glow: bool = false) -> StandardMaterial3D:
	var key: String = color.to_html()+str(glow)
	if material_cache.has(key):
		return material_cache[key]
	var result: StandardMaterial3D = StandardMaterial3D.new()
	result.albedo_color = color
	result.roughness = .8
	if color.a < 1:
		result.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	if glow:
		result.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material_cache[key] = result
	return result

func add_box(at: Vector3, size: Vector3, color: Color, ref: Dictionary = {}, collide: bool = true) -> Node3D:
	var root: Node3D = StaticBody3D.new() if collide else Node3D.new()
	root.position = at
	root.set_meta("ref",ref)
	if collide:
		var collision: CollisionShape3D = CollisionShape3D.new()
		var shape: BoxShape3D = BoxShape3D.new()
		shape.size = size
		collision.shape = shape
		root.add_child(collision)
	if visible_geometry:
		var mesh: MeshInstance3D = MeshInstance3D.new()
		var box: BoxMesh = BoxMesh.new()
		box.size = size
		mesh.mesh = box
		mesh.material_override = material(color)
		root.add_child(mesh)
	add_child(root)
	return root

func marker(at: Vector3, radius: float, color: Color, label: String = "") -> MeshInstance3D:
	if not visible_geometry:
		return null
	var mesh: MeshInstance3D = MeshInstance3D.new()
	var cylinder: CylinderMesh = CylinderMesh.new()
	cylinder.top_radius = radius
	cylinder.bottom_radius = radius
	cylinder.height = .07
	mesh.mesh = cylinder
	mesh.position = at
	mesh.material_override = material(color,true)
	add_child(mesh)
	if not label.is_empty():
		var text: Label3D = Label3D.new()
		text.text = label
		text.position = at+Vector3(0,10,0)
		text.font_size = 96
		text.pixel_size = .03
		text.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		text.modulate = color
		add_child(text)
	return mesh

func _add_building_details(x: float,z: float,w: float,d: float,top: float,kind: String) -> void:
	var tint: Color = Color("3b4e5b") if kind != "container" else Color("8b9c83")
	for side in [-1,1]:
		for k in range(1,maxi(2,int(w/5))):
			add_box(Vector3(x-w/2+k*5,top-2.5,z+side*(d/2+.03)),Vector3(1.8,1.5,.06),tint,{},false)
	add_box(Vector3(x,top+.12,z),Vector3(w+.3,.24,d+.3),Color("49515a"),{},false)

func _build_bases() -> void:
	var max_core: float = spec.get("vs",{}).get("cost",9000.0)
	for team in ["B","R"]:
		var s: float = 1.0 if team == "B" else -1.0
		var at: Vector3 = Vector3(0,19,spec.baseZ*s)
		var core: Dictionary = {"kind":"core","team":team,"hp":max_core,"maxHp":max_core,"pos":at,"alive":true}
		cores[team] = core
		if spec.has("vs"):
			continue
		add_box(Vector3(0,1,at.z),Vector3(18,2,18),Color("55534d"))
		add_box(Vector3(0,9,at.z),Vector3(10,14,10),Color("2b3038"))
		var glow: Node3D = _core_crystal(at,team_color(team),core)
		core.node = glow
		obstacles.append({"minX":-6.0,"maxX":6.0,"minZ":at.z-6,"maxZ":at.z+6,"top":16.0})
		marker(Vector3(0,.1,at.z),26,Color(team_color(team),.14),"ベース")
		# 下の開いた傘。内外を問わず通常のレイを遮るだけで、特別な防護判定は持たない。
		_core_umbrella(at.z,team_color(team))
		for xy in spec.turrets:
			var pos: Vector3 = Vector3(xy[0]*s,0,xy[1]*s)
			pos.y = terrain_h(pos.x,pos.z)
			var turret: Dictionary = {"kind":"turret","team":team,"hp":14000.0,"maxHp":14000.0,"pos":pos+Vector3(0,3,0),"alive":true,"cd":0.0,"burst":3,"revive":0.0}
			turret.node = add_box(pos+Vector3(0,2,0),Vector3(3,4,3),team_color(team),turret)
			facilities.append(turret)
		var rpos: Vector3 = Vector3(spec.radar[0]*s,0,spec.radar[1]*s)
		rpos.y = terrain_h(rpos.x,rpos.z)+3
		var radar: Dictionary = {"kind":"radar","team":team,"hp":20000.0,"maxHp":20000.0,"pos":rpos,"alive":true,"revive":0.0}
		radar.node = add_box(rpos,Vector3(3,6,3),team_color(team),radar)
		facilities.append(radar)
		for xy in spec.basePods:
			_add_pod(xy[0]*s,xy[1]*s,"")
	for b in spec.barricades:
		for s in [1,-1]:
			var pos: Vector3 = Vector3(b[0]*s,0,b[1]*s)
			pos.y = terrain_h(pos.x,pos.z)+b[4]/2
			var wall: Dictionary = {"kind":"barricade","team":"","hp":30000.0,"maxHp":30000.0,"pos":pos,"alive":true}
			wall.node = add_box(pos,Vector3(b[2],b[4],b[3]),Color("91846c"),wall)
			wall.obstacle = {"minX":pos.x-b[2]/2,"maxX":pos.x+b[2]/2,"minZ":pos.z-b[3]/2,"maxZ":pos.z+b[3]/2,"top":pos.y+b[4]/2}
			obstacles.append(wall.obstacle)
			facilities.append(wall)

func _core_crystal(at: Vector3,color: Color,ref: Dictionary) -> Node3D:
	var ring: Array[Vector3] = [Vector3(8.5,0,0),Vector3(0,0,8.5),Vector3(-8.5,0,0),Vector3(0,0,-8.5)]
	var points: PackedVector3Array = PackedVector3Array(ring)
	points.append(Vector3(0,4.2,0))
	points.append(Vector3(0,-4.2,0))
	var surface: SurfaceTool = SurfaceTool.new()
	surface.begin(Mesh.PRIMITIVE_TRIANGLES)
	for i in 4:
		for top in [Vector3(0,4.2,0),Vector3(0,-4.2,0)]:
			var a: Vector3 = ring[i]
			var b: Vector3 = ring[(i+1)%4]
			var normal: Vector3 = (b-a).cross(top-a).normalized()
			if normal.dot((a+b+top)/3)<0:
				var swap: Vector3 = a
				a = b
				b = swap
				normal = -normal
			for vertex in [a,top,b]:
				surface.set_normal(normal)
				surface.add_vertex(vertex)
	var shape: ConvexPolygonShape3D = ConvexPolygonShape3D.new()
	shape.points = points
	return _mesh_body(at,surface.commit(),shape,material(color,true),ref)

func _core_umbrella(z: float,color: Color) -> void:
	var surface: SurfaceTool = SurfaceTool.new()
	surface.begin(Mesh.PRIMITIVE_TRIANGLES)
	var faces: PackedVector3Array = PackedVector3Array()
	for i in 48:
		var a: Vector3 = Vector3(cos(TAU*i/48)*26,13,sin(TAU*i/48)*26)
		var b: Vector3 = Vector3(cos(TAU*(i+1)/48)*26,13,sin(TAU*(i+1)/48)*26)
		var tip: Vector3 = Vector3(0,24,0)
		for vertex in [a,tip,b]:
			surface.add_vertex(vertex)
			faces.append(vertex)
	surface.generate_normals()
	var shape: ConcavePolygonShape3D = ConcavePolygonShape3D.new()
	shape.backface_collision = true
	shape.set_faces(faces)
	var mat: StandardMaterial3D = material(Color(color,.3))
	mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	_mesh_body(Vector3(0,0,z),surface.commit(),shape,mat,{})

func _mesh_body(at: Vector3,mesh: Mesh,shape: Shape3D,mat: Material,ref: Dictionary) -> Node3D:
	var body: StaticBody3D = StaticBody3D.new()
	body.position = at
	body.set_meta("ref",ref)
	var collider: CollisionShape3D = CollisionShape3D.new()
	collider.shape = shape
	body.add_child(collider)
	if visible_geometry:
		var visible_mesh: MeshInstance3D = MeshInstance3D.new()
		visible_mesh.mesh = mesh
		visible_mesh.material_override = mat
		body.add_child(visible_mesh)
	add_child(body)
	return body

func _build_plants() -> void:
	for entry in spec.plants:
		var at: Vector3 = Vector3(entry[1],terrain_h(entry[1],entry[2]),entry[2])
		var owner: String = entry[3] if entry[3] != null else ""
		var plant: Dictionary = {"id":entry[0],"pos":at,"owner":owner,"gauge":100.0 if owner=="B" else -100.0 if owner=="R" else 0.0,"capturing":false}
		plant.disc = marker(at+Vector3(0,.12,0),16,Color(team_color(owner),.22) if owner!="" else Color(.65,.7,.75,.22),entry[0])
		add_box(at+Vector3(0,3.5,0),Vector3(1,7,1),Color("61686b"))
		plants.append(plant)
	for pod in spec.plantPods:
		_add_pod(pod[1],pod[2],pod[0])

func _add_pod(x: float,z: float,plant: String) -> void:
	var at: Vector3 = Vector3(x,terrain_h(x,z),z)
	pods.append({"pos":at,"plant":plant})
	marker(at+Vector3(0,.16,0),4,Color(.3,.95,.65,.4),"補給")
	add_box(at+Vector3(0,.2,0),Vector3(6,.4,6),Color("455e5a"))

func _build_mobility() -> void:
	for entry in spec.catapults:
		for s in [1,-1]:
			var at: Vector3 = Vector3(entry[0]*s,terrain_h(entry[0]*s,entry[1]*s),entry[1]*s)
			var land: Vector3 = Vector3(entry[2]*s,terrain_h(entry[2]*s,entry[3]*s),entry[3]*s)
			cats.append({"pos":at,"exit":land})
			marker(at+Vector3(0,.15,0),3.5,Color(.95,.7,.2,.7),"射出")
	for entry in spec.get("jumpPads",[]):
		for s in signs(entry.at[0],entry.at[1]):
			var pad: Dictionary = {"pos":nav_vector(entry.at,s),"exit":nav_vector(entry.exit,s),"rise":entry.rise,"radius":entry.get("radius",3.0)}
			pads.append(pad)
			marker(pad.pos+Vector3(0,.15,0),3,Color(.35,.95,.9,.7),"↑")
	for entry in spec.get("lifts",[]):
		for s in signs(entry.from[0],entry.from[1]):
			var lift: Dictionary = {"from":nav_vector(entry.from,s),"to":nav_vector(entry.to,s),"pos":nav_vector(entry.from,s),"size":entry.get("size",[8,8]),"speed":entry.get("speed",5.0),"wait":entry.get("wait",2.0),"timer":entry.get("wait",2.0),"up":true}
			lift.node = add_box(lift.pos-Vector3(0,.3,0),Vector3(lift.size[0],.6,lift.size[1]),Color("aaa35d"))
			lift.obstacle = {"minX":lift.pos.x-lift.size[0]/2,"maxX":lift.pos.x+lift.size[0]/2,"minZ":lift.pos.z-lift.size[1]/2,"maxZ":lift.pos.z+lift.size[1]/2,"top":lift.pos.y,"bottom":lift.pos.y-.6}
			obstacles.append(lift.obstacle)
			lifts.append(lift)

func nav_vector(entry: Array, sign_value: float = 1.0) -> Vector3:
	var x: float = entry[0]*sign_value
	var z: float = entry[1]*sign_value
	return Vector3(x,entry[2] if entry.size()>2 else terrain_h(x,z),z)

func build_ziplines() -> void:
	for entry in spec.get("ziplines",[]):
		for s in signs(entry.from[0],entry.from[1]):
			var a: Vector3 = nav_vector(entry.from,s)
			var b: Vector3 = nav_vector(entry.to,s)
			if a.y>b.y:
				var swap: Vector3 = a
				a = b
				b = swap
			var direction: Vector3 = (b-a).normalized()
			var out: Vector3 = Vector3(direction.x,0,direction.z).normalized()
			if out.length_squared()<.01:
				out = Vector3.FORWARD
			var land: Vector3 = b
			for i in 25:
				var sample: Vector3 = b+out*i*.5
				if ground_at(sample.x,sample.z,b.y+.5)>=b.y-1:
					land = sample+out*2
					land.y = ground_at(land.x,land.z,b.y+.5)
					break
			zips.append({"bottom":a,"top":b,"dir":direction,"length":a.distance_to(b),"land":land})
			for endpoint in [a,b]:
				add_box(endpoint+Vector3(0,2.2,0),Vector3(.25,4.4,.25),Color("d5b966"))
			if visible_geometry:
				var line: MeshInstance3D = MeshInstance3D.new()
				var cylinder: CylinderMesh = CylinderMesh.new()
				cylinder.height = a.distance_to(b)
				cylinder.top_radius = .065
				cylinder.bottom_radius = .065
				line.mesh = cylinder
				line.position = (a+b)/2+Vector3(0,4.4,0)
				line.quaternion = Quaternion(Vector3.UP,direction)
				line.material_override = material(Color("e0c45d"))
				add_child(line)

func _build_nav() -> void:
	if spec.has("nav"):
		var nodes: Array = spec.nav.nodes
		for i in nodes.size():
			nav.add_point(i,nav_vector(nodes[i]))
		var flip: Dictionary = {}
		for i in nodes.size():
			var at: Vector3 = nav.get_point_position(i)
			if spec.get("asym",false) or at.x==0 and at.z==0:
				flip[i] = i
			else:
				var mirror: int = nav.get_point_count()
				nav.add_point(mirror,at*Vector3(-1,1,-1))
				flip[i] = mirror
				flip[mirror] = i
		for link in spec.nav.links:
			var a: int = flip[int(link[0].substr(1))] if link[0] is String else int(link[0])
			var b: int = flip[int(link[1].substr(1))] if link[1] is String else int(link[1])
			if a!=b:
				nav.connect_points(a,b)
				if not spec.get("asym",false):
					nav.connect_points(flip[a],flip[b])
	else:
		# 古いマップの地上経路。壁と急斜面を検査した格子を使う。
		var step: float = 15.0
		var nx: int = int(spec.size[0]*2/step)
		var nz: int = int(spec.size[1]*2/step)
		for j in range(1,nz):
			for i in range(1,nx):
				var x: float = -spec.size[0]+i*step
				var z: float = -spec.size[1]+j*step
				var y: float = terrain_h(x,z)
				var free: bool = true
				for o in nearby_obstacles(x,z):
					if x>o.minX-2 and x<o.maxX+2 and z>o.minZ-2 and z<o.maxZ+2 and y<o.top-.6:
						free = false
				if free:
					nav.add_point(j*nx+i,Vector3(x,y,z))
		for id in nav.get_point_ids():
			for offset in [1,nx,nx+1,nx-1]:
				if nav.has_point(id+offset) and walk_clear(nav.get_point_position(id),nav.get_point_position(id+offset)):
					nav.connect_points(id,id+offset)

func walk_clear(a: Vector3,b: Vector3) -> bool:
	var count: int = maxi(1,int(ceil(a.distance_to(b))))
	var previous: Vector3 = a
	for i in range(1,count+1):
		var p: Vector3 = a.lerp(b,float(i)/count)
		var h: float = ground_at(p.x,p.z,previous.y)
		if absf(h-previous.y)>1.15:
			return false
		for o in nearby_obstacles(p.x,p.z):
			if p.x>o.minX-1.5 and p.x<o.maxX+1.5 and p.z>o.minZ-1.5 and p.z<o.maxZ+1.5 and p.y<o.top-.25 and p.y+4>o.get("bottom",-INF):
				return false
		previous = Vector3(p.x,h,p.z)
	return absf(previous.y-b.y)<1.0

func path_between(a: Vector3,b: Vector3) -> PackedVector3Array:
	if nav.get_point_count()==0:
		return PackedVector3Array([b])
	return nav.get_point_path(nav.get_closest_point(a),nav.get_closest_point(b))
