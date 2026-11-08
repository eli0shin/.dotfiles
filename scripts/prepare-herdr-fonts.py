#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["fonttools==4.60.1"]
# ///
"""Build a private Herdr family from locally licensed Operator Mono faces.

Herdr requests weight 500 for ordinary cells. The original fonts advertise
Book as 325 and Bold as 400, so its family matching picks Bold for normal text.
Rename local copies and normalize selection metadata, never the glyph outlines.
No licensed font data belongs in git.
"""
import argparse
from io import BytesIO
from pathlib import Path
import sys
import tempfile

from fontTools.ttLib import TTFont

FAMILY = 'Operator Mono Book Herdr'
FACES = (
    ('Book', 'Regular', 500, False),
    ('BookItalic', 'Italic', 500, True),
    ('Bold', 'Bold', 700, False),
    ('BoldItalic', 'Bold Italic', 700, True),
)


def source_dirs():
    home = Path.home()
    return (home / 'Library/Fonts', Path('/Library/Fonts'),
            home / '.local/share/fonts', home / '.fonts',
            Path('/usr/local/share/fonts'), Path('/usr/share/fonts'))


def find_sources(directories):
    found = {}
    filenames = {f'operatormono-{face.lower()}.otf': face for face, *_ in FACES}
    for directory in directories:
        if not directory.is_dir():
            continue
        for path in sorted(directory.rglob('*')):
            face = filenames.get(path.name.lower())
            if face and face not in found and path.is_file():
                found[face] = path
    return found


def prepare_face(path, face, style, weight, italic):
    with TTFont(path, recalcTimestamp=False) as font:
        names = font['name']
        if names.getDebugName(6) != f'OperatorMono-{face}' or names.getDebugName(16) != 'Operator Mono':
            raise ValueError(f'Not the original Operator Mono {face}: {path}')
        postscript = 'DotfilesOperatorMonoBook-' + style.replace(' ', '')
        # Remove every localized legacy/typographic family and face alias.
        replaced = {1, 2, 3, 4, 6, 16, 17, 18, 21, 22}
        names.names = [record for record in names.names if record.nameID not in replaced]
        values = {1: FAMILY, 2: style, 3: postscript + ';dotfiles-v1',
                  4: FAMILY + ' ' + style, 6: postscript, 16: FAMILY, 17: style}
        for name_id, value in values.items():
            for platform, encoding, language in ((3, 1, 0x409), (1, 0, 0)):
                names.setName(value, name_id, platform, encoding, language)
        os2 = font['OS/2']
        os2.usWeightClass = weight
        # Keep unrelated flags; explicitly label normal, bold and italic styles.
        os2.fsSelection &= ~((1 << 0) | (1 << 5) | (1 << 6))
        os2.fsSelection |= (1 if italic else 0) | ((1 << 5) if weight == 700 else 0)
        if not italic and weight != 700:
            os2.fsSelection |= 1 << 6
        font['head'].macStyle = (font['head'].macStyle & ~3) | (1 if weight == 700 else 0) | (2 if italic else 0)
        cff = font['CFF '].cff
        cff.fontNames = [postscript]
        top = cff.topDictIndex[0]
        top.FamilyName = FAMILY
        top.FullName = values[4]
        top.Weight = 'Bold' if weight == 700 else 'Medium'
        output = BytesIO()
        font.save(output)
        return output.getvalue()


def prepare(directories, output, if_available=False):
    sources = find_sources(directories)
    missing = [face for face, *_ in FACES if face not in sources]
    if missing:
        message = ('Herdr Book fonts not prepared: install licensed Operator Mono '
                   + ', '.join(missing) + ' faces, then rerun dot stow.')
        if if_available:
            print('WARNING: ' + message, file=sys.stderr)
            return False
        raise ValueError(message)
    # Validate and build every face before changing any output.
    generated = [(f'DotfilesOperatorMonoBook-{style.replace(" ", "")}.otf',
                  prepare_face(sources[face], face, style, weight, italic))
                 for face, style, weight, italic in FACES]
    output.mkdir(parents=True, exist_ok=True)
    for name, data in generated:
        target = output / name
        if target.exists() and target.read_bytes() == data:
            continue
        with tempfile.NamedTemporaryFile(dir=output, prefix='.operator-book-', delete=False) as handle:
            temporary = Path(handle.name)
            try:
                handle.write(data)
                handle.close()
                temporary.replace(target)
            finally:
                temporary.unlink(missing_ok=True)
    print('Herdr font family ready: ' + FAMILY + ' (Book / Book Italic / Bold / Bold Italic)')
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path, action='append', help='Folder containing licensed OperatorMono-*.otf files')
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'home/.config/herdr-app/fonts')
    parser.add_argument('--if-available', action='store_true', help='Warn rather than fail when licensed fonts are absent')
    args = parser.parse_args()
    try:
        prepare(args.source_dir if args.source_dir is not None else source_dirs(), args.output, args.if_available)
    except (OSError, ValueError) as error:
        parser.exit(1, str(error) + '\n')


if __name__ == '__main__':
    main()
