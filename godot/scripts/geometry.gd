extends RefCounted
## ブラウザ版のオリジナル頂点と関節をGodotのArrayMesh/Skeleton3Dへ変換。
var catalog
var meshes: Dictionary = {}

func _init(data_source) -> void:
	catalog = data_source

func mesh_file(filename: String,tint: Color) -> ArrayMesh:
	var key: String = filename+tint.to_html()
	if meshes.has(key):
		return meshes[key]
	var floats: PackedFloat32Array = FileAccess.get_file_as_bytes("res://assets/geometry/"+filename).to_float32_array()
	var count: int = floats.size()/10
	var vertices: PackedVector3Array = PackedVector3Array()
	var normals: PackedVector3Array = PackedVector3Array()
	var colors: PackedColorArray = PackedColorArray()
	var bones: PackedInt32Array = PackedInt32Array()
	var weights: PackedFloat32Array = PackedFloat32Array()
	vertices.resize(count)
	normals.resize(count)
	colors.resize(count)
	bones.resize(count*4)
	weights.resize(count*4)
	var blue: Color = Color("3ea6ff")
	for i in count:
		var j: int = i*10
		vertices[i] = Vector3(floats[j],floats[j+1],floats[j+2])
		normals[i] = Vector3(floats[j+3],floats[j+4],floats[j+5])
		var color: Color = Color(floats[j+6],floats[j+7],floats[j+8])
		if absf(color.r-blue.r)<.002 and absf(color.g-blue.g)<.002 and absf(color.b-blue.b)<.002:
			color = tint
		colors[i] = color
		bones[i*4] = int(floats[j+9])
		weights[i*4] = 1.0
	var arrays: Array = []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_COLOR] = colors
	if filename.begins_with("part-"):
		arrays[Mesh.ARRAY_BONES] = bones
		arrays[Mesh.ARRAY_WEIGHTS] = weights
	var mesh: ArrayMesh = ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES,arrays)
	var material: StandardMaterial3D = StandardMaterial3D.new()
	material.vertex_color_use_as_albedo = true
	material.roughness = .8
	mesh.surface_set_material(0,material)
	meshes[key] = mesh
	return mesh

func skeleton() -> Skeleton3D:
	var result: Skeleton3D = Skeleton3D.new()
	result.name = "Skeleton"
	for bone in catalog.data.geometry.bones:
		result.add_bone(bone.name)
	for i in catalog.data.geometry.bones.size():
		var bone: Dictionary = catalog.data.geometry.bones[i]
		result.set_bone_parent(i,int(bone.parent))
		result.set_bone_rest(i,Transform3D(Basis.IDENTITY,Vector3(bone.rest[0],bone.rest[1],bone.rest[2])))
	result.reset_bone_poses()
	return result

func skin() -> Skin:
	var result: Skin = Skin.new()
	for i in catalog.data.geometry.bones.size():
		var p: Array = catalog.data.geometry.bones[i].global
		result.add_bind(i,Transform3D(Basis.IDENTITY,-Vector3(p[0],p[1],p[2])))
	return result
