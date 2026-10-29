extends RefCounted
## Godot側の独立したデータ。取り込み後はブラウザ版を読まない。
const SLOTS = ["main", "sub", "aux", "sp"]
const CLASS_IDS = ["assault", "heavy", "raid", "support"]
var data: Dictionary
var weapons: Dictionary
var parts: Dictionary
var maps: Dictionary
var armory: Dictionary

func _init() -> void:
	data = JSON.parse_string(FileAccess.get_file_as_string("res://data/catalog.json"))
	weapons = data.weapons
	parts = data.parts
	maps = data.maps
	armory = data.armory

func default_loadout(cls: String) -> Dictionary:
	var result: Dictionary = {}
	for slot in SLOTS:
		result[slot] = armory[cls][slot][0]
	return result

func stats(config: Dictionary, loadout: Dictionary) -> Dictionary:
	var p: Dictionary = {}
	var series: String = parts.head[config.head].series
	var same: bool = true
	for slot in ["head", "body", "arms", "legs"]:
		p[slot] = parts[slot][config[slot]].duplicate(true)
		same = same and p[slot].series == series
	if same:
		for effect in data.partSeries[series].set.fx:
			if effect[2] == "mul":
				p[effect[0]][effect[1]] *= effect[3]
			else:
				p[effect[0]][effect[1]] += effect[3]
	var weight: float = 0.0
	for slot in ["head", "body", "arms", "legs"]:
		weight += p[slot].weight
	for slot in SLOTS:
		weight += data.weights.get(loadout[slot], 0.0)
	var excess: float = maxf(0.0, weight - p.legs.cap)
	var slow: float = minf(1.0, excess / 4000.0)
	return {"parts": p, "weight": weight, "excess": excess,
		"walk": maxf(3.5, p.legs.walk * (1.0 - slow)) * 13.0 / 6.0,
		"dash": maxf(10.0, p.legs.dash * (1.0 - slow)) * 46.0 / 21.8,
		"cruise": maxf(9.0, p.legs.cruise * (1.0 - slow)) * 30.0 / 19.7}

func random_mech(cls: String, rng: RandomNumberGenerator) -> Dictionary:
	var config: Dictionary = data.mechDefault.duplicate()
	for slot in ["head", "body", "arms"]:
		var choices: Array = parts[slot].keys()
		config[slot] = choices[rng.randi_range(0, choices.size() - 1)]
	var candidates: Array = []
	var best: String = "standard"
	for key in parts.legs:
		if parts.legs[key].cap > parts.legs[best].cap:
			best = key
		config.legs = key
		if stats(config, default_loadout(cls)).excess <= 300:
			candidates.append(key)
	config.legs = candidates[rng.randi_range(0, candidates.size() - 1)] if not candidates.is_empty() else best
	return config
