#!/usr/bin/env python3
"""外部通信をせず、OSM の輪郭・中庭・高さ・地下除外を検査する。"""
import importlib.util
import pathlib
import tempfile
import unittest

SPEC=importlib.util.spec_from_file_location('mapgen_osm',pathlib.Path(__file__).parents[1]/'mapgen_osm.py')
osm=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(osm)


class ImportCheck(unittest.TestCase):
    def test_ring_order_and_hole(self):
        self.assertEqual(osm.rings([['1','2'],['3','2'],['3','4','1']]),[['3','4','1','2','3']])
        self.assertEqual(osm.rings([['1','2'],['3','4']]),[])
        polygon=[(0,0),(20,0),(20,20),(0,20)]
        self.assertTrue(osm.inside(8,8,polygon))
        self.assertFalse(osm.inside(25,8,polygon))

    def test_height_units_and_signed_layer(self):
        self.assertEqual(osm.number('12 m'),12)
        self.assertAlmostEqual(osm.number('10 ft'),3.048)
        self.assertEqual(osm.number('-1'),-1)
        self.assertEqual(osm.number('NaN',7),7)
        self.assertEqual(osm.number('12;15',7),7)

    def test_rectangles_preserve_cells_and_heights(self):
        cells={(0,0):12,(1,0):12,(0,1):12,(1,1):12,(2,1):20}
        boxes=osm.rectangles(cells,4)
        self.assertEqual(sum(w*d for _,_,w,d,_ in boxes),len(cells)*16)
        self.assertEqual(len(boxes),2)
        self.assertIn([4,4,8,8,12],boxes)

    def test_underpass_and_entities(self):
        source='''<osm><node id="1" lat="35.69" lon="139.69"/>
        <node id="2" lat="35.691" lon="139.691"/>
        <way id="1"><nd ref="1"/><nd ref="2"/><tag k="highway" v="secondary"/><tag k="layer" v="-1"/></way>
        <way id="2"><nd ref="1"/><nd ref="2"/><tag k="highway" v="secondary"/></way></osm>'''
        with tempfile.TemporaryDirectory() as temp:
            file=pathlib.Path(temp)/'test.osm';file.write_text(source)
            _,roads,_=osm.load_osm(file,(139.69,35.69),0,(200,200),4)
            self.assertEqual([r['id'] for r in roads],['2'])
            file.write_text('<!DOCTYPE osm><osm/>')
            with self.assertRaises(ValueError):osm.load_osm(file,(139.69,35.69),0,(200,200),4)


if __name__=='__main__':unittest.main()
