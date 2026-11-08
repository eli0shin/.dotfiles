#!/usr/bin/env python3
"""Exercise Herdr's first-launch preferences through the real cmd_stow path."""
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONFIG = Path('home/.config/herdr-app')


class HerdrConfigTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir='/tmp')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / 'dotfiles'
        self.home = self.root / 'home'
        (self.home / '.config').mkdir(parents=True)
        # Only portable files, never this machine's ignored runtime state.
        files = subprocess.check_output(
            ['git', 'ls-files', str(CONFIG)], cwd=ROOT, text=True).splitlines()
        files += ['lib/common.sh', 'lib/dotfiles.sh',
                  'scripts/configure-herdr-app.sh', 'scripts/prepare-herdr-fonts.py',
                  str(CONFIG / 'shared.defaults.json')]
        for name in set(files):
            source = ROOT / name
            if source.is_file():
                target = self.repo / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
        self.config = self.repo / CONFIG
        self.state = self.config / 'shared.json'
        self.env = dict(os.environ, HOME=str(self.home), DOTFILES_DIR=str(self.repo))

    def stow(self, success=True):
        result = subprocess.run([
            'bash', '-euc', '''
source "$DOTFILES_DIR/lib/common.sh"
source "$DOTFILES_DIR/lib/dotfiles.sh"
cmd_merge() { :; }
cmd_stow
'''], env=self.env, capture_output=True, text=True)
        if success:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def assert_preferences(self):
        state = json.loads(self.state.read_text()) if self.state.exists() else {}
        self.assertEqual(state.get('layout'), 'eli', 'Fresh launch must select eli, not main')
        self.assertEqual(state.get('workspace.panels'), [], 'Files/Changes buttons must be disabled')
        self.assertIn(state.get('frame.welcomed'), ('finished', 'skipped'))
        self.assertTrue((self.config / 'layouts/eli.json').is_file())
        settings = json.loads((self.config / 'settings.json').read_text())
        self.assertEqual(settings['theme'], 'arctic')
        self.assertTrue((self.config / 'themes/arctic.json').is_file())

    def test_font_uses_family_name_not_face_name(self):
        settings = json.loads((self.config / 'settings.json').read_text())
        self.assertEqual(settings['font'], 'Operator Mono Book Herdr')
        self.assertEqual(settings['ui_font'], 'Operator Mono Book Herdr')
        self.assertEqual(settings['font_size'], 16)
        layout = json.loads((self.config / 'layouts/eli.json').read_text())
        self.assertNotIn('font', layout, 'eli must inherit the tracked terminal font')

    def test_first_launch(self):
        self.stow()
        self.assert_preferences()
        self.assertTrue((self.home / '.config/herdr-app').is_symlink())

    def test_existing_runtime_is_preserved_and_managed_preferences_converge(self):
        runtime = {'layout': 'main', 'workspace.panels': ['files', 'changes'],
                   'space.colors': {'local-space': 'ansi3'},
                   'dotfiles.agents.order': {'addresses': ['t1']}}
        self.state.write_text(json.dumps(runtime))
        view = self.config / 'view.json'
        view.write_text('{"active":"local-space"}\n')
        self.stow()
        self.assert_preferences()
        updated = json.loads(self.state.read_text())
        for key in ('space.colors', 'dotfiles.agents.order'):
            self.assertEqual(updated[key], runtime[key])
        self.assertEqual(view.read_text(), '{"active":"local-space"}\n')
        before = self.state.stat().st_mtime_ns
        self.stow()
        self.assertEqual(self.state.stat().st_mtime_ns, before, 'No-op must not rewrite runtime state')

    def test_invalid_runtime_is_not_clobbered(self):
        for content in ('{broken', '[]', 'null'):
            with self.subTest(content=content):
                self.state.write_text(content)
                self.stow(success=False)
                self.assertEqual(self.state.read_text(), content)

    def test_running_app_is_not_overwritten(self):
        # A socket and successful status query stand in for a live app.
        self.stow()
        stub = self.root / 'bin'
        stub.mkdir()
        app = stub / 'herdr-app'
        app.write_text('#!/bin/sh\n[ "$1" = status ]\n')
        app.chmod(0o755)
        self.env['PATH'] = f"{stub}:{self.env['PATH']}"
        with socket.socket(socket.AF_UNIX) as sock:
            sock.bind(str(self.config / 'herdr-app.sock'))
            self.stow()  # Already configured: safe even while running.
            self.state.write_text('{"layout":"main","local":"keep"}')
            before = self.state.read_bytes()
            for response in ('exit 0',
                             'echo \'{"error":"the window did not answer"}\'; exit 1',
                             'echo "herdr-app: the window hung up" >&2; exit 1'):
                with self.subTest(response=response):
                    app.write_text('#!/bin/sh\n' + response + '\n')
                    self.state.write_bytes(before)
                    result = self.stow(success=False)
                    self.assertIn('Quit Herdr', result.stdout + result.stderr)
                    self.assertEqual(self.state.read_bytes(), before)

    def test_stale_socket_does_not_block_setup(self):
        stub = self.root / 'bin'
        stub.mkdir()
        app = stub / 'herdr-app'
        app.write_text('#!/bin/sh\necho "herdr-app: no Herdr window at socket: Connection refused" >&2\nexit 1\n')
        app.chmod(0o755)
        self.env['PATH'] = f"{stub}:{self.env['PATH']}"
        with socket.socket(socket.AF_UNIX) as sock:
            sock.bind(str(self.config / 'herdr-app.sock'))
        self.stow()
        self.assert_preferences()


if __name__ == '__main__':
    unittest.main()
