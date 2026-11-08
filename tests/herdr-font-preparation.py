#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["fonttools==4.60.1"]
# ///
"""Test font preparation with synthetic, non-proprietary CFF fonts."""
from hashlib import sha256
from pathlib import Path
import runpy
import tempfile
import unittest

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
MODULE = runpy.run_path(str(ROOT / 'scripts/prepare-herdr-fonts.py'))


def synthetic_face(path, face):
    builder = FontBuilder(1000, isTTF=False)
    builder.setupGlyphOrder(['.notdef', 'H'])
    builder.setupCharacterMap({72: 'H'})
    glyphs = {}
    for name in ('.notdef', 'H'):
        pen = T2CharStringPen(550, None)
        if name == 'H':
            pen.moveTo((80, 0))
            pen.lineTo((165, 0))
            pen.lineTo((165, 620))
            pen.lineTo((80, 620))
            pen.closePath()
        glyphs[name] = pen.getCharString()
    builder.setupCFF('OperatorMono-' + face, {'FullName': 'Operator Mono ' + face,
                     'FamilyName': 'Operator Mono', 'Weight': face}, glyphs, {})
    builder.setupHorizontalMetrics({name: (550, 0) for name in glyphs})
    builder.setupHorizontalHeader(ascent=800, descent=-200)
    builder.setupNameTable({'familyName': 'Operator Mono', 'styleName': face,
                           'psName': 'OperatorMono-' + face,
                           'typographicFamily': 'Operator Mono', 'typographicSubfamily': face})
    builder.setupOS2(usWeightClass=325 if face.startswith('Book') else 400,
                     sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
    builder.setupPost()
    builder.save(path)


class FontPreparationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.source = Path(self.temp.name) / 'source'
        self.source.mkdir()
        self.output = Path(self.temp.name) / 'fonts'
        for face, *_ in MODULE['FACES']:
            synthetic_face(self.source / f'OperatorMono-{face}.otf', face)

    def prepare(self, **kwargs):
        return MODULE['prepare']([self.source], self.output, **kwargs)

    def test_metadata_changes_but_source_and_outlines_do_not(self):
        before = {path: sha256(path.read_bytes()).digest() for path in self.source.iterdir()}
        self.prepare()
        for face, style, weight, italic in MODULE['FACES']:
            source_path = self.source / f'OperatorMono-{face}.otf'
            target_path = self.output / f'DotfilesOperatorMonoBook-{style.replace(" ", "")}.otf'
            with TTFont(source_path) as original, TTFont(target_path) as prepared:
                self.assertEqual(prepared['name'].getDebugName(16), MODULE['FAMILY'])
                self.assertEqual(prepared['OS/2'].usWeightClass, weight)
                self.assertEqual(bool(prepared['OS/2'].fsSelection & 1), italic)
                self.assertEqual(bool(prepared['OS/2'].fsSelection & 32), weight == 700)
                self.assertEqual(prepared['CFF '].cff.topDictIndex[0].FamilyName, MODULE['FAMILY'])
                self.assertEqual(prepared['hmtx'].metrics, original['hmtx'].metrics)
                for name in original.getGlyphOrder():
                    old, new = RecordingPen(), RecordingPen()
                    original.getGlyphSet()[name].draw(old)
                    prepared.getGlyphSet()[name].draw(new)
                    self.assertEqual(new.value, old.value, f'{face}: changed {name} outline')
        self.assertEqual(before, {path: sha256(path.read_bytes()).digest() for path in self.source.iterdir()})
        mtimes = {path: path.stat().st_mtime_ns for path in self.output.iterdir()}
        self.prepare()
        self.assertEqual(mtimes, {path: path.stat().st_mtime_ns for path in self.output.iterdir()})

    def test_missing_faces_do_not_create_partial_family(self):
        (self.source / 'OperatorMono-BookItalic.otf').unlink()
        with self.assertRaisesRegex(ValueError, 'BookItalic'):
            self.prepare()
        self.assertFalse(self.output.exists())
        self.assertFalse(self.prepare(if_available=True))
        self.assertFalse(self.output.exists())

    def test_misnamed_non_original_font_is_rejected(self):
        path = self.source / 'OperatorMono-Book.otf'
        with TTFont(path) as font:
            for record in list(font['name'].names):
                if record.nameID == 6:
                    font['name'].setName('NotOperatorMono', 6, record.platformID, record.platEncID, record.langID)
            font.save(path)
        with self.assertRaisesRegex(ValueError, 'Not the original'):
            self.prepare()
        self.assertFalse(self.output.exists())


if __name__ == '__main__':
    unittest.main()
